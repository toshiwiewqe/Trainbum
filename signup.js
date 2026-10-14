/* ==========================================================
   Trailbound — Sign Up
   ----------------------------------------------------------
   Why this page exists at all:

   login.js used to create an account whenever sign-in failed with
   "user-not-found". That is convenient and quietly unsafe — a
   mistyped email silently became a brand new account instead of an
   error, so people ended up with duplicate profiles and no idea
   which one held their bookings. Registration is now deliberate,
   and login.js just says "no account found" and points here.

   What this page does that the old path did not:
     - asks for a name, so the admin Users table isn't a list of
       blank rows
     - requires the password twice, and rates it as it is typed
     - emails a 6-digit confirmation code, for email
       sign-ups as well as social ones
     - writes users/{uid} through ensureUserDoc(), so the account
       appears in the admin panel immediately with role "customer"

   What it deliberately does NOT do: decide anything about privilege.
   The role is fixed at "customer" here AND in firestore.rules, so a
   crafted request cannot register itself as staff. Admin rights come
   only from a document in `admins/`, added by hand in the Firebase
   console.
   ========================================================== */

import { auth } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  deleteUser,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { ensureUserDoc, touchUser } from "./trailbound-data.js";

const el = {
  box: document.getElementById("signup-box"),
  done: document.getElementById("signup-done"),
  fullname: document.getElementById("fullname"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  confirm: document.getElementById("confirm"),
  terms: document.getElementById("terms"),
  submit: document.getElementById("submit"),
  strength: document.getElementById("strength"),
  strengthBar: document.getElementById("strength-bar"),
  strengthLabel: document.getElementById("strength-label"),
  doneTitle: document.getElementById("done-title"),
  doneText: document.getElementById("done-text"),
  doneEmail: document.getElementById("done-email"),
  doneNote: document.getElementById("done-note"),
  doneResend: document.getElementById("done-resend"),
  doneBack: document.getElementById("done-back"),
  doneLinks: document.querySelector(".signup-done-links"),
  codeWrap: document.getElementById("code-wrap"),
  codeInput: document.getElementById("code-input"),
  codeError: document.getElementById("code-error"),
  codeVerify: document.getElementById("code-verify"),
  googleBtn: document.querySelector(".google-btn"),
  facebookBtn: document.querySelector(".facebook-btn")
};

/* ---------- validation helpers (same shape as login.js) ---------- */

function showError(input, message) {
  clearError(input);
  input.classList.add("input-error-state");
  const box = input.closest(".input-box") || input.closest(".signup-terms");
  if (!box) return;
  const error = document.createElement("span");
  error.className = "input-error visible";
  error.textContent = message;
  error.dataset.errorFor = input.id;
  box.appendChild(error);
}

function clearError(input) {
  input.classList.remove("input-error-state");
  const box = input.closest(".input-box") || input.closest(".signup-terms");
  box?.querySelector(".input-error")?.remove();
}

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/* "nikko@gmail.com" + "nikko2026" -> true.
   Guarded on length because a short local part ("a@x.com") would
   otherwise flag almost every password as containing the email, and
   an empty one makes String.includes("") true for everything. */
function localPartInPassword(email, password) {
  const local = email.split("@")[0].toLowerCase();
  return local.length >= 3 && password.toLowerCase().includes(local);
}

/* ---------- password strength ----------
   Deliberately a guide, not a gate. The only hard rules are the two
   enforced below: at least 8 characters, and not a password made of
   one repeated character. Everything else is advice — arbitrary
   symbol requirements push people toward "Password1!" and a sticky
   note, which is worse than a long ordinary phrase. */

const STRENGTH = [
  { label: "Too short", className: "is-weak", width: "20%" },
  { label: "Weak", className: "is-weak", width: "35%" },
  { label: "Okay", className: "is-fair", width: "60%" },
  { label: "Good", className: "is-good", width: "80%" },
  { label: "Strong", className: "is-strong", width: "100%" }
];

function scorePassword(value) {
  if (value.length < 8) return 0;
  let score = 1;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  return Math.min(score, 4);
}

function renderStrength() {
  const value = el.password.value;
  if (!value) {
    el.strength.hidden = true;
    return;
  }
  const meter = STRENGTH[scorePassword(value)];
  el.strength.hidden = false;
  el.strengthBar.className = meter.className;
  el.strengthBar.style.width = meter.width;
  el.strengthLabel.textContent = meter.label;
}

/* ---------- events ---------- */

[el.fullname, el.email, el.password, el.confirm].forEach((input) =>
  input.addEventListener("input", () => clearError(input))
);
el.password.addEventListener("input", renderStrength);
el.terms.addEventListener("change", () => clearError(el.terms));

// Enter submits from any field, as people expect on a short form.
[el.fullname, el.email, el.password, el.confirm].forEach((input) =>
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.submit.click();
    }
  })
);

el.submit.addEventListener("click", async () => {
  const name = el.fullname.value.trim();
  const email = el.email.value.trim();
  const password = el.password.value;
  let valid = true;

  if (!name) {
    showError(el.fullname, "Please tell us your name.");
    valid = false;
  } else if (name.length < 2) {
    showError(el.fullname, "That name looks too short.");
    valid = false;
  }

  if (!email) {
    showError(el.email, "Email is required.");
    valid = false;
  } else if (!isValidEmail(email)) {
    showError(el.email, "Enter a valid email address.");
    valid = false;
  }

  if (!password) {
    showError(el.password, "Password is required.");
    valid = false;
  } else if (password.length < 8) {
    showError(el.password, "Use at least 8 characters.");
    valid = false;
  } else if (new Set(password).size < 4) {
    // "aaaaaaaa" and "11111111" clear a length check but are the
    // first things any dictionary attack tries.
    showError(el.password, "That password is too repetitive. Mix it up a little.");
    valid = false;
  } else if (isValidEmail(email) && localPartInPassword(email, password)) {
    showError(el.password, "Don't use your email address in your password.");
    valid = false;
  }

  if (!el.confirm.value) {
    showError(el.confirm, "Please confirm your password.");
    valid = false;
  } else if (el.confirm.value !== password) {
    showError(el.confirm, "Those passwords don't match.");
    valid = false;
  }

  if (!el.terms.checked) {
    showError(el.terms, "Please accept the terms to continue.");
    valid = false;
  }

  if (!valid) return;

  el.submit.disabled = true;
  const original = el.submit.textContent;
  el.submit.textContent = "Creating your account...";

  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);

    // Name first: ensureUserDoc reads user.displayName, so setting it
    // afterwards would leave a blank name in the admin Users table.
    await updateProfile(user, { displayName: name });

    // An explicit plain object rather than {...user}. A Firebase User
    // exposes much of its data through prototype getters, so spreading
    // it can hand over an object with none of the fields ensureUserDoc
    // needs — and the failure would be a silently nameless profile.
    await ensureUserDoc({
      uid: user.uid,
      email: user.email || email,
      displayName: name,
      photoURL: user.photoURL || ""
    });
    touchUser(user).catch(() => {});

    // The 6-digit code, same as the login page's Google flow — the
    // difference is that this one runs for email sign-ups too.
    showCodeStep(email);
    sendCode(email, name);
  } catch (err) {
    console.error("Sign-up failed:", err);
    const field = err.code === "auth/email-already-in-use" ? el.email : el.password;
    showError(field, friendlyError(err.code) || err.message || "Could not create the account.");
    el.submit.textContent = original;
    el.submit.disabled = false;
  }
});

function friendlyError(code) {
  switch (code) {
    case "auth/email-already-in-use":
      return "That email already has an account. Log in instead, or use Forgot Password.";
    case "auth/invalid-email":
      return "That email address looks invalid.";
    case "auth/weak-password":
      return "Firebase rejected that password as too weak. Try a longer one.";
    case "auth/operation-not-allowed":
      return "Email sign-up is not enabled yet in the Firebase console.";
    case "auth/network-request-failed":
      return "No connection. Check your internet and try again.";
    case "auth/too-many-requests":
      return "Too many attempts from this device. Wait a minute and try again.";
    default:
      return null;
  }
}

/* ==========================================================
   EMAIL CODE VERIFICATION
   ----------------------------------------------------------
   Previously this page used Firebase's sendEmailVerification(),
   which mails a LINK. The login page already mails a 6-digit CODE
   through EmailJS for Google sign-ins, so a person who registered
   with email and password got a different experience from everyone
   else. Both paths send a code now.

   BE CLEAR ABOUT WHAT THIS IS. The code is generated in the browser
   and kept in sessionStorage, so anyone who opens DevTools can read
   it. It reliably catches a MISTYPED ADDRESS — the common, honest
   failure — but it is not a security boundary, and nothing here
   pretends otherwise: the code never unlocks any permission. The
   Firestore rules are what actually protect data, and they key off
   the signed-in uid, not off this.

   If you later want verification that genuinely cannot be faked,
   switch to Firebase's own link (it sets user.emailVerified
   server-side) and gate on that. See the note at the end of the
   message that shipped this file.
   ========================================================== */

/* Same three values as login.html. If you rotate them in the EmailJS
   dashboard, change them in BOTH files. */
const EMAILJS_PUBLIC_KEY  = "sWgeXKnDZsScYJZ3z";
const EMAILJS_SERVICE_ID  = "service_s7cro69";
const EMAILJS_TEMPLATE_ID = "template_umpto7f";

const CODE_KEY = "trailbound_signup_otp";
const CODE_TTL_MS = 5 * 60 * 1000;   // 5 minutes
const MAX_ATTEMPTS = 5;

// The SDK is a plain <script> in the HTML, so guard against it being
// blocked or slow — a missing global must not take the page down.
try {
  window.emailjs?.init({ publicKey: EMAILJS_PUBLIC_KEY });
} catch (err) {
  console.warn("EmailJS init failed:", err);
}

const newCode = () => String(Math.floor(100000 + Math.random() * 900000));

function storeCode(code, email) {
  sessionStorage.setItem(
    CODE_KEY,
    JSON.stringify({ code, email, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0 })
  );
}

function readCode() {
  try {
    return JSON.parse(sessionStorage.getItem(CODE_KEY) || "null");
  } catch {
    return null;
  }
}

async function sendCode(email, name) {
  const code = newCode();
  storeCode(code, email);

  if (!window.emailjs) {
    showDoneNote("The email service didn't load. Check your connection, then press Resend.");
    return;
  }

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: email,
      to_name: name || email,
      code
    });
    showDoneNote("");
  } catch (err) {
    console.error("EmailJS send failed:", err);
    showDoneNote("We couldn't send the code just now. Press Resend in a moment.");
  }
}

function showCodeStep(email) {
  el.box.hidden = true;
  el.done.hidden = false;
  el.doneEmail.textContent = email;
  el.codeInput.value = "";
  el.codeError.hidden = true;
  el.codeInput.focus();
}

/** Google and Facebook hand back an address their own servers already
    verified, so a code would be theatre. They skip straight to done. */
function showVerifiedStep(email) {
  el.box.hidden = true;
  el.done.hidden = false;
  el.doneTitle.textContent = "You're all set";
  el.done.querySelector(".signup-done-icon").textContent = "\u2713";

  // Rebuilt from nodes rather than innerHTML. The address comes from
  // the provider, but it is still a value from outside this page.
  el.doneText.textContent = "Signed in as ";
  const who = document.createElement("strong");
  who.textContent = email;
  el.doneText.append(who, ". Your account is ready.");

  el.codeWrap.hidden = true;
  el.doneLinks.hidden = true;
  el.codeVerify.textContent = "Continue to Trailbound";
}

function showDoneNote(message) {
  el.doneNote.textContent = message;
  el.doneNote.hidden = !message;
}

function showCodeError(message) {
  el.codeError.textContent = message;
  el.codeError.hidden = false;
  el.codeInput.classList.add("input-error-state");
}

// Digits only, and clear the error as they retype.
el.codeInput.addEventListener("input", () => {
  el.codeInput.value = el.codeInput.value.replace(/\D/g, "").slice(0, 6);
  el.codeError.hidden = true;
  el.codeInput.classList.remove("input-error-state");
});

el.codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    el.codeVerify.click();
  }
});

el.codeVerify.addEventListener("click", async () => {
  // In the social path the code step is hidden and this is just a
  // "continue" button.
  if (el.codeWrap.hidden) {
    window.location.href = "index.html";
    return;
  }

  const stored = readCode();
  const entered = el.codeInput.value.trim();

  if (!stored) {
    showCodeError("That code has expired. Press Resend to get a new one.");
    return;
  }
  if (Date.now() > stored.expiresAt) {
    sessionStorage.removeItem(CODE_KEY);
    showCodeError("That code expired after 5 minutes. Press Resend to get a new one.");
    return;
  }
  if (entered.length !== 6) {
    showCodeError("Enter all 6 digits.");
    return;
  }

  if (entered !== stored.code) {
    // Burn the code after repeated wrong guesses rather than letting
    // someone sit and grind through 000000-999999.
    const attempts = (stored.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      sessionStorage.removeItem(CODE_KEY);
      showCodeError("Too many incorrect attempts. Press Resend to get a new code.");
      return;
    }
    sessionStorage.setItem(CODE_KEY, JSON.stringify({ ...stored, attempts }));
    showCodeError(`Incorrect code. ${MAX_ATTEMPTS - attempts} attempt(s) left.`);
    return;
  }

  sessionStorage.removeItem(CODE_KEY);
  el.codeVerify.disabled = true;
  el.codeVerify.textContent = "Verifying...";

  // Recorded on the profile so the admin panel can tell a confirmed
  // address from an unconfirmed one. Best-effort: a failed write must
  // not strand someone who typed the right code.
  try {
    const { updateUserProfile } = await import("./trailbound-data.js");
    await updateUserProfile(auth.currentUser.uid, { emailConfirmedAt: new Date() });
  } catch (err) {
    console.warn("Could not record verification:", err?.code || err?.message);
  }

  window.location.href = "index.html";
});

el.doneResend.addEventListener("click", (e) => {
  e.preventDefault();
  const email = el.doneEmail.textContent;
  if (!email) return;
  el.codeInput.value = "";
  el.codeError.hidden = true;
  showDoneNote("Sending a new code...");
  sendCode(email, el.fullname.value.trim()).then(() => {
    if (el.doneNote.textContent === "Sending a new code...") {
      showDoneNote("Sent. It can take a minute — check your spam folder too.");
    }
  });
});

/* Wrong address typed? The account already exists under it, so it has
   to go before they can register the correct one — otherwise they hit
   "email already in use" on a mailbox they cannot open. */
el.doneBack.addEventListener("click", async (e) => {
  e.preventDefault();
  sessionStorage.removeItem(CODE_KEY);

  try {
    if (auth.currentUser) await deleteUser(auth.currentUser);
  } catch (err) {
    console.warn("Could not remove the unverified account:", err?.code);
    try {
      await signOut(auth);
    } catch {
      /* nothing more we can do from here */
    }
  }

  el.done.hidden = true;
  el.box.hidden = false;
  el.submit.disabled = false;
  el.submit.textContent = "Create account";
  el.email.focus();
  el.email.select();
});

/* ---------- social sign-up ----------
   Same providers as the login page. signInWithPopup both registers
   and signs in, so there is no separate "create" call — the only
   thing this page adds is ensureUserDoc, without which a social
   account never appears in the admin Users table. */

async function socialSignUp(provider, label) {
  try {
    const { user } = await signInWithPopup(auth, provider);
    await ensureUserDoc(user);
    touchUser(user).catch(() => {});
    showVerifiedStep(user.email || label);
  } catch (err) {
    if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
    console.error(`${label} sign-up failed:`, err);
    showError(el.email, friendlyError(err.code) || `${label} sign-up failed. Try email instead.`);
  }
}

el.googleBtn?.addEventListener("click", () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  socialSignUp(provider, "Google");
});

el.facebookBtn?.addEventListener("click", () =>
  socialSignUp(new FacebookAuthProvider(), "Facebook")
);