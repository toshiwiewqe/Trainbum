// ==========================================================
// Trailbound Login Page — Functionality
// ==========================================================
import { auth, db } from "./firebase-init.js";
import {
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
// ADDED: creates users/{uid} on first sign-in, so a new account shows
// up in the admin Users table straight away instead of only once the
// person happens to open account.html. Also seeds their welcome
// notification and logs the sign-up to the dashboard activity feed.
import { ensureUserDoc, touchUser } from "./trailbound-data.js";

document.addEventListener('DOMContentLoaded', () => {
  const emailInput      = document.getElementById('email');
  const passwordInput   = document.getElementById('password');
  const submitBtn       = document.getElementById('submit');
  const rememberCheck   = document.getElementById('check');
  const googleBtn       = document.querySelector('.google-btn');
  const facebookBtn     = document.querySelector('.facebook-btn');

  // ----------------------------------------------------------
  // 1. Remember Me — persist email locally (never store passwords!)
  // ----------------------------------------------------------
  const savedEmail = localStorage.getItem('trailbound_email');
  if (savedEmail) {
    emailInput.value = savedEmail;
    rememberCheck.checked = true;
  }

  // ----------------------------------------------------------
  // 2. Inline validation helpers
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

  // Clear errors as the user types (good UX — don't nag them mid-fix)
  emailInput.addEventListener('input', () => clearError(emailInput));
  passwordInput.addEventListener('input', () => clearError(passwordInput));

  // ----------------------------------------------------------
  // 3. Show/hide password toggle
  //    (requires a button in HTML — see note below the code)
  // ----------------------------------------------------------
  const toggleBtn = document.querySelector('.toggle-password');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      toggleBtn.textContent = isPassword ? 'Hide' : 'Show';
      toggleBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
  }

  // ----------------------------------------------------------
  // 4. Form submission with validation + loading state
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

    if (!valid) return;

    // Remember Me
    if (rememberCheck.checked) {
      localStorage.setItem('trailbound_email', emailInput.value.trim());
    } else {
      localStorage.removeItem('trailbound_email');
    }

    // Loading state
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Logging in...';

    try {
      const user = await loginWithEmail(emailInput.value.trim(), passwordInput.value);
      console.log('Firebase login success:', user);

      // ADDED: make sure this account exists in Firestore before we
      // send them anywhere. Safe to call on every sign-in — it only
      // writes when the profile doesn't exist yet.
      await ensureUserDoc(user);
      touchUser(user).catch(() => {});

      submitBtn.textContent = 'Success!';

      // FIXED: this admin check used to be allowed to throw straight
      // into the outer catch below — e.g. if Firestore security rules
      // don't let a non-admin user READ the admins/{uid} doc (a very
      // common default rule), getDoc() throws permission-denied, the
      // whole try block aborts, and the person is stuck right back on
      // the login page even though sign-in actually succeeded. A
      // secondary "are you an admin?" check should never be able to
      // block the primary "let the user in" flow — if it fails for
      // any reason, just treat them as a non-admin and continue.
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
        // If the person got sent here from a page that required login
        // (e.g. booking.html?trail=T003), send them right back to it
        // instead of always landing on index.html.
        const params = new URLSearchParams(window.location.search);
        const redirectTo = params.get('redirect');
        window.location.href = redirectTo ? decodeURIComponent(redirectTo) : 'index.html';
      }
    } catch (err) {
      // Which field the message lands under matters: "no account" is an
      // email problem, everything else is a password problem.
      const noAccount = err.code === 'auth/user-not-found'
                     || err.code === 'auth/invalid-credential';
      const message = getFriendlyError(err.code) || err.message || 'Login failed. Try again.';
      showError(noAccount ? emailInput : passwordInput, message);
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  });

  // CHANGED: this used to CREATE an account whenever sign-in failed
  // with user-not-found or invalid-credential.
  //
  // That was a quiet hazard. Firebase's email-enumeration protection
  // (on by default since 2023) returns `auth/invalid-credential` for
  // BOTH "no such account" and "wrong password", so the two cases are
  // indistinguishable here — and one typo in the email field silently
  // registered a second account instead of reporting a mistake. People
  // ended up with duplicate profiles and no idea which one held their
  // bookings, and the admin Users table filled with blank-named rows.
  //
  // Registration now happens deliberately on signup.html. This only
  // signs in.
  async function loginWithEmail(email, password) {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  }

  function getFriendlyError(code) {
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
        return 'Incorrect password.';
      // Firebase collapses "no such account" and "wrong password" into
      // this one code on purpose, so an attacker can't use the login
      // form to discover which emails are registered. That means we
      // cannot say which it was either — so name both, and point at
      // sign-up and at the social buttons.
      case 'auth/invalid-credential':
      case 'auth/user-not-found':
        return "We couldn't sign you in with that email and password. "
             + "If you're new, create an account first \u2014 and if you originally "
             + "signed up with Google or Facebook, use that button instead.";
      case 'auth/email-already-in-use':
        return 'That email is already registered with a different password.';
      case 'auth/too-many-requests':
        return 'Too many attempts from this device. Wait a minute and try again.';
      case 'auth/network-request-failed':
        return 'No connection. Check your internet and try again.';
      case 'auth/invalid-email':
        return 'That email address looks invalid.';
      case 'auth/operation-not-allowed':
        return 'Email/password sign-in is not enabled yet in Firebase.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a bit and try again.';
      default:
        return null;
    }
  }

  // ----------------------------------------------------------
  // 5. Google / Phone buttons — hooked up in Part 2 (Firebase)
  // ----------------------------------------------------------
  googleBtn?.addEventListener('click', () => {
    if (typeof signInWithGoogle === 'function') {
      signInWithGoogle();
    } else {
      console.warn('Google auth not connected yet — see Firebase setup guide.');
    }
  });

  facebookBtn?.addEventListener('click', () => {
    if (typeof signInWithFacebook === 'function') {
      signInWithFacebook();
    } else {
      console.warn('Facebook auth not connected yet — see Firebase setup guide.');
    }
  });
});
