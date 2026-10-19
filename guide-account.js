/* ==========================================================
   Guide accounts — "is this signed-in person a guide?"

   HOW A GUIDE GETS AN ACCOUNT
   They sign up on signup.html like anyone else, using the email
   address already on their guide document's `contact` field. The
   first time they sign in, this links the two by writing

     guide_accounts/{uid} -> { guide_id, guide_doc_id, email, linked_at }

   Nobody types a password for them and there's no admin screen.

   WHY THE LINK IS SAFE TO LET THEM WRITE THEMSELVES
   The rule for that collection re-reads the real guide document and
   refuses the write unless its `contact` is the email they are
   actually signed in with. So claiming to be G001 only works if
   G001's contact address is yours. After it exists, only an admin
   can change it — a guide can't later repoint their own link.

   WHY A MAPPING DOCUMENT AT ALL
   saveGuide() creates guides with addDoc(), so a guide's DOCUMENT
   id is random while `guide_id` is a slug. Firestore rules can
   get() a known path but can't query a collection, so there's no
   way for a rule to go from "G001" to that guide's document. One
   document keyed by uid removes the problem.
   ========================================================== */

import { auth, db, normalizeBooking } from "./trailbound-data.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const ACCOUNTS = "guide_accounts";
const GUIDES = "guides";
const BOOKINGS = "bookings";

/* ---------- finding out who someone is ---------- */

/** The link, if it already exists. */
async function readLink(uid) {
  try {
    const snap = await getDoc(doc(db, ACCOUNTS, uid));
    if (!snap.exists()) return null;
    const d = snap.data() || {};
    const guideId = String(d.guide_id || "").trim();
    return guideId ? { guideId, guideDocId: String(d.guide_doc_id || ""), email: d.email || "" } : null;
  } catch (err) {
    console.error("[guide] couldn't read the account link:", err);
    return null;
  }
}

/**
 * ADDED — the cheap check, for pages that only need to know whether
 * to show a "My Schedule" link.
 *
 * One document read and nothing else: no email lookup, no linking.
 * auth-nav.js runs on every page, so it must not do the full
 * resolveGuide() work on each one. Returns false on any error, so a
 * missing rule or a dropped connection just means no extra link.
 */
export async function isLinkedGuide(uid) {
  if (!uid) return false;
  return Boolean(await readLink(uid));
}

/** A guide document whose `contact` is this email. Guides are
    publicly readable, so this query needs no special permission. */
async function findGuideByEmail(email) {
  const address = String(email || "").trim();
  if (!address) return null;

  try {
    const snap = await getDocs(
      query(collection(db, GUIDES), where("contact", "==", address), limit(1)),
    );
    if (snap.empty) return null;

    const docSnap = snap.docs[0];
    const d = docSnap.data() || {};
    const guideId = String(d.guide_id || "").trim();
    if (!guideId) {
      // A guide record with no guide_id can't be linked: every
      // booking stores guide_id, so there'd be nothing to match on.
      console.warn("[guide] matched a guide document with no guide_id:", docSnap.id);
      return null;
    }

    return {
      guideId,
      guideDocId: docSnap.id,
      fullName: d.full_name || d.name || "Guide",
      status: d.status || "Active",
    };
  } catch (err) {
    console.error("[guide] couldn't look up guides by email:", err);
    return null;
  }
}

/**
 * Who is this user? Returns { guideId, guideDocId, fullName } or null.
 * Links the account on first sign-in; after that it's one read.
 */
export async function resolveGuide(user) {
  if (!user) return null;

  const existing = await readLink(user.uid);
  if (existing) {
    // The link holds the id; the name comes from the live guide
    // document so a rename in admin shows up here too.
    const fresh = await readGuideDoc(existing.guideDocId);
    return {
      guideId: existing.guideId,
      guideDocId: existing.guideDocId,
      fullName: fresh?.full_name || fresh?.name || "Guide",
      status: fresh?.status || "Active",
    };
  }

  const match = await findGuideByEmail(user.email);
  if (!match) return null;

  try {
    await setDoc(doc(db, ACCOUNTS, user.uid), {
      guide_id: match.guideId,
      guide_doc_id: match.guideDocId,
      email: String(user.email || ""),
      linked_at: new Date().toISOString(),
    });
  } catch (err) {
    // The link failed, but we still know who they are for this visit.
    // They just won't be able to READ their bookings, because the
    // rule needs that document — so say so rather than show an
    // empty schedule that looks like "no climbs booked".
    console.error("[guide] couldn't save the account link:", err);
    return { ...match, linkFailed: true };
  }

  return match;
}

async function readGuideDoc(docId) {
  if (!docId) return null;
  try {
    const snap = await getDoc(doc(db, GUIDES, docId));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}

/* ---------- their schedule ---------- */

/**
 * Live stream of the bookings assigned to one guide, newest climb
 * date first. Returns its unsubscribe function.
 *
 * The where() is not just a filter — the Firestore rule only lets a
 * guide read documents whose guide_id matches theirs, and Firestore
 * refuses any query that could return something the rules would
 * block. Remove it and the whole read fails.
 */
export function watchMyBookings(guideId, callback, { onError = null } = {}) {
  const id = String(guideId || "").trim();
  if (!id) {
    callback([]);
    return () => {};
  }

  return onSnapshot(
    query(collection(db, BOOKINGS), where("guide_id", "==", id)),
    (snap) => {
      const items = snap.docs.map((d) => normalizeBooking(d.id, d.data()));
      // Sorted here rather than with orderBy() so this needs no
      // composite index — the same reason products.js sorts reviews
      // in the browser.
      items.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
      callback(items);
    },
    (err) => {
      console.error("[guide] bookings stream error:", err);
      onError ? onError(err) : callback([]);
    },
  );
}

/* ---------- splitting a schedule into the three things that matter ---------- */

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/** Cancelled climbs are dropped from all three — a guide shouldn't
    be planning around a booking that isn't happening. */
export function splitByDate(bookings) {
  const today = todayISO();
  const live = bookings.filter((b) => b.status !== "cancelled");

  return {
    today: live.filter((b) => b.date === today),
    upcoming: live.filter((b) => b.date > today),
    past: live.filter((b) => b.date < today).reverse(), // most recent first
  };
}
