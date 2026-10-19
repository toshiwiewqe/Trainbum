/* ==========================================================
   Guide availability — "is this guide packed on this date?"

   WHY THIS DOESN'T READ THE BOOKINGS COLLECTION
   Your Firestore rules only let someone read their OWN bookings
   (see the comment in watchBookings() in trailbound-data.js). A
   customer asking "how many bookings does guide G001 have on
   Oct 20?" would be refused — and even if the rules allowed it,
   it would hand every customer the names, phone numbers and
   emergency contacts of every other customer. That's not a
   trade worth making for a counter.

   So the count lives in its own tiny collection instead:

     guide_days/{date}__{guide_id}
       { guide_id: "G001", date: "2026-10-20", booked: 2 }

   Three fields, no personal data, safe for any signed-in user to
   read. It's incremented when a booking is created.

   FAILS OPEN, ON PURPOSE. If this read is refused or errors, every
   guide shows as available rather than none. A booking page that
   blocks all bookings because a counter is unreachable is worse
   than one that occasionally lets a guide be double-booked — and
   the admin dashboard still shows you the clash.

   FIRESTORE RULES — add this block, or nothing here can work:

     match /guide_days/{dayId} {
       allow read: if request.auth != null;
       allow create, update: if request.auth != null
         && request.resource.data.booked is int
         && request.resource.data.booked > 0;
     }
   ========================================================== */

import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDocs,
  increment,
  query,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const COLLECTION = "guide_days";

/* How many groups a guide can take in one day when their document
   doesn't say. 1 rather than unlimited: a guide you haven't
   configured yet should not be bookable three times over. Set
   `max_groups_per_day` on a guide document to raise it. */
export const DEFAULT_MAX_GROUPS_PER_DAY = 1;

export function getGuideMaxPerDay(guide) {
  const raw = guide?.max_groups_per_day ?? guide?.maxGroupsPerDay;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_GROUPS_PER_DAY;
}

/* One document per guide per day. The date goes first so the id
   sorts by day in the Firestore console, which makes it readable
   when you're checking why someone shows as full. */
function dayDocId(guideId, date) {
  return `${String(date || "").trim()}__${String(guideId || "").trim()}`;
}

/**
 * How many groups each guide already has on this date.
 * @returns {Promise<Map<string, number>>} guide_id -> booked count
 */
export async function loadGuideDayCounts(date) {
  const counts = new Map();
  const day = String(date || "").trim();
  if (!day) return counts;

  try {
    const snap = await getDocs(query(collection(db, COLLECTION), where("date", "==", day)));
    snap.docs.forEach((d) => {
      const row = d.data() || {};
      const id = String(row.guide_id || "").trim();
      const booked = Number(row.booked);
      if (id && Number.isFinite(booked)) counts.set(id, booked);
    });
  } catch (err) {
    // Fails open — see the note at the top of this file.
    console.warn("[guide availability] couldn't read the day counts:", err);
  }

  return counts;
}

/** Is this guide still takeable on this date, given those counts? */
export function isGuideFree(guide, counts) {
  const id = String(guide?.guide_id || "").trim();
  if (!id) return true;
  const booked = Number(counts?.get(id)) || 0;
  return booked < getGuideMaxPerDay(guide);
}

/** "1 of 2 slots left" — what the card says underneath the name. */
export function slotsLeftLabel(guide, counts) {
  const id = String(guide?.guide_id || "").trim();
  const max = getGuideMaxPerDay(guide);
  const booked = Number(counts?.get(id)) || 0;
  const left = Math.max(0, max - booked);

  if (left === 0) return "Fully booked";
  if (max === 1) return "Available";
  return `${left} of ${max} slots left`;
}

/**
 * Called once a booking is saved. increment() is atomic server-side,
 * so two people booking at the same instant both land — the count
 * ends at 2, not 1.
 *
 * It does NOT stop a double-booking on its own: both browsers read
 * "available" before either wrote. See the note in booking.js about
 * the re-check on submit, which closes most of that window but not
 * all of it. A Firestore transaction is the complete fix.
 */
export async function bumpGuideDay(guideId, date) {
  const id = String(guideId || "").trim();
  const day = String(date || "").trim();
  if (!id || !day) return;

  try {
    await setDoc(
      doc(db, COLLECTION, dayDocId(id, day)),
      { guide_id: id, date: day, booked: increment(1) },
      { merge: true },
    );
  } catch (err) {
    // The booking itself is already saved; losing the counter means
    // this guide looks freer than they are, not that anything breaks.
    console.error("[guide availability] couldn't update the day count:", err);
  }
}
