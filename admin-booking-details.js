import { auth, db, isAdmin } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { attachLogoutConfirm, renderAdminSidebarProfile } from "./admin.js";

const host = document.getElementById("booking-detail");
const id = new URLSearchParams(location.search).get("booking");
const avatarImg = document.getElementById("admin-avatar");
const avatarFallback = document.getElementById("admin-avatar-fallback");
const nameEl = document.getElementById("admin-name");
const logoutBtn = document.getElementById("admin-logout-btn");
const value = (v, fallback = "Not provided") => v === undefined || v === null || v === "" ? fallback : v;
const money = v => `PHP ${Number(v || 0).toLocaleString()}`;
const dateText = date => date ? new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not scheduled";
const timeText = time => time ? new Date(time).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "Recently";
attachLogoutConfirm(logoutBtn);

onAuthStateChanged(auth, async user => {
  if (!user) return void (location.href = "admin-login.html");
  if (!(await isAdmin(user.uid))) { await signOut(auth); location.href = "admin-login.html"; return; }
  renderAdminSidebarProfile(user, { avatarImg, avatarFallback, nameEl });
  if (!id) return void (host.innerHTML = '<p class="admin-empty">No booking was selected. <a href="admin-bookings.html">Return to bookings</a></p>');
  try { const snap = await getDoc(doc(db, "bookings", id)); if (!snap.exists()) throw new Error("Missing booking"); render({ id: snap.id, ...snap.data() }); }
  catch (err) { console.error(err); host.innerHTML = '<p class="admin-empty">This booking could not be loaded. <a href="admin-bookings.html">Return to bookings</a></p>'; }
});

function historyRows(b) {
  const base = [
    { title: "Booking Created", detail: "System generated this booking via Trailbound", time: b.created_at, icon: "B", accent: true },
    { title: "Payment Notification Sent", detail: `Automated email sent to ${value(b.email, "the customer")}`, time: b.created_at, icon: "P" },
    ...((Array.isArray(b.history) ? b.history : []).map(log => ({ title: log.title || "Order Updated", detail: log.detail || "Booking details were updated by an administrator", time: log.time || log.timestamp, icon: "U" }))),
    { title: "Order Viewed by Admin", detail: "Opened from the booking management panel", time: null, icon: "A" }
  ];
  return base.map((log, index) => `<div class="history-row${index > 2 ? " history-extra" : ""}"${index > 2 ? " hidden" : ""}><i class="history-icon${log.accent ? " history-icon--accent" : ""}">${log.icon}</i><div><strong>${log.title}</strong><p>${log.detail}</p></div><time>${timeText(log.time)}</time></div>`).join("");
}

function render(b) {
  const orderId = b.orderId || b.id.slice(0, 8).toUpperCase();
  const status = String(b.status || "Pending"), payment = String(b.payment_status || "Unpaid"), total = Number(b.total_price ?? b.amount ?? 0);
  const customer = value(b.full_name || b.customerName, "Guest customer"), initial = customer.charAt(0).toUpperCase();
  const statusOptions = ["Pending", "Confirmed", "Completed", "Cancelled"];
  document.getElementById("detail-crumb").textContent = `Order #${orderId}`;
  host.innerHTML = `<section class="order-detail-header"><div><h1>#${orderId} <span class="admin-status-badge admin-status-badge--${status.toLowerCase() === "confirmed" ? "completed" : status.toLowerCase()}">${status}</span></h1></div><div class="order-detail-header-actions"><button class="admin-export-btn order-print-btn" id="print-booking" type="button">Print Invoice</button><button class="admin-modal-submit order-export-btn" id="export-order" type="button">+ Export Order</button></div></section>
  <div class="order-detail-layout"><div class="order-detail-content">
    <section class="order-info-card"><h3>Customer Information</h3><div class="customer-info-layout"><div class="customer-profile"><div class="customer-initial">${initial}</div><div><strong>${customer}</strong><span>Customer since ${b.created_at ? new Date(b.created_at).getFullYear() : "recently"}</span></div></div><div class="order-info-grid"><p><small>Email address</small>${value(b.email)}</p><p><small>Phone number</small>${value(b.contact_number)}</p></div></div></section>
    <section class="order-info-card"><h3 class="booking-card-heading">Booking Details</h3><div class="order-info-grid order-info-grid--booking"><p><small>Trail name</small><strong>${value(b.trail_name || b.trailName)}</strong><em>${value(b.package_name || b.packageInfo, "Standard package")}</em></p><p><small>Departure date</small><strong>${dateText(b.date || b.bookingDate)}</strong><em>${value(b.departure_time, "Meeting time to be confirmed")}</em></p><p><small>Number of pax</small><strong>${value(b.group_size, "1")} Person${Number(b.group_size) === 1 ? "" : "s"}</strong></p><p><small>Guide assigned</small><strong>${value(b.guide_name, "To be assigned")}</strong></p></div>${b.special_requests || b.activity ? `<div class="order-special-request"><small>Special request</small><p>${value(b.special_requests || b.activity)}</p></div>` : ""}</section>
  </div><aside class="order-detail-side"><section class="order-info-card payment-card"><h3>Payment Summary</h3><div class="admin-payment-line"><span>Subtotal (${value(b.group_size, "1")} Pax)</span><strong>${money(total)}</strong></div><div class="admin-payment-line"><span>Service Fees</span><strong>PHP 0.00</strong></div><div class="admin-payment-line"><span>Taxes</span><strong>PHP 0.00</strong></div><div class="admin-payment-total"><span>Total amount</span><strong>${money(total)}</strong></div><div class="payment-state ${payment.toLowerCase() === "paid" ? "payment-state--paid" : ""}">${payment.toLowerCase() === "paid" ? "Payment verified" : "Payment pending"}</div></section>
  <section class="order-info-card status-card"><h3>Status</h3><p class="status-card-label">Current booking status</p><select class="status-card-value status-card-value--${status.toLowerCase() === "confirmed" ? "confirmed" : status.toLowerCase()}" id="status-select">${statusOptions.map(opt => `<option value="${opt}"${opt.toLowerCase() === status.toLowerCase() ? " selected" : ""}>${opt}</option>`).join("")}</select></section></aside></div>
  <section class="order-history-card"><div class="order-history-heading"><h3>Order History Log</h3><button id="toggle-history" type="button">View full logs ›</button></div><div id="history-list">${historyRows(b)}</div></section>`;
  const toggle = document.getElementById("toggle-history");
  toggle.addEventListener("click", () => { const extras = document.querySelectorAll(".history-extra"); const expanded = toggle.dataset.expanded === "true"; extras.forEach(row => row.hidden = expanded); toggle.dataset.expanded = String(!expanded); toggle.textContent = expanded ? "View full logs ›" : "Show fewer logs ‹"; });
  document.getElementById("print-booking").addEventListener("click", () => window.print());
  document.getElementById("export-order").addEventListener("click", () => { const csv = `Order ID,Customer,Trail,Date,Amount,Status\n"${orderId}","${customer}","${value(b.trail_name || b.trailName, "")}","${b.date || ""}","${total}","${status}"`; const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `trailbound-order-${orderId}.csv` }); link.click(); URL.revokeObjectURL(link.href); });
  document.getElementById("status-select").addEventListener("change", async e => {
    const newStatus = e.target.value;
    const select = e.target;
    const previousValue = select.dataset.previous || status;
    select.className = `status-card-value status-card-value--${newStatus.toLowerCase() === "confirmed" ? "confirmed" : newStatus.toLowerCase()}`;
    try {
      await updateDoc(doc(db, "bookings", b.id), { status: newStatus });
      select.dataset.previous = newStatus;
      const badge = document.querySelector(".order-detail-header h1 .admin-status-badge");
      badge.textContent = newStatus;
      badge.className = `admin-status-badge admin-status-badge--${newStatus.toLowerCase() === "confirmed" ? "completed" : newStatus.toLowerCase()}`;
    } catch (err) {
      console.error("Failed to update status", err);
      select.value = previousValue;
      select.className = `status-card-value status-card-value--${previousValue.toLowerCase() === "confirmed" ? "confirmed" : previousValue.toLowerCase()}`;
    }
  });
}