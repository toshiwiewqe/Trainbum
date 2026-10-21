/* ==========================================================
   Saved trails (the heart button)

   One small module that owns WHERE a saved trail is kept, so the
   trail page and the account page never disagree about it.

   Where it's stored
     Signed in  -> users/{uid}.wishlist_trails in Firestore, as an
                   array of trail_id strings.
     Signed out -> localStorage, so the heart still works and still
                   remembers on that device.

   When someone signs in, anything they hearted while signed out is
   pushed up to their Firestore document, then kept in localStorage
   as a cache so the heart is filled in instantly on the next visit
   instead of blinking empty while Firebase loads.

   Nothing here touches the Products wishlist that account.js already
   handles — different field, different code, no overlap.
   ========================================================== */

import { auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc, arrayUnion, arrayRemove } from "firebase/firestore";

const STORAGE_KEY = "trailbound_saved_trails";
const CHANGE_EVENT = "trailbound:saved-trails-change";

let saved = new Set(readLocal());
let currentUser = null;
let hadUser = false;

/* ---------- the local cache ----------
   Every read and write is wrapped: private windows and blocked site
   data make localStorage throw, and a saved trail isn't worth
   breaking the page over. */

function readLocal() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...saved]));
  } catch {
    /* ignore — the Set in memory is still correct for this visit */
  }
}

function clearLocal() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/* Tells every open view (the panel's heart, the account list) that
   the set changed, so they repaint without knowing about each other. */
function announce() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { ids: [...saved] } }));
}

/* ---------- what the rest of the site uses ---------- */

export function getSavedTrailIds() {
  return [...saved];
}

export function isTrailSaved(trailId) {
  return saved.has(String(trailId ?? "").trim());
}

export function isSignedIn() {
  return Boolean(currentUser);
}

export function onSavedTrailsChange(callback) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

/* Flips one trail. The local set changes first so the heart fills in
   the moment it's tapped — waiting on Firestore would make it feel
   broken on a slow connection. Returns true if it's now saved. */
export async function toggleTrailSaved(trailId) {
  const key = String(trailId ?? "").trim();
  if (!key) return false;

  const nowSaved = !saved.has(key);
  if (nowSaved) saved.add(key);
  else saved.delete(key);

  writeLocal();
  announce();

  if (currentUser) {
    try {
      await setDoc(
        doc(db, "users", currentUser.uid),
        { wishlist_trails: nowSaved ? arrayUnion(key) : arrayRemove(key) },
        { merge: true },
      );
    } catch (err) {
      // Nearly always a Firestore rule saying no. The heart still
      // shows the right thing on this device; see the note in the
      // reply about allowing `wishlist_trails`.
      console.error("[saved trails] couldn't write to Firestore:", err);
    }
  }

  return nowSaved;
}

export async function removeSavedTrail(trailId) {
  if (isTrailSaved(trailId)) await toggleTrailSaved(trailId);
}

/* ---------- signing in and out ---------- */

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;

  if (!user) {
    // Only wipe the cache on an actual sign-out, so the next person
    // on this browser doesn't inherit someone else's saved trails.
    if (hadUser) {
      hadUser = false;
      saved = new Set();
      clearLocal();
    }
    announce();
    return;
  }

  hadUser = true;

  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    const stored =
      snap.exists() && Array.isArray(snap.data()?.wishlist_trails)
        ? snap.data().wishlist_trails.map(String)
        : [];

    // Anything hearted before signing in that the account doesn't
    // have yet, so a save made while logged out isn't lost.
    const pending = [...saved].filter((id) => !stored.includes(id));

    saved = new Set([...stored, ...saved]);
    writeLocal();
    announce();

    if (pending.length) {
      await setDoc(ref, { wishlist_trails: arrayUnion(...pending) }, { merge: true });
    }
  } catch (err) {
    console.error("[saved trails] couldn't read from Firestore:", err);
    announce(); // fall back to whatever's cached on this device
  }
});
