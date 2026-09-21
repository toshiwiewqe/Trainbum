/* ==========================================================
   Trailbound — My Account (customer side)
   ----------------------------------------------------------
   The receiving end of everything the admin does.

   Wishlist, notifications and bookings are all live streams now,
   so when an admin confirms a booking in the panel, this page's
   booking status flips and the notification badge ticks up while
   the customer is sitting on it — no refresh, no polling.

   The "My Bookings" row used to jump to booking.html. It now opens
   a panel in place, built from the same `bookings` collection the
   admin sees, so the customer and the admin are looking at exactly
   the same records.
   ========================================================== */

import {
  auth,
  addToWishlist,
  collectUnsubscribers,
  ensureUserDoc,
  escapeHtml,
  markNotificationRead,
  peso,
  removeFromWishlist,
  requireUser,
  toDate,
  updateUserProfile,
  watchBookings,
  watchNotifications,
  watchUserProfile,
  watchWishlist
} from "./trailbound-data.js";
import {
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const track = collectUnsubscribers();

/* ---------- element refs ---------- */

const avatarImg = document.getElementById("account-avatar");
const avatarFallback = document.getElementById("account-avatar-fallback");
const nameEl = document.getElementById("account-name");
const emailEl = document.getElementById("account-email");
const memberSinceEl = document.getElementById("account-member-since");
const nameInput = document.getElementById("display-name-input");
const saveNameBtn = document.getElementById("save-name-btn");
const phoneInput = document.getElementById("phone-input");
const savePhoneBtn = document.getElementById("save-phone-btn");
const profileFeedbackEl = document.getElementById("profile-feedback");
const logoutBtn = document.getElementById("logout-btn");
const bookingsBtn = document.getElementById("menu-bookings-btn");
const notifBadge = document.getElementById("notif-badge");

const addressForm = document.getElementById("address-form");
const billingSameCheck = document.getElementById("billing-same-check");
const billingFields = document.getElementById("billing-fields");
const addressFeedbackEl = document.getElementById("address-feedback");

const wishlistListEl = document.getElementById("wishlist-list");
const notificationsListEl = document.getElementById("notifications-list");

const menuView = document.getElementById("account-menu");
const detailView = document.getElementById("account-detail");
const backBtn = document.getElementById("back-btn");

/* ---------- a bookings panel, built to match the others ---------- */

const bookingsPanel = document.createElement("div");
bookingsPanel.className = "account-panel";
bookingsPanel.id = "panel-bookings";
bookingsPanel.hidden = true;
bookingsPanel.innerHTML = `
  <h4 class="account-detail-title">My Bookings</h4>
  <div id="bookings-list" class="notifications-list">
    <p class="account-empty">Loading bookings...</p>
  </div>`;
detailView.appendChild(bookingsPanel);
const bookingsListEl = bookingsPanel.querySelector("#bookings-list");

const panels = {
  profile: document.getElementById("panel-profile"),
  addresses: document.getElementById("panel-addresses"),
  wishlist: document.getElementById("panel-wishlist"),
  notifications: document.getElementById("panel-notifications"),
  bookings: bookingsPanel
};

/* ---------- menu <-> detail navigation ---------- */

function openPanel(tab) {
  Object.values(panels).forEach((panel) => {
    if (panel) panel.hidden = true;
  });
  if (panels[tab]) panels[tab].hidden = false;
  menuView.hidden = true;
  detailView.hidden = false;
}

document.querySelectorAll(".account-menu-row[data-tab]").forEach((row) => {
  row.addEventListener("click", () => openPanel(row.dataset.tab));
});

backBtn?.addEventListener("click", () => {
  detailView.hidden = true;
  menuView.hidden = false;
});

// Opens in place now instead of navigating away.
bookingsBtn?.addEventListener("click", () => openPanel("bookings"));

billingSameCheck?.addEventListener("change", () => {
  billingFields.hidden = billingSameCheck.checked;
});

/* ---------- session ---------- */

let currentUser = null;
/** Don't let an incoming snapshot overwrite a field being typed in. */
let addressDirty = false;

function getInitials(name, email) {
  return (name || email || "?").trim().charAt(0).toUpperCase();
}

/** onAuthStateChanged can fire more than once per session; only subscribe once. */
let streamsStarted = false;

requireUser(
  async (user) => {
    currentUser = user;
    await ensureUserDoc(user);
    renderIdentity(user);

    if (streamsStarted) return;
    streamsStarted = true;

    track(
      watchUserProfile(user.uid, (profile) => {
        if (!profile) return;
        if (document.activeElement !== phoneInput) phoneInput.value = profile.phone || "";
        if (!addressDirty) fillAddressForm(profile._raw || {});
      })
    );

    track(watchWishlist(user.uid, renderWishlist));
    track(watchNotifications(user.uid, renderNotifications));
    track(
      watchBookings(renderBookings, {
        uid: user.uid,
        email: user.email // also picks up bookings made before sign-up
      })
    );
  },
  { redirect: "login.html" }
);

/* ---------- identity ---------- */

function renderIdentity(user) {
  nameEl.textContent = user.displayName || "Trailbound Hiker";
  emailEl.textContent = user.email || "";
  nameInput.value = user.displayName || "";

  if (user.metadata?.creationTime) {
    memberSinceEl.textContent =
      "Member since " +
      new Date(user.metadata.creationTime).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric"
      });
  }

  if (user.photoURL) {
    avatarImg.referrerPolicy = "no-referrer";
    avatarImg.src = user.photoURL;
    avatarImg.hidden = false;
    avatarFallback.hidden = true;
  } else {
    avatarImg.hidden = true;
    avatarFallback.hidden = false;
    avatarFallback.textContent = getInitials(user.displayName, user.email);
  }
}

function fillAddressForm(profile) {
  const ship = profile.shippingAddress || {};
  setValue("ship-line1", ship.line1);
  setValue("ship-line2", ship.line2);
  setValue("ship-city", ship.city);
  setValue("ship-province", ship.province);
  setValue("ship-postal", ship.postalCode);
  setValue("ship-country", ship.country || "Philippines");

  const sameAsShipping = profile.billingSameAsShipping !== false;
  billingSameCheck.checked = sameAsShipping;
  billingFields.hidden = sameAsShipping;

  const bill = profile.billingAddress || {};
  setValue("bill-line1", bill.line1);
  setValue("bill-line2", bill.line2);
  setValue("bill-city", bill.city);
  setValue("bill-province", bill.province);
  setValue("bill-postal", bill.postalCode);
  setValue("bill-country", bill.country || "Philippines");
}

function setValue(id, value) {
  const node = document.getElementById(id);
  if (node && document.activeElement !== node) node.value = value || "";
}

addressForm?.addEventListener("input", () => (addressDirty = true));

/* ---------- profile saves ---------- */

saveNameBtn?.addEventListener("click", async () => {
  const newName = nameInput.value.trim();
  if (!newName) {
    showFeedback(profileFeedbackEl, "Display name cannot be empty.", true);
    return;
  }

  saveNameBtn.disabled = true;
  saveNameBtn.textContent = "Saving...";

  try {
    await updateProfile(auth.currentUser, { displayName: newName });
    await updateUserProfile(currentUser.uid, { displayName: newName });
    nameEl.textContent = newName;
    avatarFallback.textContent = getInitials(newName, auth.currentUser.email);
    showFeedback(profileFeedbackEl, "Saved!", false);
  } catch (err) {
    console.error("Profile update error:", err);
    showFeedback(profileFeedbackEl, "Could not save changes. Try again.", true);
  } finally {
    saveNameBtn.disabled = false;
    saveNameBtn.textContent = "Save";
  }
});

savePhoneBtn?.addEventListener("click", async () => {
  savePhoneBtn.disabled = true;
  savePhoneBtn.textContent = "Saving...";

  try {
    await updateUserProfile(currentUser.uid, { phone: phoneInput.value.trim() });
    showFeedback(profileFeedbackEl, "Saved!", false);
  } catch (err) {
    console.error("Phone update error:", err);
    showFeedback(profileFeedbackEl, "Could not save phone number.", true);
  } finally {
    savePhoneBtn.disabled = false;
    savePhoneBtn.textContent = "Save";
  }
});

addressForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const read = (id) => document.getElementById(id).value.trim();
  const shippingAddress = {
    line1: read("ship-line1"),
    line2: read("ship-line2"),
    city: read("ship-city"),
    province: read("ship-province"),
    postalCode: read("ship-postal"),
    country: read("ship-country")
  };

  const billingSameAsShipping = billingSameCheck.checked;
  const billingAddress = billingSameAsShipping
    ? shippingAddress
    : {
        line1: read("bill-line1"),
        line2: read("bill-line2"),
        city: read("bill-city"),
        province: read("bill-province"),
        postalCode: read("bill-postal"),
        country: read("bill-country")
      };

  const submitBtn = addressForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving...";

  try {
    await updateUserProfile(currentUser.uid, {
      shippingAddress,
      billingSameAsShipping,
      billingAddress
    });
    addressDirty = false;
    showFeedback(addressFeedbackEl, "Addresses saved!", false);
  } catch (err) {
    console.error("Address save error:", err);
    showFeedback(addressFeedbackEl, "Could not save addresses. Try again.", true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save addresses";
  }
});

/* ---------- wishlist (live) ---------- */

function renderWishlist(items) {
  if (!items.length) {
    wishlistListEl.innerHTML =
      '<p class="account-empty">Your wishlist is empty. Save trails you love to see them here.</p>';
    return;
  }

  wishlistListEl.innerHTML = items
    .map(
      (item) => `<div class="wishlist-item">
      ${
        item.image
          ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(
              item.name || ""
            )}" class="wishlist-item-img" loading="lazy">`
          : '<div class="wishlist-item-img"></div>'
      }
      <div class="wishlist-item-info">
        <p class="wishlist-item-name">${escapeHtml(item.name || "Untitled item")}</p>
        ${item.price ? `<p class="wishlist-item-price">${peso(item.price)}</p>` : ""}
      </div>
      <button class="wishlist-remove-btn" data-id="${item.id}" type="button">Remove</button>
    </div>`
    )
    .join("");
}

wishlistListEl?.addEventListener("click", async (event) => {
  const button = event.target.closest(".wishlist-remove-btn");
  if (!button || !currentUser) return;
  button.disabled = true;
  try {
    await removeFromWishlist(currentUser.uid, button.dataset.id);
  } catch (err) {
    console.error("Wishlist remove failed:", err);
    button.disabled = false;
  }
});

/* ---------- notifications (live) ---------- */

function renderNotifications(items) {
  const unread = items.filter((n) => !n.read).length;
  if (unread > 0) {
    notifBadge.textContent = String(unread);
    notifBadge.hidden = false;
  } else {
    notifBadge.hidden = true;
  }

  if (!items.length) {
    notificationsListEl.innerHTML = '<p class="account-empty">No notifications yet.</p>';
    return;
  }

  notificationsListEl.innerHTML = items
    .map((n) => {
      const date = toDate(n.createdAt);
      const label = date
        ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "";
      return `<div class="notification-item${n.read ? "" : " notification-item--unread"}">
        <div class="notification-dot" aria-hidden="true"></div>
        <div class="notification-body">
          <p class="notification-title">${escapeHtml(n.title || "")}</p>
          <p class="notification-message">${escapeHtml(n.message || "")}</p>
          <p class="notification-date">${escapeHtml(label)}</p>
        </div>
        ${
          n.read
            ? ""
            : `<button class="notification-read-btn" data-id="${n.id}" type="button">Mark read</button>`
        }
      </div>`;
    })
    .join("");
}

notificationsListEl?.addEventListener("click", async (event) => {
  const button = event.target.closest(".notification-read-btn");
  if (!button || !currentUser) return;
  button.disabled = true;
  try {
    await markNotificationRead(currentUser.uid, button.dataset.id);
  } catch (err) {
    console.error("Mark read failed:", err);
    button.disabled = false;
  }
});

/* ---------- bookings (live — mirrors the admin panel) ---------- */

function statusTone(status) {
  if (["confirmed", "completed"].includes(status)) return "#7ee19a";
  if (status === "cancelled") return "#ff9d9d";
  return "rgba(255,255,255,0.7)";
}

function renderBookings(items) {
  if (!items.length) {
    bookingsListEl.innerHTML =
      '<p class="account-empty">You have no bookings yet. <a href="booking.html">Browse trails</a></p>';
    return;
  }

  bookingsListEl.innerHTML = items
    .map((b) => {
      const when = b.date
        ? new Date(`${b.date}T00:00:00`).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric"
          })
        : "Date to be confirmed";

      return `<div class="notification-item">
        <div class="notification-body">
          <p class="notification-title">${escapeHtml(b.trailName)} &middot; #${escapeHtml(
        b.orderId
      )}</p>
          <p class="notification-message">${escapeHtml(when)} &middot; ${
        b.groupSize
      } pax &middot; ${peso(b.amount)}</p>
          <p class="notification-date" style="color:${statusTone(
            b.status
          )}">${escapeHtml(b.status)}${
        b.paymentStatus === "paid" ? " &middot; paid" : ""
      }</p>
        </div>
      </div>`;
    })
    .join("");
}

/* ---------- misc ---------- */

function showFeedback(el, message, isError) {
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.toggle("account-feedback--error", Boolean(isError));
  setTimeout(() => (el.hidden = true), 2500);
}

logoutBtn?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "index.html";
  } catch (err) {
    console.error("Sign out error:", err);
  }
});

// Kept for pages that still call the old global.
window.addToWishlist = (item) => {
  if (!currentUser) {
    window.location.href = "login.html";
    return Promise.resolve();
  }
  return addToWishlist(currentUser.uid, item);
};
