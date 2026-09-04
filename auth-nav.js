// ==========================================================
// Swaps the "Log In" nav link for an account icon when signed in.
// Include this on every page that has .site-header-nav
// (index.html, booking.html, account.html, etc.)
// ==========================================================
import { auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

let latestUser = undefined; // undefined = auth state not resolved yet

function applyNavState(user) {
  const nav = document.querySelector('.site-header-nav');
  if (!nav) return false; // header not in the DOM yet

  const loginLink = nav.querySelector('a[href="login.html"]');
  if (!loginLink) return false;

  if (user) {
    loginLink.href = 'account.html';
    loginLink.setAttribute('aria-label', 'My Account');
    loginLink.classList.add('account-icon-link');
    loginLink.innerHTML = getAccountIconHTML(user);

    if (window.location.pathname.endsWith('account.html')) {
      loginLink.classList.add('active');
    }
  } else {
    loginLink.href = 'login.html';
    loginLink.classList.remove('account-icon-link');
    loginLink.removeAttribute('aria-label');
    loginLink.textContent = 'Log In';
  }
  return true;
}

onAuthStateChanged(auth, (user) => {
  latestUser = user;
  applyNavState(user);
});

// The header may be injected asynchronously by header.js AFTER this script
// runs. Watch the DOM and re-apply the nav state once .site-header-nav
// actually appears, so the icon still shows up correctly either way.
const headerRoot = document.getElementById('site-header-root') || document.body;
const observer = new MutationObserver(() => {
  if (latestUser !== undefined && applyNavState(latestUser)) {
    observer.disconnect(); // done — no need to keep watching
  }
});
observer.observe(headerRoot, { childList: true, subtree: true });

function getAccountIconHTML(user) {
  // Use the user's real profile photo if available (Google/Facebook provide one)
  if (user.photoURL) {
    return `<img src="${user.photoURL}" alt="Account" class="nav-avatar-img">`;
  }
  // Fallback: plain circle + person icon for email/password accounts
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="nav-avatar-icon" fill="currentColor">
      <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="12" cy="9.5" r="3.2"/>
      <path d="M5.5 18.5c1.3-2.6 4-4 6.5-4s5.2 1.4 6.5 4c-1.7 1.9-4 3-6.5 3s-4.8-1.1-6.5-3z"/>
    </svg>
  `;
}