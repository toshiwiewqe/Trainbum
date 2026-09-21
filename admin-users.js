/* ==========================================================
   Admin — Users
   ----------------------------------------------------------
   Live stream of the `users` collection, cross-referenced against
   `admins` so real admins show the Super Admin badge.

   Two behaviour fixes vs the old version:

   1. Saving a role now actually WRITES to Firestore. Before, it
      only changed a local variable, so the change vanished on
      refresh and the customer never saw it.

   2. "Active users" and "New registrations" are computed from
      real lastActiveAt / createdAt stamps, which the data layer
      now writes on every sign-in, instead of being placeholders.

   Note on the delete button: a browser cannot delete a Firebase
   Auth account — that needs the Admin SDK on a server. It
   disables the profile instead, which the user-side guard honours.
   ========================================================== */

import {
  attachLogoutConfirm,
  collectUnsubscribers,
  describeError,
  escapeHtml,
  renderAdminSidebarProfile,
  requireAdmin,
  setUserRole,
  toDate,
  updateUserProfile,
  watchUsers
} from "./trailbound-data.js";

const track = collectUnsubscribers();

const el = {
  avatarImg: document.getElementById("admin-avatar"),
  avatarFallback: document.getElementById("admin-avatar-fallback"),
  nameEl: document.getElementById("admin-name"),
  logoutBtn: document.getElementById("admin-logout-btn"),
  roleFilter: document.getElementById("user-role-filter"),
  search: document.getElementById("user-search"),
  list: document.getElementById("user-list"),
  modal: document.getElementById("edit-user-modal"),
  backdrop: document.getElementById("edit-user-backdrop"),
  role: document.getElementById("edit-user-role"),
  saveBtn: document.getElementById("edit-user-save"),
  panel: document.querySelector(".admin-users-panel")
};

let users = [];
let editingUser = null;
/** null = still loading, "" = loaded fine, otherwise the reason it failed. */
let loadProblem = null;

attachLogoutConfirm(el.logoutBtn);

requireAdmin((user) => {
  renderAdminSidebarProfile(user, {
    avatarImg: el.avatarImg,
    avatarFallback: el.avatarFallback,
    nameEl: el.nameEl
  });

  track(
    watchUsers(
      (items) => {
        loadProblem = "";
        users = items;
        renderStats();
        renderTable();
      },
      {
        // Without this the page rendered "No users found." whether the
        // collection was genuinely empty or Firestore refused the read —
        // two very different problems with one misleading message.
        onError: (err, which) => {
          if (which === "users") {
            loadProblem = describeError(err);
            users = [];
            renderStats();
            renderTable();
          } else {
            console.warn("Admin badges unavailable:", err?.code);
          }
        }
      }
    )
  );
});

/** A banner above the table, created on demand so the HTML needs no change. */
function showProblem(html) {
  let box = document.getElementById("user-load-problem");
  if (!box) {
    box = document.createElement("p");
    box.id = "user-load-problem";
    box.className = "admin-product-feedback";
    el.panel?.parentNode?.insertBefore(box, el.panel);
  }
  box.innerHTML = html;
  box.hidden = false;
}

function clearProblem() {
  const box = document.getElementById("user-load-problem");
  if (box) box.hidden = true;
}

/* ---------- stats ---------- */

const DAY = 24 * 60 * 60 * 1000;

function renderStats() {
  const now = Date.now();
  const activeCount = users.filter((u) => {
    const seen = toDate(u.lastActiveAt);
    return seen && now - seen.getTime() < 30 * DAY;
  }).length;

  const newCount = users.filter((u) => {
    const joined = toDate(u.createdAt);
    return joined && now - joined.getTime() < DAY;
  }).length;

  setText("user-total", users.length.toLocaleString());
  setText("user-active", activeCount.toLocaleString());
  setText("user-new", newCount.toLocaleString());
  setText("user-session", users.filter((u) => u.disabled).length.toLocaleString());

  const sessionLabel = document.querySelector("#user-session")?.previousElementSibling;
  if (sessionLabel) sessionLabel.textContent = "Disabled Accounts";
  const sessionDelta = document.querySelector("#user-session")?.nextElementSibling;
  if (sessionDelta) sessionDelta.textContent = "Blocked from signing in";

  setText("user-total-delta", `${users.length} profile${users.length === 1 ? "" : "s"} on file`);
  setText("user-active-delta", "Seen in the last 30 days");
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

/* ---------- table ---------- */

function roleLabel(role) {
  return role === "admin" ? "Super Admin" : role === "editor" ? "Editor" : "Customer";
}

function roleClass(role) {
  return role === "admin"
    ? "admin-role-badge--admin"
    : role === "editor"
    ? "admin-role-badge--editor"
    : "";
}

function initials(user) {
  return (user.displayName || user.email || "?").trim().charAt(0).toUpperCase();
}

function renderTable() {
  const filter = el.roleFilter?.value || "all";
  const term = (el.search?.value || "").toLowerCase();

  const rows = users.filter((u) => {
    const matchesRole = filter === "all" || u.role === filter;
    const matchesTerm =
      !term ||
      u.displayName.toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term);
    return matchesRole && matchesTerm;
  });

  if (!rows.length) {
    // Three different reasons the table can be empty. Say which.
    if (loadProblem === null) {
      el.list.innerHTML =
        '<tr><td colspan="5" class="admin-empty">Loading users...</td></tr>';
    } else if (loadProblem) {
      clearProblem();
      showProblem(escapeHtml(loadProblem));
      el.list.innerHTML =
        '<tr><td colspan="5" class="admin-empty">Couldn\'t read the users collection — see above.</td></tr>';
    } else if (!users.length) {
      clearProblem();
      showProblem(
        "The <code>users</code> collection came back empty. Firebase <strong>Authentication</strong> accounts do not create these documents — " +
          "a <code>users/{uid}</code> document is written the first time someone signs in through the patched <code>login.js</code>, " +
          "or opens <code>account.html</code>. Sign in once on the customer site and this table will fill."
      );
      el.list.innerHTML =
        '<tr><td colspan="5" class="admin-empty">No user profiles in Firestore yet.</td></tr>';
    } else {
      clearProblem();
      el.list.innerHTML =
        '<tr><td colspan="5" class="admin-empty">No users match this filter.</td></tr>';
    }
    return;
  }

  clearProblem();

  el.list.innerHTML = rows
    .map(
      (u) => `<tr>
      <td>${
        u.photoURL
          ? `<img src="${escapeHtml(u.photoURL)}" class="admin-table-avatar" alt="" referrerpolicy="no-referrer">`
          : `<div class="admin-table-avatar" style="display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:#1a0401;">${escapeHtml(
              initials(u)
            )}</div>`
      }</td>
      <td>${escapeHtml(u.displayName)}<div class="admin-table-subtext">${escapeHtml(
        u.email
      )}</div></td>
      <td><span class="admin-role-badge ${roleClass(u.role)}">${roleLabel(u.role)}</span></td>
      <td><span class="admin-status-badge admin-status-badge--${
        u.disabled ? "cancelled" : "completed"
      }">${u.disabled ? "Disabled" : "Active"}</span></td>
      <td><div class="admin-actions-cell">
        <button class="admin-icon-btn" type="button" data-action="edit" data-id="${
          u.id
        }" aria-label="Edit user">✎</button>
        <button class="admin-icon-btn" type="button" data-action="toggle" data-id="${
          u.id
        }" aria-label="${u.disabled ? "Enable user" : "Disable user"}">${
        u.disabled ? "↺" : "🚫"
      }</button>
      </div></td>
    </tr>`
    )
    .join("");
}

el.list?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const user = users.find((u) => u.id === button.dataset.id);
  if (!user) return;

  if (button.dataset.action === "edit") {
    openEditUser(user);
    return;
  }

  const next = !user.disabled;
  if (!window.confirm(`${next ? "Disable" : "Re-enable"} ${user.displayName || user.email}?`))
    return;

  try {
    await updateUserProfile(
      user.id,
      { disabled: next },
      user.displayName || user.email
    );
  } catch (err) {
    console.error("Could not update account state:", err);
    window.alert("That change could not be saved. Check your Firestore rules.");
  }
});

el.roleFilter?.addEventListener("change", renderTable);
el.search?.addEventListener("input", renderTable);

/* ---------- edit modal ---------- */

function openEditUser(user) {
  editingUser = user;
  document.getElementById("edit-user-name").textContent = user.displayName;
  document.getElementById("edit-user-email").textContent = user.email;
  document.getElementById("edit-user-avatar").textContent = initials(user);
  el.role.value = user.role;
  el.modal.hidden = false;
  el.backdrop.hidden = false;
}

function closeEditUser() {
  el.modal.hidden = true;
  el.backdrop.hidden = true;
  editingUser = null;
}

document.getElementById("edit-user-close")?.addEventListener("click", closeEditUser);
document.getElementById("edit-user-cancel")?.addEventListener("click", closeEditUser);
el.backdrop?.addEventListener("click", closeEditUser);

el.saveBtn?.addEventListener("click", async () => {
  if (!editingUser) return;

  const newRole = el.role.value;
  el.saveBtn.disabled = true;
  el.saveBtn.textContent = "Saving...";

  try {
    if (newRole !== editingUser.role) {
      // previousRole + label are what turn the log line from
      // "user updated" into "Nikko changed Ana's role: customer → admin".
      await setUserRole(
        editingUser.id,
        newRole,
        editingUser.role,
        editingUser.displayName || editingUser.email
      );
      if (newRole === "admin") {
        window.alert(
          "Role saved.\n\nNote: full admin-panel access also needs a document at " +
            `admins/${editingUser.id} in Firestore. That one stays a console action on purpose ` +
            "so admin rights can never be granted from a browser."
        );
      }
    }
    closeEditUser();
    // The users stream re-renders the row on its own.
  } catch (err) {
    console.error("Role save failed:", err);
    window.alert("Could not save that role. Check your Firestore rules.");
  } finally {
    el.saveBtn.disabled = false;
    el.saveBtn.textContent = "Save Permissions";
  }
});