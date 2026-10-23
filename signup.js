// ==========================================================
// Trailbound Sign Up Page — Functionality
// ==========================================================
import { auth, db } from "./firebase-init.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
// Creates users/{uid} right away so a new account shows up in the
// admin Users table immediately instead of only once the person
// happens to open account.html.
import { ensureUserDoc, touchUser } from "./trailbound-data.js";

document.addEventListener('DOMContentLoaded', () => {
  const emailInput           = document.getElementById('email');
  const passwordInput        = document.getElementById('password');
  const confirmPasswordInput = document.getElementById('confirm-password');
  const submitBtn             = document.getElementById('submit');
  const googleBtn             = document.querySelector('.google-btn');

  // ----------------------------------------------------------
  // 1. Inline validation helpers (same pattern as login.js)
  // ----------------------------------------------------------
  function showError(input, message) {
    clearError(input);
    input.classList.add('input-error-state');

    const errorEl = document.createElement('span');
    errorEl.className = 'input-error visible';
    errorEl.textContent = message;
    errorEl.dataset.errorFor = input.id;

    input.closest('.input-box').appendChild(errorEl);
  }

  function clearError(input) {
    input.classList.remove('input-error-state');
    const existing = input.closest('.input-box').querySelector('.input-error');
    if (existing) existing.remove();
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  emailInput.addEventListener('input', () => clearError(emailInput));
  passwordInput.addEventListener('input', () => clearError(passwordInput));
  confirmPasswordInput.addEventListener('input', () => clearError(confirmPasswordInput));

  // ----------------------------------------------------------
  // 2. Form submission
  // ----------------------------------------------------------
  submitBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    let valid = true;

    if (!emailInput.value.trim()) {
      showError(emailInput, 'Email is required.');
      valid = false;
    } else if (!isValidEmail(emailInput.value.trim())) {
      showError(emailInput, 'Enter a valid email address.');
      valid = false;
    }

    if (!passwordInput.value) {
      showError(passwordInput, 'Password is required.');
      valid = false;
    } else if (passwordInput.value.length < 6) {
      showError(passwordInput, 'Password must be at least 6 characters.');
      valid = false;
    }

    if (!confirmPasswordInput.value) {
      showError(confirmPasswordInput, 'Please confirm your password.');
      valid = false;
    } else if (passwordInput.value && confirmPasswordInput.value !== passwordInput.value) {
      showError(confirmPasswordInput, 'Passwords do not match.');
      valid = false;
    }

    if (!valid) return;

    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Signing up...';

    try {
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      const result = await createUserWithEmailAndPassword(auth, email, password);
      const user = result.user;
      console.log('Firebase sign-up success:', user);

      await ensureUserDoc(user);
      touchUser(user).catch(() => {});

      submitBtn.textContent = 'Success!';

      // Defensive, same reasoning as login.js: a failed admin check
      // should never strand a freshly created user on this page.
      let isUserAdmin = false;
      try {
        const adminSnapshot = await getDoc(doc(db, 'admins', user.uid));
        isUserAdmin = adminSnapshot.exists();
      } catch (adminCheckErr) {
        console.warn('Admin check failed (continuing as non-admin):', adminCheckErr);
      }

      if (isUserAdmin) {
        window.location.href = 'admin-dashboard.html';
      } else {
        const params = new URLSearchParams(window.location.search);
        const redirectTo = params.get('redirect');
        window.location.href = redirectTo ? decodeURIComponent(redirectTo) : 'index.html';
      }
    } catch (err) {
      showError(passwordInput, getFriendlyError(err.code) || err.message || 'Sign up failed. Try again.');
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  });

  function getFriendlyError(code) {
    switch (code) {
      case 'auth/email-already-in-use':
        return 'That email already has an account — try logging in instead, or use Google below if you signed up that way.';
      case 'auth/weak-password':
        return 'Password should be at least 6 characters.';
      case 'auth/invalid-email':
        return 'That email address looks invalid.';
      case 'auth/operation-not-allowed':
        return 'Email/password sign-up is not enabled yet in Firebase.';
      default:
        return null;
    }
  }

  // ----------------------------------------------------------
  // 3. Google sign-up
  // ----------------------------------------------------------
  googleBtn?.addEventListener('click', () => {
    if (typeof signInWithGoogle === 'function') {
      signInWithGoogle();
    } else {
      console.warn('Google auth not connected yet — see Firebase setup guide.');
    }
  });

});
