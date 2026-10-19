/* ==========================================================
   Homepage hero greeting
   Fills #hero-greeting with "Welcome back, Nikko" for a signed-in
   visitor, or "Welcome, Guest" for everyone else.

   WHY IT STARTS EMPTY
   Firebase resolves the signed-in user asynchronously — for a
   moment after the page loads, nobody knows who you are. Writing
   "Welcome, Guest" straight away would make it visibly flip to
   your name a beat later, which looks broken. The line starts
   empty with its space already reserved, so the name simply
   appears once and nothing moves.

   WHERE THE NAME COMES FROM, in order:
     1. user.displayName        — set at signup with updateProfile()
     2. users/{uid} in Firestore — if your signup stores a name there
     3. the email before the @   — last resort, tidied up
     4. "Guest"                  — nobody signed in

   If your signup already calls updateProfile({ displayName }), step
   1 always wins and you can delete nameFromFirestore() below along
   with its call — the greeting will be one step faster.
   ========================================================== */

import { auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const GREETING_ID = "hero-greeting";

/* ---------- turning whatever we have into a first name ---------- */

function titleCase(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : "";
}

/* "Nikko Paulo M. Bello" -> "Nikko". A hero line reads better with
   just the first name, and it keeps long names from wrapping. */
function firstNameOf(fullName) {
  return String(fullName || "").trim().split(/\s+/)[0] || "";
}

/* "juan.dela_cruz@gmail.com" -> "Juan"
   Not pretty for an address like "nikkobells1234@…", which is why
   setting displayName at signup is worth doing. */
function nameFromEmail(email) {
  const local = String(email || "").split("@")[0];
  if (!local) return "";
  return titleCase(local.split(/[._-]+/).filter(Boolean)[0] || "");
}

/* ---------- optional: a name stored on the user's document ----------
   Imported dynamically so a missing or renamed firebase-config.js
   can't stop the greeting — it just falls through to the email.
   Several field names are tried because signup forms vary. */
async function nameFromFirestore(uid) {
  try {
    const [{ db }, { doc, getDoc }] = await Promise.all([
      import("./firebase-config.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"),
    ]);
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return "";
    const d = snap.data() || {};
    return String(
      d.full_name || d.fullName || d.name || d.displayName || d.first_name || d.firstName || "",
    ).trim();
  } catch {
    // No document, rules said no, or the module isn't there — all fine.
    return "";
  }
}

/* ---------- writing it out ---------- */

function setGreeting(text) {
  const el = document.getElementById(GREETING_ID);
  if (!el) return; // not the homepage
  el.textContent = text;
  el.classList.add("is-ready");
}

async function greet(user) {
  if (!user) {
    setGreeting("Welcome, Guest");
    return;
  }

  // Show something immediately if we already can, so a slow Firestore
  // read never leaves the line blank.
  let name = firstNameOf(user.displayName) || nameFromEmail(user.email);
  if (name) setGreeting(`Welcome back, ${name}`);

  // Then upgrade to the stored profile name if there is a better one
  if (!user.displayName) {
    const stored = firstNameOf(await nameFromFirestore(user.uid));
    if (stored && stored !== name) {
      name = stored;
      setGreeting(`Welcome back, ${name}`);
    }
  }

  // Nothing usable anywhere — still greet them rather than show nothing
  if (!name) setGreeting("Welcome back");
}

onAuthStateChanged(auth, greet);
