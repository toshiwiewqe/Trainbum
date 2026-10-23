// ==========================================================
// Swaps the "Log In" nav link for an account icon when signed in.
// Include this on every page that has .site-header-nav
// (index.html, booking.html, account.html, etc.)
//
// ADDED: a guide also gets a "My Schedule" link next to it. Without
// one, a guide who is already signed in and sitting on the homepage
// has no way to reach guide.html except by typing the address —
// the login redirect only helps at the moment they sign in.
// ==========================================================
import { auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
// One document read, no linking — see the note on isLinkedGuide().
import { isLinkedGuide } from "./guide-account.js";

let latestUser = undefined; // undefined = auth state not resolved yet
let isGuide = false;        // ADDED — stays false until we know otherwise

function applyNavState(user) {
  const nav = document.querySelector('.site-header-nav');
  if (!nav) return false; // header not in the DOM yet

  const loginLink = nav.querySelector('a[href="login.html"], a[href="account.html"]');
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

  applyGuideLink(nav, loginLink, Boolean(user) && isGuide);
  return true;
}

// ADDED. Sits just before the account icon, so it reads as part of
// the signed-in group rather than another site link. Plain <a>, no
// classes — it picks up the header's own nav-link styling.
function applyGuideLink(nav, beforeEl, show) {
  const existing = nav.querySelector('a[href="guide.html"]');

  if (!show) {
    existing?.remove();
    return;
  }
  if (existing) return; // already there

  const link = document.createElement('a');
  link.href = 'guide.html';
  link.textContent = 'My Schedule';
  if (window.location.pathname.endsWith('guide.html')) {
    link.classList.add('active');
  }
  beforeEl.parentNode.insertBefore(link, beforeEl);
}

onAuthStateChanged(auth, (user) => {
  latestUser = user;
  isGuide = false;        // a different person may have just signed in
  applyNavState(user);

  if (!user) return;

  // ADDED. Async, so the nav is painted once immediately and again if
  // this turns out to be a guide. Never allowed to throw into the
  // header — a failed lookup just means no extra link.
  isLinkedGuide(user.uid)
    .then((result) => {
      isGuide = result;
      if (result) applyNavState(user);
    })
    .catch(() => {});
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
  // Use the user's real profile photo if available (Google provides one)
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
