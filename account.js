import { auth } from "./firebase-init.js";
import {
  onAuthStateChanged,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const avatarImg      = document.getElementById('account-avatar');
const avatarFallback = document.getElementById('account-avatar-fallback');
const nameEl         = document.getElementById('account-name');
const emailEl        = document.getElementById('account-email');
const memberSinceEl  = document.getElementById('account-member-since');
const nameInput      = document.getElementById('display-name-input');
const saveBtn        = document.getElementById('save-name-btn');
const feedbackEl     = document.getElementById('account-feedback');
const logoutBtn      = document.getElementById('logout-btn');

function getInitials(name, email) {
  const source = name || email || '?';
  return source.trim().charAt(0).toUpperCase();
}

function renderUser(user) {
  const displayName = user.displayName || 'Trailbound Hiker';

  nameEl.textContent = displayName;
  emailEl.textContent = user.email || '';
  nameInput.value = user.displayName || '';

  if (user.metadata?.creationTime) {
    const date = new Date(user.metadata.creationTime);
    memberSinceEl.textContent = 'Member since ' + date.toLocaleDateString('en-US', {
      month: 'long', year: 'numeric'
    });
  }

  if (user.photoURL) {
    avatarImg.src = user.photoURL;
    avatarImg.hidden = false;
    avatarFallback.hidden = true;
  } else {
    avatarImg.hidden = true;
    avatarFallback.hidden = false;
    avatarFallback.textContent = getInitials(user.displayName, user.email);
  }
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // Not logged in — send back to login page
    window.location.href = 'login.html';
    return;
  }
  renderUser(user);
});

saveBtn.addEventListener('click', async () => {
  const newName = nameInput.value.trim();
  if (!newName) {
    showFeedback('Display name cannot be empty.', true);
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    await updateProfile(auth.currentUser, { displayName: newName });
    nameEl.textContent = newName;
    avatarFallback.textContent = getInitials(newName, auth.currentUser.email);
    showFeedback('Saved!', false);
  } catch (err) {
    console.error('Profile update error:', err);
    showFeedback('Could not save changes. Try again.', true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
});

function showFeedback(message, isError) {
  feedbackEl.textContent = message;
  feedbackEl.hidden = false;
  feedbackEl.classList.toggle('account-feedback--error', isError);
  setTimeout(() => { feedbackEl.hidden = true; }, 2500);
}

logoutBtn.addEventListener('click', async () => {
  try {
    await signOut(auth);
    window.location.href = 'index.html';
  } catch (err) {
    console.error('Sign out error:', err);
  }
});