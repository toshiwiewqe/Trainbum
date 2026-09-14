import { auth, db, isAdmin } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, getDocs, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { attachLogoutConfirm, renderAdminSidebarProfile } from "./admin.js";

const avatarImg      = document.getElementById('admin-avatar');
const avatarFallback = document.getElementById('admin-avatar-fallback');
const nameEl         = document.getElementById('admin-name');
const logoutBtn      = document.getElementById('admin-logout-btn');
const roleFilter      = document.getElementById('user-role-filter');
const searchInput     = document.getElementById('user-search');
const editModal       = document.getElementById('edit-user-modal');
const editBackdrop    = document.getElementById('edit-user-backdrop');
const editRole        = document.getElementById('edit-user-role');
let editingUser = null;

attachLogoutConfirm(logoutBtn);

let allUsers = [];
let adminUidSet = new Set();

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'admin-login.html'; return; }

  const admin = await isAdmin(user.uid);
  if (!admin) { await signOut(auth); window.location.href = 'admin-login.html'; return; }

  renderAdminSidebarProfile(user, { avatarImg, avatarFallback, nameEl });
  loadUsers();
});

async function loadUsers() {
  try {
    // Cross-reference against the admins collection so real admins
    // show a Super Admin badge instead of the default Customer badge.
    const adminsSnap = await getDocs(collection(db, 'admins'));
    adminUidSet = new Set(adminsSnap.docs.map(d => d.id));

    const usersSnap = await getDocs(collection(db, 'users'));
    allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const countSnap = await getCountFromServer(collection(db, 'users'));
    document.getElementById('user-total').textContent = countSnap.data().count.toLocaleString();
  } catch (err) {
    console.error('Users load error:', err);
    allUsers = [];
    document.getElementById('user-total').textContent = '0';
  }

  // "Active" / "New Registrations" / "Average Session" need dedicated
  // tracking fields (lastActiveAt, createdAt with a real timestamp,
  // session logs) that don't exist in the current schema — these are
  // placeholders until that data is captured elsewhere in the app.
  document.getElementById('user-active').textContent = allUsers.length.toLocaleString();
  document.getElementById('user-new').textContent = '—';
  document.getElementById('user-session').textContent = '—';

  renderTable();
}

function getInitials(name, email) {
  const source = name || email || '?';
  return source.trim().charAt(0).toUpperCase();
}

function renderTable() {
  const tbody = document.getElementById('user-list');
  const filter = roleFilter.value;
  const searchTerm = (searchInput.value || '').toLowerCase();

  const rows = allUsers
    .map(u => ({ ...u, role: adminUidSet.has(u.id) ? 'admin' : (u.role || 'customer') }))
    .filter(u => {
      const matchesRole = filter === 'all' || u.role === filter;
      const matchesSearch = !searchTerm ||
        (u.displayName || '').toLowerCase().includes(searchTerm) ||
        (u.email || '').toLowerCase().includes(searchTerm);
      return matchesRole && matchesSearch;
    });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="admin-empty">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  rows.forEach(u => {
    const roleLabel = u.role === 'admin' ? 'Super Admin' : u.role === 'editor' ? 'Editor' : 'Customer';
    const roleClass = u.role === 'admin' ? 'admin-role-badge--admin' : u.role === 'editor' ? 'admin-role-badge--editor' : '';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>
        ${u.photoURL
          ? `<img src="${u.photoURL}" class="admin-table-avatar" alt="">`
          : `<div class="admin-table-avatar" style="display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:#1a0401;">${getInitials(u.displayName, u.email)}</div>`}
      </td>
      <td>
        ${u.displayName || 'Unnamed'}
        <div class="admin-table-subtext">${u.email || ''}</div>
      </td>
      <td><span class="admin-role-badge ${roleClass}">${roleLabel}</span></td>
      <td><span class="admin-status-badge admin-status-badge--confirmed">Active</span></td>
      <td>
        <div class="admin-actions-cell">
          <button class="admin-icon-btn" type="button" aria-label="Edit user">✎</button>
          <button class="admin-icon-btn" type="button" aria-label="Delete user">🗑</button>
        </div>
      </td>
    `;
    row.querySelector('[aria-label="Edit user"]').addEventListener('click', () => openEditUser(u));
    tbody.appendChild(row);
  });
}

function openEditUser(user) {
  editingUser = user;
  document.getElementById('edit-user-name').textContent = user.displayName || 'Unnamed';
  document.getElementById('edit-user-email').textContent = user.email || '';
  document.getElementById('edit-user-avatar').textContent = getInitials(user.displayName, user.email);
  editRole.value = user.role;
  editModal.hidden = false;
  editBackdrop.hidden = false;
}

function closeEditUser() {
  editModal.hidden = true;
  editBackdrop.hidden = true;
  editingUser = null;
}

document.getElementById('edit-user-close')?.addEventListener('click', closeEditUser);
document.getElementById('edit-user-cancel')?.addEventListener('click', closeEditUser);
editBackdrop?.addEventListener('click', closeEditUser);
document.getElementById('edit-user-save')?.addEventListener('click', () => {
  if (!editingUser) return;
  editingUser.role = editRole.value;
  if (editingUser.role === 'admin') adminUidSet.add(editingUser.id);
  else adminUidSet.delete(editingUser.id);
  closeEditUser();
  renderTable();
});

roleFilter?.addEventListener('change', renderTable);
searchInput?.addEventListener('input', renderTable);