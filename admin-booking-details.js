/* ==========================================================
   Admin — Booking detail
   ----------------------------------------------------------
   The clearest admin -> user link in the app. Changing the status
   dropdown here calls updateBookingStatus(), which:

     1. writes the new status on the booking
     2. appends an entry to that booking's own history log
     3. drops a notification into users/{uid}/notifications

   The customer's account page is watching that notifications
   subcollection, so their bell badge updates while they sit there.
   ========================================================== */

import {
  attachLogoutConfirm,
  collectUnsubscribers,
  escapeHtml,
  peso,
  renderAdminSidebarProfile,
  requireAdmin,
  timeAgo,
  toDate,
  saveBooking,
  updateBookingStatus,
  watchBooking
} from "./trailbound-data.js";

const track = collectUnsubscribers();

const host = document.getElementById("booking-detail");
const bookingId = new URLSearchParams(location.search).get("booking");
const avatarImg = document.getElementById("admin-avatar");
const avatarFallback = document.getElementById("admin-avatar-fallback");
const nameEl = document.getElementById("admin-name");
const logoutBtn = document.getElementById("admin-logout-btn");

const STATUS_OPTIONS = ["Pending", "Confirmed", "Completed", "Cancelled"];

let adminUser = null;
let booking = null;
/** Guards against the live stream wiping the form mid-edit. */
let saving = false;
/** True while the detail cards are swapped for the edit form. The live
    stream must not re-render over half-typed input either. */
let editing = false;

const value = (v, fallback = "Not provided") =>
  v === undefined || v === null || v === "" ? fallback : v;

const dateText = (date) =>
  date
    ? new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      })
    : "Not scheduled";

const stampText = (stamp) => {
  const date = toDate(stamp);
  if (!date) return "Recently";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
};

const badgeClass = (status) =>
  String(status).toLowerCase() === "confirmed" ? "completed" : String(status).toLowerCase();

attachLogoutConfirm(logoutBtn);

requireAdmin((user) => {
  adminUser = user;
  renderAdminSidebarProfile(user, { avatarImg, avatarFallback, nameEl });

  if (!bookingId) {
    host.innerHTML =
      '<p class="admin-empty">No booking was selected. <a href="admin-bookings.html">Return to bookings</a></p>';
    return;
  }

  track(
    watchBooking(bookingId, (item) => {
      if (saving || editing) return;
      if (!item) {
        host.innerHTML =
          '<p class="admin-empty">This booking could not be loaded. <a href="admin-bookings.html">Return to bookings</a></p>';
        return;
      }
      booking = item;
      render(item);
    })
  );
});

/* ---------- history log ---------- */

function historyRows(b) {
  const entries = [
    {
      title: "Booking Created",
      detail: "Submitted by the customer through Trailbound",
      time: b.createdAt,
      icon: "B",
      accent: true
    },
    {
      title: "Confirmation Sent",
      detail: `Automated email sent to ${value(b.email, "the customer")}`,
      time: b.createdAt,
      icon: "P"
    },
    ...b.history.map((log) => ({
      title: log.title || "Order Updated",
      detail: log.detail || "Booking details were updated by an administrator",
      time: log.time || log.timestamp,
      icon: "U"
    }))
  ];

  return entries
    .map(
      (log, index) =>
        `<div class="history-row${index > 2 ? " history-extra" : ""}"${
          index > 2 ? " hidden" : ""
        }><i class="history-icon${log.accent ? " history-icon--accent" : ""}">${
          log.icon
        }</i><div><strong>${escapeHtml(log.title)}</strong><p>${escapeHtml(
          log.detail
        )}</p></div><time>${escapeHtml(stampText(log.time))}</time></div>`
    )
    .join("");
}

/* ---------- render ---------- */

function render(b) {
  const initial = b.customerName.charAt(0).toUpperCase() || "G";
  const crumb = document.getElementById("detail-crumb");
  if (crumb) crumb.textContent = `Order #${b.orderId}`;

  host.innerHTML = `
  <section class="order-detail-header">
    <div><h1>#${escapeHtml(b.orderId)} <span class="admin-status-badge admin-status-badge--${badgeClass(
    b.status
  )}">${escapeHtml(b.status)}</span></h1></div>
    <div class="order-detail-header-actions">
      <button class="admin-export-btn order-print-btn" id="print-booking" type="button">Print Invoice</button>
      <button class="admin-export-btn" id="edit-booking" type="button">Edit details</button>
      <button class="admin-modal-submit order-export-btn" id="export-order" type="button">+ Export Order</button>
    </div>
  </section>
  <div class="order-detail-layout">
    <div class="order-detail-content">
      <section class="order-info-card">
        <h3>Customer Information</h3>
        <div class="customer-info-layout">
          <div class="customer-profile">
            <div class="customer-initial">${escapeHtml(initial)}</div>
            <div><strong>${escapeHtml(b.customerName)}</strong><span>Customer since ${
    toDate(b.createdAt)?.getFullYear() || "recently"
  }</span></div>
          </div>
          <div class="order-info-grid">
            <p><small>Email address</small>${escapeHtml(value(b.email))}</p>
            <p><small>Phone number</small>${escapeHtml(value(b.phone))}</p>
          </div>
        </div>
      </section>
      <section class="order-info-card">
        <h3 class="booking-card-heading">Booking Details</h3>
        <div class="order-info-grid order-info-grid--booking">
          <p><small>Trail name</small><strong>${escapeHtml(
            value(b.trailName)
          )}</strong><em>${escapeHtml(value(b.packageName, "Standard package"))}</em></p>
          <p><small>Departure date</small><strong>${escapeHtml(
            dateText(b.date)
          )}</strong><em>${escapeHtml(
    value(b.departureTime, "Meeting time to be confirmed")
  )}</em></p>
          <p><small>Number of pax</small><strong>${b.groupSize} Person${
    b.groupSize === 1 ? "" : "s"
  }</strong></p>
          <p><small>Guide assigned</small><strong>${escapeHtml(
            value(b.guideName, "To be assigned")
          )}</strong></p>
        </div>
        ${
          b.activity
            ? `<div class="order-special-request"><small>Chosen activity</small><p>${escapeHtml(
                b.activity
              )}</p></div>`
            : ""
        }
        ${
          b.specialRequests
            ? `<div class="order-special-request"><small>Special request</small><p>${escapeHtml(
                b.specialRequests
              )}</p></div>`
            : ""
        }
      </section>

      <!-- ADDED. An emergency contact is the one field on a hiking
           booking you need in a hurry, and it was the one field the
           admin never showed. It is stored on every booking. -->
      <section class="order-info-card">
        <h3>Emergency Contact</h3>
        <div class="order-info-grid">
          <p><small>Name</small><strong>${escapeHtml(
            value(b.emergencyName, "Not provided")
          )}</strong></p>
          <p><small>Number</small><strong>${
            b.emergencyNumber
              ? `<a href="tel:${escapeHtml(b.emergencyNumber)}" style="color:var(--admin-text);text-decoration:none">${escapeHtml(b.emergencyNumber)}</a>`
              : "Not provided"
          }</strong></p>
        </div>
        ${
          b.emergencyName && b.emergencyNumber
            ? ""
            : '<p class="admin-form-hint" style="margin-top:.7rem;color:#ffb4a8">This booking has no usable emergency contact. Add one before the trip departs.</p>'
        }
      </section>
    </div>
    <aside class="order-detail-side">
      <section class="order-info-card payment-card">
        <h3>Payment Summary</h3>
        <div class="admin-payment-line"><span>Subtotal (${b.groupSize} Pax)</span><strong>${peso(
    b.amount
  )}</strong></div>
        <div class="admin-payment-line"><span>Service Fees</span><strong>${peso(0)}</strong></div>
        <div class="admin-payment-line"><span>Taxes</span><strong>${peso(0)}</strong></div>
        <div class="admin-payment-total"><span>Total amount</span><strong>${peso(
          b.amount
        )}</strong></div>
        <div class="payment-state ${
          b.paymentStatus === "paid" ? "payment-state--paid" : ""
        }">${b.paymentStatus === "paid" ? "Payment verified" : "Payment pending"}</div>
      </section>
      <section class="order-info-card status-card">
        <h3>Status</h3>
        <p class="status-card-label">Current booking status</p>
        <select class="status-card-value status-card-value--${badgeClass(
          b.status
        )}" id="status-select">${STATUS_OPTIONS.map(
    (opt) =>
      `<option value="${opt}"${
        opt.toLowerCase() === b.status.toLowerCase() ? " selected" : ""
      }>${opt}</option>`
  ).join("")}</select>
        <p class="status-card-label" id="status-note" style="margin-top:.6rem"></p>
      </section>

      <!-- The ids booking.js matches on, plus whether this booking is
           attached to a real account. Read-only: editing an id without
           editing the matching name leaves the booking pointing at a
           trail it is not for. -->
      <section class="order-info-card">
        <h3>References</h3>
        <div class="order-info-grid" style="grid-template-columns:1fr">
          <p><small>Trail ID</small><strong>${escapeHtml(value(b.trailId, "—"))}</strong></p>
          <p><small>Package ID</small><strong>${escapeHtml(value(b.packageId, "—"))}</strong></p>
          <p><small>Guide ID</small><strong>${escapeHtml(value(b.guideId, "—"))}</strong></p>
          <p><small>Account</small><strong>${
            b.uid
              ? "Linked to a signed-in customer"
              : "Guest booking \u2014 no account attached"
          }</strong></p>
        </div>
        ${
          b.uid
            ? ""
            : '<p class="admin-form-hint" style="margin-top:.7rem">Without a uid this customer cannot see the booking in their account, and status changes reach them by email only.</p>'
        }
      </section>
    </aside>
  </div>
  <section class="order-history-card">
    <div class="order-history-heading"><h3>Order History Log</h3><button id="toggle-history" type="button">View full logs ›</button></div>
    <div id="history-list">${historyRows(b)}</div>
  </section>`;

  wireActions(b);
}

/* ==========================================================
   EDIT MODE
   ----------------------------------------------------------
   The page could change a booking's status and nothing else. Every
   other correction — a mistyped number, the wrong departure date, a
   missing emergency contact — meant opening the Firebase console.

   Status stays out of this form on purpose: changing it also notifies
   the customer, and that should never happen as a side effect of
   fixing a typo. It keeps its own control in the sidebar.
   ========================================================== */

const EDIT_FIELDS = [
  ["customerName",    "Customer name",   "text"],
  ["email",           "Email",           "email"],
  ["phone",           "Phone",           "text"],
  ["trailName",       "Trail",           "text"],
  ["packageName",     "Package",         "text"],
  ["guideName",       "Guide",           "text"],
  ["date",            "Departure date",  "date"],
  ["departureTime",   "Departure time",  "text"],
  ["groupSize",       "Group size",      "number"],
  ["amount",          "Total price",     "number"],
  ["emergencyName",   "Emergency contact name",   "text"],
  ["emergencyNumber", "Emergency contact number", "text"],
  ["activity",        "Chosen activity", "text"],
  ["specialRequests", "Special requests","textarea"]
];

function editFormHtml(b) {
  const input = ([key, label, type]) => {
    const v = b[key] ?? "";
    if (type === "textarea") {
      return `<label style="grid-column:1/-1">${label}
        <textarea id="e-${key}" rows="3">${escapeHtml(v)}</textarea></label>`;
    }
    const extra = type === "number" ? ' min="0" step="1"' : "";
    return `<label>${label}<input id="e-${key}" type="${type}"${extra} value="${escapeHtml(v)}"></label>`;
  };

  return `<section class="order-info-card">
    <h3>Edit booking #${escapeHtml(b.orderId)}</h3>
    <form id="booking-edit-form" class="admin-product-form" style="margin-top:1rem">
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.9rem">
        ${EDIT_FIELDS.map(input).join("")}
        <label>Payment status
          <select id="e-paymentStatus">
            ${["Unpaid", "Paid", "Refunded", "Failed"]
              .map((o) => `<option value="${o}"${
                o.toLowerCase() === String(b.paymentStatus).toLowerCase() ? " selected" : ""
              }>${o}</option>`)
              .join("")}
          </select>
        </label>
      </div>
      <p class="admin-form-hint" id="edit-note" style="margin-top:.9rem">
        Trail, package and guide IDs are not editable here \u2014 changing one without changing the
        matching name would leave this booking pointing at something it is not for.
        Status has its own control, because changing it also notifies the customer.
      </p>
      <div class="admin-modal-actions" style="margin-top:1rem;justify-content:flex-end;gap:.6rem">
        <button class="admin-modal-cancel" id="edit-cancel" type="button">Cancel</button>
        <button class="admin-modal-submit" type="submit">Save changes</button>
      </div>
    </form>
  </section>`;
}

function openEditor(b) {
  editing = true;
  host.innerHTML = editFormHtml(b);

  document.getElementById("edit-cancel").addEventListener("click", () => {
    editing = false;
    render(booking);
  });

  document.getElementById("booking-edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.target.querySelector('button[type="submit"]');
    const note = document.getElementById("edit-note");
    submit.disabled = true;
    submit.textContent = "Saving...";

    const read = (key) => document.getElementById(`e-${key}`)?.value ?? "";
    const data = Object.fromEntries(EDIT_FIELDS.map(([key]) => [key, read(key)]));
    data.paymentStatus = read("paymentStatus");

    try {
      // saving guards the stream; editing is cleared only on success so
      // a failed write leaves the admin's typing on screen to retry.
      saving = true;
      const changed = await saveBooking(b, data, adminUser);
      saving = false;
      editing = false;
      note.textContent = changed ? "Saved." : "Nothing had changed.";
      render(booking ? { ...booking, ...data } : b);
    } catch (err) {
      saving = false;
      console.error("Booking save failed:", err);
      note.textContent = "Could not save. Check your Firestore rules — the booking rules allow an admin to update, so a denial here usually means the rules are not deployed.";
      note.style.color = "#ffb4a8";
      submit.disabled = false;
      submit.textContent = "Save changes";
    }
  });
}

/* ---------- actions ---------- */

function wireActions(b) {
  document.getElementById("edit-booking")?.addEventListener("click", () => openEditor(b));

  const toggle = document.getElementById("toggle-history");
  toggle?.addEventListener("click", () => {
    const extras = document.querySelectorAll(".history-extra");
    const expanded = toggle.dataset.expanded === "true";
    extras.forEach((row) => (row.hidden = expanded));
    toggle.dataset.expanded = String(!expanded);
    toggle.textContent = expanded ? "View full logs ›" : "Show fewer logs ‹";
  });

  document.getElementById("print-booking")?.addEventListener("click", () => window.print());

  document.getElementById("export-order")?.addEventListener("click", () => {
    const csv = `Order ID,Customer,Email,Phone,Trail,Package,Guide,Date,Pax,Amount,Status,Payment,Activity,Special requests,Emergency name,Emergency number\n${[
      b.orderId,
      b.customerName,
      b.email,
      b.phone,
      b.trailName,
      b.packageName,
      b.guideName,
      b.date,
      b.groupSize,
      b.amount,
      b.status,
      b.paymentStatusLabel,
      b.activity,
      b.specialRequests,
      b.emergencyName,
      b.emergencyNumber
    ]
      .map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`)
      .join(",")}`;
    const link = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
      download: `trailbound-order-${b.orderId}.csv`
    });
    link.click();
    URL.revokeObjectURL(link.href);
  });

  const select = document.getElementById("status-select");
  const note = document.getElementById("status-note");
  const previous = b.status;

  select?.addEventListener("change", async (event) => {
    const newStatus = event.target.value;
    select.disabled = true;
    saving = true;
    if (note) note.textContent = "Saving and notifying the customer...";

    try {
      await updateBookingStatus(b, newStatus, adminUser);
      select.className = `status-card-value status-card-value--${badgeClass(newStatus)}`;
      const badge = document.querySelector(".order-detail-header h1 .admin-status-badge");
      if (badge) {
        badge.textContent = newStatus;
        badge.className = `admin-status-badge admin-status-badge--${badgeClass(newStatus)}`;
      }
      if (note) note.textContent = `Customer notified · ${timeAgo(new Date())}`;
    } catch (err) {
      console.error("Failed to update status", err);
      select.value = previous;
      select.className = `status-card-value status-card-value--${badgeClass(previous)}`;
      if (note) note.textContent = "Could not save. Check your Firestore rules.";
    } finally {
      select.disabled = false;
      saving = false;
    }
  });
}