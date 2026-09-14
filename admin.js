import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  getCountFromServer,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ==========================================================
// Admin verification
// ----------------------------------------------------------
// Admin status is NOT something a logged-in user can grant
// themselves from the browser — that would be trivial to fake
// via DevTools. Instead, a top-level Firestore collection
// `admins/{uid}` holds one document per admin, and it can only
// be created by your team directly in the Firebase console (or
// by a trusted backend later). See the setup note at the bottom
// of this file for how to add the first admin.
// ==========================================================
async function isAdmin(uid) {
  const snap = await getDoc(doc(db, 'admins', uid));
  return snap.exists();
}

const onLoginPage = document.body.classList.contains('admin-auth-body');
const onDashboardPage = document.body.classList.contains('admin-dashboard-page');

// ==========================================================
// LOGIN PAGE LOGIC
// ==========================================================
if (onLoginPage) {
  const emailInput   = document.getElementById('admin-email');
  const passwordInput = document.getElementById('admin-password');
  const loginBtn     = document.getElementById('admin-secure-login-btn');
  const googleBtn    = document.getElementById('admin-google-btn');
  const errorEl      = document.getElementById('admin-login-error');
  const toggleBtn    = document.getElementById('toggle-password');

  toggleBtn.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
  });

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.hidden = true;
  }

  // Shared step after ANY successful Firebase sign-in attempt:
  // confirm the account is actually listed as an admin before
  // letting them into the dashboard.
  async function handlePostLogin(user) {
    const admin = await isAdmin(user.uid);
    if (admin) {
      window.location.href = 'admin-dashboard.html';
    } else {
      showError('This account is not authorized for admin access.');
      await signOut(auth);
    }
  }

  loginBtn.addEventListener('click', async () => {
    clearError();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showError('Enter both email and password.');
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in...';

    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      await handlePostLogin(result.user);
    } catch (err) {
      console.error('Admin login error:', err.code, err.message);
      showError('Incorrect email or password.');
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = 'Secure Login <span aria-hidden="true">›</span>';
    }
  });

  googleBtn.addEventListener('click', async () => {
    clearError();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
      const result = await signInWithPopup(auth, provider);
      await handlePostLogin(result.user);
    } catch (err) {
      console.error('Admin Google login error:', err.code, err.message);
      showError('Google sign-in failed. Please try again.');
    }
  });
}

// ==========================================================
// DASHBOARD PAGE LOGIC
// ==========================================================
if (onDashboardPage) {
  const avatarImg      = document.getElementById('admin-avatar');
  const avatarFallback = document.getElementById('admin-avatar-fallback');
  const nameEl         = document.getElementById('admin-name');
  const logoutBtn      = document.getElementById('admin-logout-btn');
  const searchInput    = document.querySelector('.admin-search-wrap input');
  const trendRange     = document.getElementById('trend-range');
  const exportBtn      = document.querySelector('.admin-export-btn');
  const exportModal    = document.getElementById('export-modal');
  const exportBackdrop = document.getElementById('export-modal-backdrop');
  let bookingChart;

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'admin-login.html';
      return;
    }

    const admin = await isAdmin(user.uid);
    if (!admin) {
      // Someone reached this page while logged in as a regular
      // (non-admin) account — kick them out immediately.
      await signOut(auth);
      window.location.href = 'admin-login.html';
      return;
    }

    renderAdminProfile(user);
    loadStats();
    loadBookingTrendsChart();
    loadTopTrails();
    loadRecentActivity();
  });

  function filterDashboard(queryText) {
    const query = queryText.trim().toLowerCase();
    document.querySelectorAll('.admin-top-trail-item, #recent-activity-body tr').forEach((item) => {
      item.hidden = Boolean(query && !item.textContent.toLowerCase().includes(query));
    });
  }

  searchInput?.addEventListener('input', () => filterDashboard(searchInput.value));
  trendRange?.addEventListener('change', () => loadBookingTrendsChart(trendRange.value));

  function closeExportModal() {
    exportModal.hidden = true;
    exportBackdrop.hidden = true;
  }

  exportBtn?.addEventListener('click', () => {
    exportModal.hidden = false;
    exportBackdrop.hidden = false;
  });
  document.getElementById('export-modal-close')?.addEventListener('click', closeExportModal);
  document.getElementById('export-modal-cancel')?.addEventListener('click', closeExportModal);
  exportBackdrop?.addEventListener('click', closeExportModal);

  document.querySelectorAll('.admin-export-option').forEach((option) => {
    option.addEventListener('click', () => {
      document.querySelectorAll('.admin-export-option').forEach((item) => item.classList.remove('is-selected'));
      option.classList.add('is-selected');
    });
  });
  document.querySelectorAll('.admin-export-formats button').forEach((format) => {
    format.addEventListener('click', () => {
      document.querySelectorAll('.admin-export-formats button').forEach((item) => item.classList.remove('is-selected'));
      format.classList.add('is-selected');
    });
  });
  document.getElementById('export-modal-submit')?.addEventListener('click', () => {
    const category = document.querySelector('.admin-export-option.is-selected')?.dataset.category || 'overview';
    const format = document.querySelector('.admin-export-formats .is-selected')?.dataset.format || 'csv';
    if (format !== 'csv') {
      window.alert(`${format.toUpperCase()} export is not available yet. CSV has been selected instead.`);
    }
    const rows = [
      ['Trailbound Admin Report', category],
      ['Total Users', document.getElementById('stat-total-users').textContent],
      ['Active Bookings', document.getElementById('stat-active-bookings').textContent],
      ['Total Revenue', document.getElementById('stat-total-revenue').textContent],
      ['Average Rating', document.getElementById('stat-avg-rating').textContent]
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = `trailbound-${category}-report.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    closeExportModal();
  });

  function renderAdminProfile(user) {
    nameEl.textContent = user.displayName || user.email || 'Admin';

    if (user.photoURL) {
      avatarImg.referrerPolicy = 'no-referrer';
      avatarImg.onerror = () => {
        avatarImg.hidden = true;
        avatarFallback.hidden = false;
      };
      avatarImg.src = user.photoURL;
      avatarImg.hidden = false;
      avatarFallback.hidden = true;
    } else {
      avatarImg.hidden = true;
      avatarFallback.hidden = false;
      avatarFallback.textContent = (user.displayName || user.email || '?').charAt(0).toUpperCase();
    }
  }

  logoutBtn.addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'admin-login.html';
  });

  // ---- Stat cards ----
  async function loadStats() {
    // Total Users: real count from the `users` collection.
    try {
      const usersCountSnap = await getCountFromServer(collection(db, 'users'));
      document.getElementById('stat-total-users').textContent = usersCountSnap.data().count.toLocaleString();
    } catch (err) {
      console.error('Total users count error:', err);
      document.getElementById('stat-total-users').textContent = 'N/A';
    }

    // Active Bookings / Total Revenue: these need a `bookings`
    // collection with fields like { status, price }. Once
    // booking.js writes real bookings to Firestore, point these
    // queries at that collection. For now this degrades gracefully
    // to 0 if the collection doesn't exist yet.
    try {
      const bookingsSnap = await getDocs(collection(db, 'bookings'));
      const bookings = bookingsSnap.docs.map(d => d.data());
      const active = bookings.filter(b => b.status === 'active' || b.status === 'confirmed').length;
      const revenue = bookings.reduce((sum, b) => sum + (Number(b.price) || 0), 0);

      document.getElementById('stat-active-bookings').textContent = active.toLocaleString();
      document.getElementById('stat-total-revenue').textContent = '₱' + revenue.toLocaleString();
    } catch (err) {
      console.error('Bookings stats error:', err);
      document.getElementById('stat-active-bookings').textContent = '0';
      document.getElementById('stat-total-revenue').textContent = '₱0';
    }

    // Avg Rating: placeholder until a `reviews` collection exists.
    document.getElementById('stat-avg-rating').textContent = '—';
    document.getElementById('stat-avg-rating-stars').textContent = '';
  }

  // ---- Booking trends chart ----
  async function loadBookingTrendsChart(range = 'Last 7 Days') {
    const ctx = document.getElementById('booking-trends-chart');
    if (!ctx || typeof Chart === 'undefined') return;

    // TODO: replace with real per-day booking counts once bookings
    // are written with a timestamp field. Placeholder data below
    // keeps the chart visually functional in the meantime.
    const labels = range === 'Last 30 Days'
      ? ['1', '5', '10', '15', '20', '25', '30']
      : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const data = labels.map(() => 0);

    bookingChart?.destroy();
    bookingChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data,
          borderColor: '#ff5a45',
          backgroundColor: 'rgba(255, 90, 69, 0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 3
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(245,239,233,0.5)' } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(245,239,233,0.5)' } }
        }
      }
    });
  }

  // ---- Top trails ----
  async function loadTopTrails() {
    const el = document.getElementById('top-trails-list');
    try {
      // Adjust this to match wherever trail data actually lives
      // (e.g. a `trails` collection with a `bookingCount` field).
      const snap = await getDocs(query(collection(db, 'trails'), orderBy('bookingCount', 'desc'), limit(3)));

      if (snap.empty) {
        el.innerHTML = '<p class="admin-empty">No trail data yet.</p>';
        return;
      }

      el.innerHTML = '';
      snap.forEach(docSnap => {
        const t = docSnap.data();
        const item = document.createElement('div');
        item.className = 'admin-top-trail-item';
        item.innerHTML = `
          <img src="${t.image || ''}" alt="" class="admin-top-trail-img">
          <div class="admin-top-trail-info">
            <p class="admin-top-trail-name">${t.name || 'Untitled trail'}</p>
            <p class="admin-top-trail-meta">${t.bookingCount || 0} bookings</p>
          </div>
        `;
        el.appendChild(item);
      });
    } catch (err) {
      console.error('Top trails load error:', err);
      el.innerHTML = '<p class="admin-empty">No trail data yet.</p>';
    }
  }

  // ---- Recent activity ----
  async function loadRecentActivity() {
    const tbody = document.getElementById('recent-activity-body');
    try {
      // Adjust this to match your real activity/audit log collection
      // once one exists (e.g. written whenever a booking or account
      // event happens).
      const snap = await getDocs(query(collection(db, 'activity'), orderBy('createdAt', 'desc'), limit(10)));

      if (snap.empty) {
        tbody.innerHTML = '<tr><td colspan="5" class="admin-empty">No recent activity yet.</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      snap.forEach(docSnap => {
        const a = docSnap.data();
        const statusClass = a.status === 'completed' ? 'admin-status-badge--completed'
          : a.status === 'pending' ? 'admin-status-badge--pending'
          : 'admin-status-badge--system';
        const time = a.createdAt?.toDate
          ? timeAgo(a.createdAt.toDate())
          : '';

        const row = document.createElement('tr');
        row.innerHTML = `
          <td><div class="admin-activity-user"><img src="${a.userPhoto || ''}" class="admin-activity-avatar" alt="">${a.userName || 'Unknown'}</div></td>
          <td>${a.activity || ''}</td>
          <td>${a.amount ? '₱' + a.amount : '—'}</td>
          <td><span class="admin-status-badge ${statusClass}">${a.status || ''}</span></td>
          <td>${time}</td>
        `;
        tbody.appendChild(row);
      });
    } catch (err) {
      console.error('Recent activity load error:', err);
      tbody.innerHTML = '<tr><td colspan="5" class="admin-empty">No recent activity yet.</td></tr>';
    }
  }

  function timeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
}

// ==========================================================
// Shared sidebar profile renderer
// ----------------------------------------------------------
// Used by the other admin pages (bookings, users, settings) to
// populate the sidebar avatar/name. The dashboard above keeps its
// own local renderAdminProfile untouched to avoid any risk to its
// existing behavior — this export exists for the OTHER pages.
// ==========================================================
export function renderAdminSidebarProfile(user, { avatarImg, avatarFallback, nameEl }) {
  nameEl.textContent = user.displayName || user.email || 'Admin';

  if (user.photoURL) {
    avatarImg.referrerPolicy = 'no-referrer';
    avatarImg.onerror = () => {
      avatarImg.hidden = true;
      avatarFallback.hidden = false;
    };
    avatarImg.src = user.photoURL;
    avatarImg.hidden = false;
    avatarFallback.hidden = true;
  } else {
    avatarImg.hidden = true;
    avatarFallback.hidden = false;
    avatarFallback.textContent = (user.displayName || user.email || '?').charAt(0).toUpperCase();
  }
}

// ==========================================================
// Shared logout confirmation modal
// ----------------------------------------------------------
// Built dynamically and reused on the other admin pages. The
// dashboard's own logout button above still signs out immediately
// without this modal — left that way to avoid touching working
// code. Swap it in later with attachLogoutConfirm(logoutBtn) if
// you want the dashboard to match too.
// ==========================================================
export function attachLogoutConfirm(logoutBtn) {
  if (!logoutBtn) return;

  logoutBtn.addEventListener('click', () => {
    let backdrop = document.getElementById('logout-modal-backdrop');
    let modal = document.getElementById('logout-modal');

    if (!modal) {
      backdrop = document.createElement('div');
      backdrop.className = 'admin-modal-backdrop';
      backdrop.id = 'logout-modal-backdrop';

      modal = document.createElement('section');
      modal.className = 'admin-modal admin-logout-modal';
      modal.id = 'logout-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = `
        <div class="admin-logout-icon">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>
        </div>
        <h2>Log Out</h2>
        <p>Are you sure you want to log out of your account?</p>
        <button type="button" class="admin-logout-confirm-btn" id="logout-confirm-btn">Log Out</button>
        <button type="button" class="admin-logout-cancel-btn" id="logout-cancel-btn">Cancel</button>
        <p class="admin-logout-footer">Trailbound Secure Exit</p>
      `;

      document.body.appendChild(backdrop);
      document.body.appendChild(modal);

      const close = () => { backdrop.hidden = true; modal.hidden = true; };
      backdrop.addEventListener('click', close);
      modal.querySelector('#logout-cancel-btn').addEventListener('click', close);
      modal.querySelector('#logout-confirm-btn').addEventListener('click', async () => {
        await signOut(auth);
        window.location.href = 'admin-login.html';
      });
    }

    backdrop.hidden = false;
    modal.hidden = false;
  });
}

// ==========================================================
// SETUP NOTE — adding your first admin
// ----------------------------------------------------------
// 1. Log in normally as a regular user once (via login.html),
//    so a Firebase Auth account exists for you.
// 2. Copy your UID: Firebase console → Authentication → Users
//    → find your email → copy the "User UID" column.
// 3. Firestore Database → Start collection → collection ID: admins
//    → Document ID: paste your UID → add any field, e.g.
//    role: "admin" (string) → Save.
// 4. Now signing in on admin-login.html with that account will
//    pass the isAdmin() check and reach the dashboard.
//
// Also add these Firestore rules so the admins collection is
// readable only by the user checking their own doc, and never
// writable from the client at all:
//
// match /admins/{uid} {
//   allow read: if request.auth != null && request.auth.uid == uid;
//   allow write: if false;
// }
// ==========================================================