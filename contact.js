/* ==========================================================
   Trailbound — Contact / Support Page
   Uses firebase-init.js (same CDN-based auth+db as account.js /
   login.js) rather than firebase-config.js, so this page doesn't
   spin up a second Firebase app instance.

   On submit, writes a doc to a new "support_messages" collection
   (mirrors the shape/conventions of the "orders" doc in
   checkout.js: created_at as an ISO string, a `status` field).

   TODO (real live chat): swap the disabled "Start Live Chat"
   button for whatever chat widget gets picked (Tawk.to, Intercom,
   Crisp, etc.) — see initLiveChatStub() below for where that
   hookup goes.
   ========================================================== */

import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  addDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  els.form           = document.getElementById("contact-form");
  els.nameInput      = document.getElementById("contact-name");
  els.emailInput     = document.getElementById("contact-email");
  els.subjectInput   = document.getElementById("contact-subject");
  els.messageInput   = document.getElementById("contact-message");
  els.submitBtn      = document.getElementById("contact-submit-btn");
  els.feedback       = document.getElementById("contact-feedback");
  els.formSection    = document.getElementById("contact-form-section");
  els.confirmation   = document.getElementById("contact-confirmation");
  els.refId          = document.getElementById("contact-ref-id");
  els.sendAnotherBtn = document.getElementById("contact-send-another-btn");

  // Prefill name/email for signed-in users (doesn't block guests from submitting).
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    if (user.displayName) els.nameInput.value = user.displayName;
    if (user.email) els.emailInput.value = user.email;
  });

  els.form.addEventListener("submit", handleSubmit);
  els.sendAnotherBtn.addEventListener("click", resetForm);

  initLiveChatStub();
}

async function handleSubmit(e) {
  e.preventDefault();

  const name = els.nameInput.value.trim();
  const email = els.emailInput.value.trim();
  const subject = els.subjectInput.value;
  const message = els.messageInput.value.trim();

  if (!name || !email || !subject || !message) {
    showFeedback("Please fill in all required fields.", true);
    return;
  }
  if (!isValidEmail(email)) {
    showFeedback("Enter a valid email address.", true);
    return;
  }

  els.submitBtn.disabled = true;
  els.submitBtn.textContent = "Sending...";

  try {
    const docRef = await addDoc(collection(db, "contact"), {
      name,
      email,
      subject,
      message,
      user_id: auth.currentUser?.uid || null,
      status: "New",
      created_at: new Date().toISOString(),
    });

    showConfirmation(docRef.id);
  } catch (err) {
    console.error("Failed to send message:", err);
    showFeedback("Something went wrong sending your message. Please try again.", true);
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = "Send Message";
  }
}

function showConfirmation(refId) {
  els.form.hidden = true;
  els.refId.textContent = refId.slice(0, 8).toUpperCase();
  els.confirmation.hidden = false;
}

function resetForm() {
  els.form.reset();
  els.form.hidden = false;
  els.confirmation.hidden = true;
  els.submitBtn.disabled = false;
  els.submitBtn.textContent = "Send Message";
  els.feedback.hidden = true;
}

function showFeedback(message, isError) {
  els.feedback.textContent = message;
  els.feedback.hidden = false;
  els.feedback.classList.toggle("contact-feedback--error", isError);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/* ---------- Live chat (stub) ---------- */

function initLiveChatStub() {
  const btn = document.getElementById("contact-livechat-btn");
  if (!btn) return;
  // Left disabled in the HTML until a real chat provider is wired up.
  // When ready: remove the `disabled` attribute in contact.html and
  // replace this listener with the provider's open/launch call.
  btn.addEventListener("click", () => {
    console.info("Live chat widget not yet connected.");
  });
}
