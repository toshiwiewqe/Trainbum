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
      if (saving) return;
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
          b.specialRequests
            ? `<div class="order-special-request"><small>Special request</small><p>${escapeHtml(
                b.specialRequests
              )}</p></div>`
            : ""
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
    </aside>
  </div>
  <section class="order-history-card">
    <div class="order-history-heading"><h3>Order History Log</h3><button id="toggle-history" type="button">View full logs ›</button></div>
    <div id="history-list">${historyRows(b)}</div>
  </section>`;

  wireActions(b);
}

/* ---------- actions ---------- */

function wireActions(b) {
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
    const csv = `Order ID,Customer,Email,Trail,Date,Pax,Amount,Status,Payment\n${[
      b.orderId,
      b.customerName,
      b.email,
      b.trailName,
      b.date,
      b.groupSize,
      b.amount,
      b.status,
      b.paymentStatus
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
