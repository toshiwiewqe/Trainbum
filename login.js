// ==========================================================
// Trailbound Login Page — Functionality
// ==========================================================

document.addEventListener('DOMContentLoaded', () => {
  const form            = document.querySelector('.login-box');
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
      // TODO: replace with your real login call, e.g.:
      // await loginWithEmail(emailInput.value.trim(), passwordInput.value);
      await mockLoginRequest(emailInput.value.trim(), passwordInput.value);

      submitBtn.textContent = 'Success!';
      window.location.href = 'index.html';
    } catch (err) {
      showError(passwordInput, err.message || 'Login failed. Try again.');
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  });

  // Placeholder — remove once you wire up a real backend
  function mockLoginRequest(email, password) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log('Mock login attempt:', { email, password: '••••••' });
        resolve();
      }, 1000);
    });
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