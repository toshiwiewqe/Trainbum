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
  setAccountDisabled,
  setUserRole,
  timeAgo,
  toDate,
  watchNotifications,
  watchWishlist,
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
  form: document.getElementById("edit-user-form"),
  role: document.getElementById("edit-user-role"),
  accessInput: document.getElementById("edit-user-access"),
  accessCard: document.getElementById("edit-user-access-card"),
  accessState: document.getElementById("edit-user-access-state"),
  adminNote: document.getElementById("edit-user-admin-note"),
  record: document.getElementById("edit-user-record"),
  addressSection: document.getElementById("edit-user-address-section"),
  addresses: document.getElementById("edit-user-addresses"),
  extrasSection: document.getElementById("edit-user-extras-section"),
  extras: document.getElementById("edit-user-extras"),
  notifs: document.getElementById("edit-user-notifs"),
  notifCount: document.getElementById("edit-user-notif-count"),
  wishlist: document.getElementById("edit-user-wishlist"),
  wishlistCount: document.getElementById("edit-user-wishlist-count"),
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

  /* THE FIX THIS CARD NEEDED.

     The filter above requires a lastActiveAt stamp. Your older profile
     documents do not have one — the document you screenshotted has
     exactly four fields: createdAt, displayName, email, phone. So for
     every legacy account this test is false no matter how recently the
     person used the site, and "Active Users" could only ever read a
     number smaller than the truth, often zero.

     That stamp is written by touchUser() on sign-in, so a legacy
     profile gains one the next time its owner signs in. Until then the
     honest thing is not to guess: count what is measurable and say
     plainly how many accounts cannot be measured yet. Falling back to
     createdAt would have made the card read high instead of low, which
     is the same failure with better manners. */
  const unmeasured = users.filter((u) => !u.hasActivityStamp).length;

  const newCount = users.filter((u) => {
    const joined = toDate(u.createdAt);
    return joined && now - joined.getTime() < DAY;
  }).length;

  const disabledCount = users.filter((u) => u.disabled).length;

  setText("user-total", users.length.toLocaleString());
  setText("user-active", activeCount.toLocaleString());
  setText("user-new", newCount.toLocaleString());
  setText("user-disabled", disabledCount.toLocaleString());

  setText("user-total-delta", `${users.length} profile${users.length === 1 ? "" : "s"} on file`);
  setText(
    "user-active-delta",
    unmeasured
      ? `Seen in the last 30 days · ${unmeasured} with no sign-in recorded`
      : "Seen in the last 30 days"
  );
  setText(
    "user-disabled-delta",
    disabledCount ? "Blocked from signing in" : "No accounts blocked"
  );
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
    /* Widened: the phone number is in the document and searching for
       it found nothing, and a uid is often the only thing you have
       when chasing a record from another collection. */
    const matchesTerm =
      !term ||
      [u.displayName, u.email, u.phone, u.id].some((v) =>
        String(v || "").toLowerCase().includes(term)
      );
    return matchesRole && matchesTerm;
  });

  if (!rows.length) {
    // Three different reasons the table can be empty. Say which.
    if (loadProblem === null) {
      el.list.innerHTML =
        '<tr><td colspan="8" class="admin-empty">Loading users...</td></tr>';
    } else if (loadProblem) {
      clearProblem();
      showProblem(escapeHtml(loadProblem));
      el.list.innerHTML =
        '<tr><td colspan="8" class="admin-empty">Couldn\'t read the users collection — see above.</td></tr>';
    } else if (!users.length) {
      clearProblem();
      showProblem(
        "The <code>users</code> collection came back empty. Firebase <strong>Authentication</strong> accounts do not create these documents — " +
          "a <code>users/{uid}</code> document is written the first time someone signs in through the patched <code>login.js</code>, " +
          "or opens <code>account.html</code>. Sign in once on the customer site and this table will fill."
      );
      el.list.innerHTML =
        '<tr><td colspan="8" class="admin-empty">No user profiles in Firestore yet.</td></tr>';
    } else {
      clearProblem();
      el.list.innerHTML =
        '<tr><td colspan="8" class="admin-empty">No users match this filter.</td></tr>';
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
      <td>${
        /* An older profile has displayName: "". It used to render as
           "Unnamed", which looks like a stored value. The email's local
           part is a better guess AND is marked as a guess. */
        u.hasName
          ? escapeHtml(u.displayName)
          : `<span class="admin-missing admin-inferred" title="No displayName on this document — shown from the email address">${escapeHtml(
              u.displayName
            )}</span>`
      }<div class="admin-table-subtext">${escapeHtml(u.email)}</div></td>
      <td>${
        u.phone
          ? escapeHtml(u.phone)
          : '<span class="admin-missing">not set</span>'
      }</td>
      <td><span class="admin-role-badge ${roleClass(u.role)}">${roleLabel(u.role)}</span>${
        u.isAdminDoc
          ? '<div class="admin-table-subtext">from admins/</div>'
          : u.hasRole
          ? ""
          : '<div class="admin-table-subtext admin-missing">no role field</div>'
      }</td>
      <td>${
        toDate(u.createdAt)
          ? escapeHtml(timeAgo(u.createdAt))
          : '<span class="admin-missing">unknown</span>'
      }</td>
      <td>${
        /* Never shown before. An account that has never recorded a
           sign-in is a different thing from a dormant one, and the
           Active Users card above depends on exactly this distinction,
           so the table has to show it too. */
        u.hasActivityStamp
          ? escapeHtml(timeAgo(u.lastActiveAt))
          : '<span class="admin-missing">never recorded</span>'
      }</td>
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
    await setAccountDisabled(user, next);
  } catch (err) {
    console.error("Could not update account state:", err);
    window.alert("That change could not be saved. Check your Firestore rules.");
  }
});

el.roleFilter?.addEventListener("change", renderTable);
el.search?.addEventListener("input", renderTable);

/* ---------- edit modal ---------- */

const when = (value) => {
  const d = toDate(value);
  return d ? d.toLocaleString("en-US") : "";
};

function showValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (value?.toDate) return when(value);
  if (Array.isArray(value)) return value.length ? value.map(showValue).join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const missing = (text) => `<span class="admin-missing">${escapeHtml(text)}</span>`;

function addressLines(label, address) {
  if (!address || typeof address !== "object") return "";
  const parts = [address.line1, address.line2, address.address, address.city,
                 address.region, address.zip, address.country]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  if (!parts.length) return "";
  return `<p><small>${escapeHtml(label)}</small>${escapeHtml(parts.join(", "))}</p>`;
}

/* The notifications subcollection is its own live stream, opened when
   a user is opened and closed again with the modal. Without the
   teardown, opening ten users would leave ten listeners running for
   the rest of the session. */
let stopNotifications = null;
let stopWishlist = null;

/* Keeps the card's wording and colour in step with the switch, so the
   control says what it is about to do rather than leaving you to infer
   it from a knob position. */
function paintAccess() {
  const allowed = el.accessInput.checked;
  el.accessCard.classList.toggle("is-blocked", !allowed);
  el.accessState.textContent = allowed
    ? "Active \u2014 can sign in"
    : "Disabled \u2014 blocked from signing in";
}

el.accessInput?.addEventListener("change", paintAccess);

function openEditUser(user) {
  editingUser = user;

  document.getElementById("edit-user-name").textContent = user.displayName;
  document.getElementById("edit-user-email").textContent = user.email;

  // Use the real avatar when the profile has one; fall back to initials.
  const photo = document.getElementById("edit-user-photo");
  const fallback = document.getElementById("edit-user-avatar");
  if (user.photoURL) {
    photo.src = user.photoURL;
    photo.hidden = false;
    fallback.hidden = true;
  } else {
    photo.hidden = true;
    fallback.hidden = false;
    fallback.textContent = initials(user);
  }

  el.role.value = user.role;
  // Checked = access allowed, so the stored `disabled` is inverted
  // here and nowhere else.
  el.accessInput.checked = !user.disabled;
  paintAccess();

  /* Says out loud what the removed toggle grid implied and could not
     deliver: this dropdown writes a field, it does not grant access. */
  el.adminNote.innerHTML = user.isAdminDoc
    ? "This account holds a document in the <code>admins</code> collection, which is what actually grants " +
      "admin-panel access. Changing the dropdown here will not revoke that."
    : "Role is a label on the profile. Real admin-panel access comes from a document at " +
      `<code>admins/${escapeHtml(user.id)}</code>, which firestore.rules checks and which deliberately ` +
      "cannot be written from a browser — create it in the Firebase console.";

  el.record.innerHTML = [
    `<p><small>User ID</small><strong style="font-family:ui-monospace,monospace;font-size:.72rem;word-break:break-all">${escapeHtml(
      user.id
    )}</strong></p>`,
    `<p><small>Email</small>${escapeHtml(user.email) || missing("not set")}</p>`,
    /* Read-only. These are the customer's to change from their own
       account page — the panel shows them, it does not edit them. */
    `<p><small>Display name</small>${
      user.hasName ? escapeHtml(user.displayName) : missing("not set by the customer")
    }</p>`,
    `<p><small>Phone</small>${escapeHtml(user.phone) || missing("not set")}</p>`,
    `<p><small>Joined</small>${when(user.createdAt) ? escapeHtml(when(user.createdAt)) : missing("unknown")}</p>`,
    `<p><small>Last seen</small>${
      user.hasActivityStamp ? escapeHtml(when(user.lastActiveAt)) : missing("never recorded")
    }</p>`,
    user.updatedAt ? `<p><small>Last updated</small>${escapeHtml(when(user.updatedAt))}</p>` : "",
    `<p><small>Role field</small>${
      user.hasRole ? escapeHtml(user.role) : missing("absent — treated as customer")
    }</p>`
  ].join("");

  const addresses =
    addressLines("Shipping", user.shippingAddress) + addressLines("Billing", user.billingAddress);
  el.addresses.innerHTML = addresses;
  el.addressSection.hidden = !addresses;

  el.extras.innerHTML = user.extras
    .map(([k, v]) => `<p><small>${escapeHtml(k)}</small>${escapeHtml(showValue(v))}</p>`)
    .join("");
  el.extrasSection.hidden = !user.extras.length;

  /* Wishlist items are written by the customer side, so their field
     names come from there rather than from a normalizer — the panel
     prints whichever of name/title/productName the document carries
     instead of assuming one shape. */
  el.wishlist.innerHTML = '<p class="admin-table-subtext">Loading wishlist\u2026</p>';
  el.wishlistCount.textContent = "";
  stopWishlist?.();
  stopWishlist = watchWishlist(user.id, (items) => {
    el.wishlistCount.textContent = items.length ? String(items.length) : "";
    el.wishlist.innerHTML = items.length
      ? items
          .map((item) => {
            const title = item.name || item.title || item.productName || item.id;
            const extra = [
              item.price !== undefined && item.price !== null
                ? `\u20b1${Number(item.price).toLocaleString()}`
                : "",
              item.category || "",
              item.productId ? `product ${item.productId}` : ""
            ]
              .filter(Boolean)
              .join(" \u00b7 ");
            const added = item.addedAt || item.createdAt;
            return `<div class="admin-notif">
              <div class="admin-notif-head">
                <span class="admin-notif-title">${escapeHtml(title)}</span>
                ${added ? `<span class="admin-notif-when">${escapeHtml(timeAgo(added))}</span>` : ""}
              </div>
              ${extra ? `<p class="admin-notif-body">${escapeHtml(extra)}</p>` : ""}
            </div>`;
          })
          .join("")
      : '<p class="admin-table-subtext">Nothing saved to this wishlist.</p>';
  });

  el.notifs.innerHTML = '<p class="admin-table-subtext">Loading notifications…</p>';
  el.notifCount.textContent = "";
  stopNotifications?.();
  stopNotifications = watchNotifications(user.id, (items) => {
    const unread = items.filter((n) => n.read !== true).length;
    el.notifCount.textContent = items.length
      ? `${items.length}${unread ? ` · ${unread} unread` : ""}`
      : "";
    el.notifs.innerHTML = items.length
      ? items
          .map(
            (n) => `<div class="admin-notif ${n.read === true ? "" : "admin-notif--unread"}">
              <div class="admin-notif-head">
                <span class="admin-notif-title">${escapeHtml(n.title || "(no title)")}</span>
                <span class="admin-notif-when">${escapeHtml(timeAgo(n.createdAt))}${
              n.read === true ? "" : " · unread"
            }</span>
              </div>
              <p class="admin-notif-body">${escapeHtml(n.message || "")}</p>
            </div>`
          )
          .join("")
      : '<p class="admin-table-subtext">Nothing has been sent to this account yet.</p>';
  });

  el.modal.hidden = false;
  el.backdrop.hidden = false;
}

function closeEditUser() {
  stopNotifications?.();
  stopNotifications = null;
  stopWishlist?.();
  stopWishlist = null;
  el.modal.hidden = true;
  el.backdrop.hidden = true;
  editingUser = null;
}

document.getElementById("edit-user-close")?.addEventListener("click", closeEditUser);
document.getElementById("edit-user-cancel")?.addEventListener("click", closeEditUser);
el.backdrop?.addEventListener("click", closeEditUser);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.modal.hidden) closeEditUser();
});

el.form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingUser) return;

  /* Work from the live snapshot, not the copy captured when the modal
     opened, so a save does not quietly revert something that changed
     in between. */
  const user = users.find((u) => u.id === editingUser.id) || editingUser;
  const newRole = el.role.value;

  el.saveBtn.disabled = true;
  el.saveBtn.textContent = "Saving...";

  try {
    await setAccountDisabled(user, !el.accessInput.checked);

    if (newRole !== user.role) {
      await setUserRole(user.id, newRole, user.role, user.displayName || user.email);
      if (newRole === "admin") {
        window.alert(
          "Role saved.\n\nNote: full admin-panel access also needs a document at " +
            `admins/${user.id} in Firestore. That one stays a console action on purpose ` +
            "so admin rights can never be granted from a browser."
        );
      }
    }

    closeEditUser();
    // The users stream re-renders the row on its own.
  } catch (err) {
    console.error("Saving the user failed:", err);
    window.alert("Those changes could not be saved. Check your Firestore rules.");
  } finally {
    el.saveBtn.disabled = false;
    el.saveBtn.innerHTML = 'Save changes <span aria-hidden="true">›</span>';
  }
});