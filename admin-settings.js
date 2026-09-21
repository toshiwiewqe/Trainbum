/* ==========================================================
   Admin — Settings
   ----------------------------------------------------------
   settings/site is read by BOTH sides. The public pages load
   site-settings.js, which watches this same document, so saving
   here updates the site name and timezone on the customer-facing
   site without a deploy.
   ========================================================== */

import {
  attachLogoutConfirm,
  collectUnsubscribers,
  renderAdminSidebarProfile,
  requireAdmin,
  saveSettings,
  watchSettings
} from "./trailbound-data.js";

const track = collectUnsubscribers();

const el = {
  avatarImg: document.getElementById("admin-avatar"),
  avatarFallback: document.getElementById("admin-avatar-fallback"),
  nameEl: document.getElementById("admin-name"),
  logoutBtn: document.getElementById("admin-logout-btn"),
  saveBtn: document.getElementById("save-settings-btn"),
  feedback: document.getElementById("settings-feedback"),
  siteName: document.getElementById("site-name"),
  timezone: document.getElementById("site-timezone"),
  notifNewBookings: document.getElementById("notif-new-bookings"),
  notifCancellations: document.getElementById("notif-cancellations"),
  notifNewRegistrations: document.getElementById("notif-new-registrations"),
  notifSystemUpdates: document.getElementById("notif-system-updates")
};

/** True while the admin is mid-edit, so the live stream doesn't stomp the form. */
let dirty = false;
/** Last values Firestore sent us — the "before" side of the audit diff. */
let saved = null;

attachLogoutConfirm(el.logoutBtn);

requireAdmin((user) => {
  renderAdminSidebarProfile(user, {
    avatarImg: el.avatarImg,
    avatarFallback: el.avatarFallback,
    nameEl: el.nameEl
  });

  track(
    watchSettings((settings) => {
      // Kept so the next save can log what actually changed rather
      // than just "settings updated".
      saved = settings;
      if (dirty) return;
      applyToForm(settings);
    })
  );
});

function applyToForm(settings) {
  el.siteName.value = settings.siteName;
  el.timezone.value = settings.timezone;
  el.notifNewBookings.checked = settings.notifications.newBookings;
  el.notifCancellations.checked = settings.notifications.cancellations;
  el.notifNewRegistrations.checked = settings.notifications.newRegistrations;
  el.notifSystemUpdates.checked = settings.notifications.systemUpdates;
}

// Any edit marks the form dirty so incoming snapshots wait their turn.
document
  .querySelectorAll(".admin-settings-grid input, .admin-settings-grid select, .admin-settings-notifications input")
  .forEach((input) => input.addEventListener("change", () => (dirty = true)));
el.siteName?.addEventListener("input", () => (dirty = true));

function showFeedback(message, isError = false) {
  if (!el.feedback) return;
  el.feedback.textContent = message;
  el.feedback.hidden = false;
  el.feedback.classList.toggle("admin-settings-feedback--error", isError);
  if (!isError) setTimeout(() => (el.feedback.hidden = true), 2500);
}

el.saveBtn?.addEventListener("click", async () => {
  el.saveBtn.disabled = true;
  const originalText = el.saveBtn.textContent;
  el.saveBtn.textContent = "Saving...";

  try {
    await saveSettings(
      {
        siteName: el.siteName.value.trim(),
        timezone: el.timezone.value,
        notifications: {
          newBookings: el.notifNewBookings.checked,
          cancellations: el.notifCancellations.checked,
          newRegistrations: el.notifNewRegistrations.checked,
          systemUpdates: el.notifSystemUpdates.checked
        }
      },
      saved
    );
    dirty = false;
    showFeedback("Settings saved — the public site picked them up.");
  } catch (err) {
    console.error("Settings save error:", err);
    showFeedback("Could not save settings. Check your Firestore rules.", true);
  } finally {
    el.saveBtn.disabled = false;
    el.saveBtn.textContent = originalText;
  }
});

// Rotating an API key means touching a secret, which cannot happen in a
// browser without exposing it. This needs a Cloud Function or a server.
document.getElementById("update-access-keys-btn")?.addEventListener("click", () => {
  window.alert(
    "Access key rotation needs a backend endpoint (a Cloud Function), not client JavaScript — " +
      "a key rotated in the browser would be visible to anyone with DevTools open."
  );
});