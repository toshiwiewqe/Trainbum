import { auth, db, isAdmin } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { attachLogoutConfirm, renderAdminSidebarProfile } from "./admin.js";

const avatarImg      = document.getElementById('admin-avatar');
const avatarFallback = document.getElementById('admin-avatar-fallback');
const nameEl         = document.getElementById('admin-name');
const logoutBtn      = document.getElementById('admin-logout-btn');
const saveBtn        = document.getElementById('save-settings-btn');
const feedbackEl     = document.getElementById('settings-feedback');

attachLogoutConfirm(logoutBtn);

const SETTINGS_DOC = doc(db, 'settings', 'site');

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'admin-login.html'; return; }

  const admin = await isAdmin(user.uid);
  if (!admin) { await signOut(auth); window.location.href = 'admin-login.html'; return; }

  renderAdminSidebarProfile(user, { avatarImg, avatarFallback, nameEl });
  loadSettings();
});

async function loadSettings() {
  try {
    const snap = await getDoc(SETTINGS_DOC);
    if (!snap.exists()) return; // keep the HTML defaults

    const data = snap.data();
    if (data.siteName) document.getElementById('site-name').value = data.siteName;
    if (data.timezone) document.getElementById('site-timezone').value = data.timezone;

    if (data.notifications) {
      document.getElementById('notif-new-bookings').checked = data.notifications.newBookings ?? true;
      document.getElementById('notif-cancellations').checked = data.notifications.cancellations ?? true;
      document.getElementById('notif-new-registrations').checked = data.notifications.newRegistrations ?? true;
      document.getElementById('notif-system-updates').checked = data.notifications.systemUpdates ?? true;
    }
  } catch (err) {
    console.error('Settings load error:', err);
  }
}

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  const originalText = saveBtn.textContent;
  saveBtn.textContent = 'Saving...';

  try {
    await setDoc(SETTINGS_DOC, {
      siteName: document.getElementById('site-name').value.trim(),
      timezone: document.getElementById('site-timezone').value,
      notifications: {
        newBookings: document.getElementById('notif-new-bookings').checked,
        cancellations: document.getElementById('notif-cancellations').checked,
        newRegistrations: document.getElementById('notif-new-registrations').checked,
        systemUpdates: document.getElementById('notif-system-updates').checked
      },
      updatedAt: new Date().toISOString()
    });

    feedbackEl.textContent = 'Settings saved successfully!';
    feedbackEl.hidden = false;
    setTimeout(() => { feedbackEl.hidden = true; }, 2500);
  } catch (err) {
    console.error('Settings save error:', err);
    feedbackEl.textContent = 'Could not save settings. Try again.';
    feedbackEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
});

// "Update Access Keys" is a placeholder — wiring this to something real
// (e.g. rotating an API key) needs a backend endpoint, not client JS.
document.getElementById('update-access-keys-btn')?.addEventListener('click', () => {
  alert('Access key rotation requires a backend endpoint — not yet implemented.');
});