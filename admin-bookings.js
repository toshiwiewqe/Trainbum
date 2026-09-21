/* ==========================================================
   Admin — Bookings
   ----------------------------------------------------------
   Live stream of the `bookings` collection. A customer who
   completes checkout on the site appears in this table within a
   second, with no refresh — createBooking() on the user side
   writes the doc this page is watching.
   ========================================================== */

import {
  attachLogoutConfirm,
  collectUnsubscribers,
  escapeHtml,
  peso,
  renderAdminSidebarProfile,
  requireAdmin,
  watchBookings
} from "./trailbound-data.js";

const track = collectUnsubscribers();

const el = {
  avatarImg: document.getElementById("admin-avatar"),
  avatarFallback: document.getElementById("admin-avatar-fallback"),
  nameEl: document.getElementById("admin-name"),
  logoutBtn: document.getElementById("admin-logout-btn"),
  statusFilter: document.getElementById("booking-status-filter"),
  search: document.getElementById("booking-search"),
  list: document.getElementById("booking-list"),
  exportBtn: document.getElementById("booking-export-btn"),
  exportModal: document.getElementById("booking-export-modal"),
  exportBackdrop: document.getElementById("booking-export-backdrop")
};

let bookings = [];

attachLogoutConfirm(el.logoutBtn);

requireAdmin((user) => {
  renderAdminSidebarProfile(user, {
    avatarImg: el.avatarImg,
    avatarFallback: el.avatarFallback,
    nameEl: el.nameEl
  });

  track(
    watchBookings((items) => {
      bookings = items;
      renderStats();
      renderTable();
    })
  );
});

/* ---------- stats ---------- */

function countByStatus(status) {
  return bookings.filter((b) => b.status === status).length;
}

function renderStats() {
  setText("booking-total", bookings.length.toLocaleString());
  setText("booking-pending", countByStatus("pending").toLocaleString());
  setText("booking-completed", countByStatus("completed").toLocaleString());
  setText("booking-cancelled", countByStatus("cancelled").toLocaleString());

  const revenue = bookings
    .filter((b) => b.status !== "cancelled")
    .reduce((sum, b) => sum + b.amount, 0);
  setText("booking-total-delta", `${peso(revenue)} booked`);

  const pending = countByStatus("pending");
  setText("booking-pending-note", pending ? "Requires action" : "All clear");
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

/* ---------- table ---------- */

function filtered() {
  const filter = el.statusFilter?.value || "all";
  const term = (el.search?.value || "").toLowerCase();

  return bookings.filter((b) => {
    const matchesStatus = filter === "all" || b.status === filter;
    const matchesTerm =
      !term ||
      [b.customerName, b.orderId, b.id, b.trailName, b.email].some((v) =>
        String(v || "").toLowerCase().includes(term)
      );
    return matchesStatus && matchesTerm;
  });
}

function statusClass(status) {
  return ["confirmed", "completed", "cancelled"].includes(status) ? status : "pending";
}

function renderTable() {
  const rows = filtered();

  if (!rows.length) {
    el.list.innerHTML = bookings.length
      ? '<tr><td colspan="7" class="admin-empty">No bookings match this filter.</td></tr>'
      : '<tr><td colspan="7" class="admin-empty">No bookings yet. They appear here the moment a customer checks out.</td></tr>';
    return;
  }

  el.list.innerHTML = rows
    .map(
      (b) => `<tr>
      <td>#${escapeHtml(b.orderId)}</td>
      <td><div class="admin-table-avatar-row">${
        b.customerAvatar
          ? `<img src="${escapeHtml(b.customerAvatar)}" class="admin-table-avatar" alt="">`
          : '<div class="admin-table-avatar"></div>'
      }${escapeHtml(b.customerName)}</div></td>
      <td>${escapeHtml(b.trailName)}<div class="admin-table-subtext">${escapeHtml(
        b.packageName
      )}</div></td>
      <td>${escapeHtml(b.date || "-")}</td>
      <td>${peso(b.amount)}</td>
      <td><span class="admin-status-badge admin-status-badge--${statusClass(
        b.status
      )}">${escapeHtml(b.status)}</span></td>
      <td><a class="admin-icon-btn" href="admin-booking-details.html?booking=${encodeURIComponent(
        b.id
      )}" aria-label="View or edit booking" title="View or edit booking">Edit</a></td>
    </tr>`
    )
    .join("");
}

el.statusFilter?.addEventListener("change", renderTable);
el.search?.addEventListener("input", renderTable);

/* ---------- export ---------- */

function closeExportModal() {
  el.exportModal.hidden = true;
  el.exportBackdrop.hidden = true;
}

const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

el.exportBtn?.addEventListener("click", () => {
  el.exportModal.hidden = false;
  el.exportBackdrop.hidden = false;
});
document.getElementById("booking-export-close")?.addEventListener("click", closeExportModal);
document.getElementById("booking-export-cancel")?.addEventListener("click", closeExportModal);
el.exportBackdrop?.addEventListener("click", closeExportModal);

document.querySelectorAll("#booking-export-statuses .admin-export-option").forEach((btn) =>
  btn.addEventListener("click", () => {
    document
      .querySelectorAll("#booking-export-statuses .admin-export-option")
      .forEach((x) => x.classList.remove("is-selected"));
    btn.classList.add("is-selected");
  })
);

document.querySelectorAll("#booking-export-formats button").forEach((btn) =>
  btn.addEventListener("click", () => {
    document
      .querySelectorAll("#booking-export-formats button")
      .forEach((x) => x.classList.remove("is-selected"));
    btn.classList.add("is-selected");
  })
);

document.getElementById("booking-export-submit")?.addEventListener("click", () => {
  const status =
    document.querySelector("#booking-export-statuses .is-selected")?.dataset.status || "all";
  const format =
    document.querySelector("#booking-export-formats .is-selected")?.dataset.format || "csv";
  const start = document.getElementById("booking-export-start").value;
  const end = document.getElementById("booking-export-end").value;

  const rows = bookings.filter(
    (b) =>
      (status === "all" || b.status === status) &&
      (!start || b.date >= start) &&
      (!end || b.date <= end)
  );

  const headers = [
    "Order ID",
    "Customer",
    "Email",
    "Trail",
    "Package",
    "Booking Date",
    "People",
    "Amount",
    "Status",
    "Payment Status"
  ];

  const csv = [
    headers,
    ...rows.map((b) => [
      b.orderId,
      b.customerName,
      b.email,
      b.trailName,
      b.packageName,
      b.date,
      b.groupSize,
      b.amount,
      b.status,
      b.paymentStatus
    ])
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");

  if (format === "pdf") {
    const win = window.open("", "_blank");
    win.document.write(
      `<title>Booking report</title><h1>Trailbound Booking Report</h1><p>${rows.length} booking(s)</p><pre>${csv.replaceAll(
        "<",
        "&lt;"
      )}</pre>`
    );
    win.document.close();
    win.print();
  } else {
    const blob = new Blob(["﻿" + csv], {
      type: format === "excel" ? "application/vnd.ms-excel" : "text/csv;charset=utf-8"
    });
    const link = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `trailbound-bookings-${new Date().toISOString().slice(0, 10)}.${
        format === "excel" ? "xls" : "csv"
      }`
    });
    link.click();
    URL.revokeObjectURL(link.href);
  }

  closeExportModal();
});
