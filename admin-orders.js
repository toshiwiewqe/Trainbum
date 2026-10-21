/* ==========================================================
   Admin — Products orders
   ----------------------------------------------------------
   checkout.js has been writing to the `orders` collection since
   the Maya integration went in, and nothing ever read it back.
   This is that missing view.

   An order carries both Products lines AND `booking_ids` — the trail
   slots staged in the same cart. So marking an order Paid here
   also confirms those bookings, which is what turns a reserved
   slot into a real one on the customer's account page.
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
  updateOrderStatus,
  watchBookings,
  watchOrders
} from "./trailbound-data.js";

const track = collectUnsubscribers();

/* FIXED. This list was missing "Payment Failed" — which is the status
   on real orders in your database. When the current status is not in
   the list, NO <option> gets `selected`, so the browser falls back to
   the first one and the dropdown reads "Pending Payment" on an order
   whose payment actually FAILED. An admin reading that would think the
   charge was merely outstanding, and touching the control at all would
   write the wrong status back.

   Both halves are fixed: the known statuses are listed here, and
   statusOptions() below also folds in whatever the order actually says,
   so an unrecognised value can never be silently displayed as another
   one. */
const STATUSES = [
  "Pending Payment",
  "Paid",
  "Shipped",
  "Completed",
  "Payment Failed",
  "Refunded",
  "Cancelled"
];

function statusOptions(current) {
  const known = STATUSES.some((s) => lower(s) === lower(current));
  return known ? STATUSES : [current, ...STATUSES];
}

const el = {
  search: document.getElementById("order-search"),
  filter: document.getElementById("order-status-filter"),
  body: document.getElementById("order-body"),
  feedback: document.getElementById("order-feedback"),
  modal: document.getElementById("order-modal"),
  backdrop: document.getElementById("order-modal-backdrop"),
  modalBody: document.getElementById("order-modal-body"),
  modalTitle: document.getElementById("order-modal-title"),
  exportBtn: document.getElementById("order-export-btn"),
  avatarImg: document.getElementById("admin-avatar"),
  avatarFallback: document.getElementById("admin-avatar-fallback"),
  nameEl: document.getElementById("admin-name"),
  logoutBtn: document.getElementById("admin-logout-btn")
};

let orders = [];
let bookings = [];
let adminUser = null;

attachLogoutConfirm(el.logoutBtn);

requireAdmin((user) => {
  adminUser = user;
  renderAdminSidebarProfile(user, {
    avatarImg: el.avatarImg,
    avatarFallback: el.avatarFallback,
    nameEl: el.nameEl
  });

  track(
    watchOrders(
      (items) => {
        orders = items;
        renderStats();
        render();
      },
      { onError: () => showFeedback("Orders could not be loaded. Check your Firestore rules.") }
    )
  );

  // Needed so an order can show, and confirm, the bookings on it.
  track(watchBookings((items) => (bookings = items)));
});

/* ---------- stats ---------- */

const lower = (v) => String(v || "").toLowerCase();

/* FIXED. Your payment_status is not the bare word "Paid" — Maya writes
   "Paid (Maya Sandbox)". The old check was `lower(x) === "paid"`, so a
   paid order failed it and rendered in the RED out-of-stock colour, as
   you saw in the modal. startsWith is what matches the real values.

   Deliberately NOT `includes("paid")`: "Unpaid" contains "paid" and
   would then light up green — the exact opposite mistake. */
const isPaid = (status) => lower(status).startsWith("paid");

function renderStats() {
  const paid = orders.filter((o) => ["paid", "shipped", "completed"].includes(lower(o.status)));
  setText("order-total", orders.length.toLocaleString());
  // Counting only "pending payment" hid every FAILED payment — on your
  // data that is the status orders actually land on when Maya declines.
  const needsAttention = orders.filter((o) =>
    ["pending payment", "payment failed"].includes(lower(o.status))
  );
  const failed = needsAttention.filter((o) => lower(o.status) === "payment failed").length;
  setText("order-pending", needsAttention.length.toLocaleString());
  setText(
    "order-pending-note",
    failed ? `${failed} failed payment(s)` : needsAttention.length ? "Awaiting payment" : "All clear"
  );
  setText("order-paid", paid.length.toLocaleString());
  setText("order-revenue", peso(paid.reduce((sum, o) => sum + o.total, 0)));
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function showFeedback(message) {
  el.feedback.textContent = message;
  el.feedback.hidden = false;
}

/* ---------- table ---------- */

function statusClass(status) {
  const s = lower(status);
  if (["paid", "completed", "shipped"].includes(s)) return "active";
  return "inactive";
}

function visible() {
  const term = (el.search?.value || "").toLowerCase();
  const filter = el.filter?.value || "all";
  return orders.filter((o) => {
    const matchesStatus = filter === "all" || lower(o.status) === filter;
    const matchesTerm =
      !term ||
      [o.orderId, o.customerName, o.email, o.phone, o.shipping?.city, o.checkoutId].some((v) =>
        String(v || "").toLowerCase().includes(term)
      );
    return matchesStatus && matchesTerm;
  });
}

function render() {
  const rows = visible();

  if (!rows.length) {
    el.body.innerHTML = orders.length
      ? '<tr><td colspan="8" class="admin-empty">No orders match this filter.</td></tr>'
      : '<tr><td colspan="8" class="admin-empty">No orders yet. They appear here the moment a customer reaches Maya checkout.</td></tr>';
    return;
  }

  el.body.innerHTML = rows
    .map((o) => {
      const ProductsCount = o.items.reduce((sum, i) => sum + (Number(i.qty) || 1), 0);
      const parts = [];
      if (ProductsCount) parts.push(`${ProductsCount} Products`);
      if (o.bookingIds.length) parts.push(`${o.bookingIds.length} booking`);

      return `<tr>
      <td><strong>#${escapeHtml(o.orderId)}</strong><small>${escapeHtml(
        timeAgo(o.createdAt)
      )}</small></td>
      <td>${escapeHtml(o.customerName || "Guest")}<div class="admin-table-subtext">${escapeHtml(
        o.email
      )}</div></td>
      <td>${escapeHtml(parts.join(" · ") || "—")}</td>
      <td>${
        o.shipping
          ? escapeHtml([o.shipping.city, o.shipping.region].filter(Boolean).join(", "))
          : '<span class="admin-table-subtext">Booking only</span>'
      }</td>
      <td>${peso(o.total)}</td>
      <td><span class="admin-product-status admin-product-status--${
        isPaid(o.paymentStatus) ? "active" : "inactive"
      }">${escapeHtml(o.paymentStatus)}</span>${
        o.isSandbox
          ? '<div class="admin-table-subtext" style="color:#facc15">sandbox</div>'
          : ""
      }</td>
      <td><span class="admin-product-status admin-product-status--${statusClass(
        o.status
      )}">${escapeHtml(o.status)}</span></td>
      <td><div class="admin-product-actions"><button type="button" data-action="view" data-id="${
        o.id
      }">View</button></div></td>
    </tr>`;
    })
    .join("");
}

el.search?.addEventListener("input", render);
el.filter?.addEventListener("change", render);

/* ---------- detail modal ---------- */

function openOrder(order) {
  el.modalTitle.textContent = `Order #${order.orderId}`;

  const linked = bookings.filter((b) => order.bookingIds.includes(b.id));
  const created = toDate(order.createdAt);

  el.modalBody.innerHTML = `
    <div class="admin-order-detail">
      <div class="order-info-grid">
        <p><small>Customer</small><strong>${escapeHtml(order.customerName || "Guest")}</strong></p>
        <p><small>Email</small>${escapeHtml(order.email || "—")}</p>
        <p><small>Phone</small>${escapeHtml(order.phone || "—")}</p>
        <p><small>Placed</small>${escapeHtml(
          created ? created.toLocaleString("en-US") : "—"
        )}</p>
      </div>

      ${
        order.emergencyContact
          ? `<p class="admin-form-subheading">Emergency contact</p>
             <p class="admin-order-line">${escapeHtml(
               order.emergencyContact.name || ""
             )} · ${escapeHtml(order.emergencyContact.phone || "")}${
              order.emergencyContact.relation
                ? ` · ${escapeHtml(order.emergencyContact.relation)}`
                : ""
            }</p>`
          : ""
      }

      ${
        order.shipping
          ? `<p class="admin-form-subheading">Shipping</p>
             <p class="admin-order-line">${escapeHtml(
               [
                 order.shipping.address,
                 order.shipping.city,
                 order.shipping.zip,
                 order.shipping.region
               ]
                 .filter(Boolean)
                 .join(", ")
             )}${
              order.shipping.location_exact === false
                ? '<br><span class="admin-table-subtext">Address matched to city only — worth confirming before dispatch.</span>'
                : ""
            }${
              order.shipping.notes
                ? `<br><span class="admin-table-subtext">Note: ${escapeHtml(
                    order.shipping.notes
                  )}</span>`
                : ""
            }</p>`
          : ""
      }

      ${
        order.items.length
          ? `<p class="admin-form-subheading">Products</p>
             ${order.items
               .map(
                 (i) =>
                   `<div class="admin-payment-line"><span>${escapeHtml(
                     i.name || "Item"
                   )} ×${Number(i.qty) || 1}${
                     i.size ? ` · ${escapeHtml(i.size)}` : ""
                   }${i.color ? ` · ${escapeHtml(i.color)}` : ""}</span><strong>${peso(
                     (Number(i.price) || 0) * (Number(i.qty) || 1)
                   )}</strong></div>`
               )
               .join("")}`
          : ""
      }

      ${
        linked.length
          ? `<p class="admin-form-subheading">Trail bookings on this order</p>
             ${linked
               .map(
                 (b) =>
                   `<div class="admin-payment-line"><span>${escapeHtml(
                     b.trailName
                   )} · ${escapeHtml(b.date || "no date")} · ${
                     b.groupSize
                   } pax <span class="admin-product-status admin-product-status--${
                     b.status === "cancelled" ? "inactive" : "active"
                   }">${escapeHtml(b.statusLabel)}</span></span><strong>${peso(
                     b.amount
                   )}</strong></div>`
               )
               .join("")}`
          : order.bookingIds.length
          ? `<p class="admin-form-subheading">Trail bookings</p>
             <p class="admin-table-subtext">${order.bookingIds.length} booking id(s) on this order could not be found — they may have been deleted.</p>`
          : ""
      }

      <div class="admin-payment-line"><span>Subtotal</span><strong>${peso(
        order.subtotal
      )}</strong></div>
      <div class="admin-payment-line"><span>Shipping</span><strong>${peso(
        order.shippingFee
      )}</strong></div>
      <div class="admin-payment-total"><span>Total</span><strong>${peso(
        order.total
      )}</strong></div>

      <div class="payment-state ${
        isPaid(order.paymentStatus) ? "payment-state--paid" : ""
      }">Payment: ${escapeHtml(order.paymentStatus)}</div>

      <!-- The payment block, in full. The method was never shown, and
           "maya_checkout_sandbox" vs a live method is the difference
           between a real payment and a test one. The checkout id was
           truncated to 12 characters, which is useless for reconciling
           a charge in the Maya dashboard — it is selectable in full. -->
      <div class="order-info-grid" style="margin-top:.8rem">
        <p><small>Method</small><strong>${escapeHtml(order.paymentMethod || "—")}</strong></p>
        <p><small>Account</small><strong>${
          order.uid ? "Signed-in customer" : "Guest \u2014 no account"
        }</strong></p>
      </div>
      ${
        order.isSandbox
          ? '<p class="admin-table-subtext" style="margin-top:.5rem;color:#facc15">This went through a SANDBOX checkout \u2014 no money moved. Do not treat it as revenue.</p>'
          : ""
      }
      ${
        order.checkoutId
          ? `<p class="admin-form-subheading" style="margin-top:.9rem">Maya checkout ID</p>
             <p class="admin-order-line" style="user-select:all;word-break:break-all;font-family:ui-monospace,monospace;font-size:.74rem">${escapeHtml(
               order.checkoutId
             )}</p>`
          : ""
      }

      <p class="admin-form-subheading" style="margin-top:1.1rem">Order status</p>
      <select class="admin-text-input" id="order-status-select">
        ${statusOptions(order.status).map(
          (s) =>
            `<option value="${s}"${
              lower(s) === lower(order.status) ? " selected" : ""
            }>${s}</option>`
        ).join("")}
      </select>
      <p class="admin-table-subtext" id="order-status-note" style="margin-top:.5rem">
        ${
          linked.length
            ? "Setting this to Paid also confirms the trail bookings above. "
            : "The customer is notified when this changes. "
        }Shipped or Completed takes the Products off stock; Cancelled or Refunded puts it back.${
          order.stockDeductedAt ? " Stock has already been deducted for this order." : ""
        }
      </p>
    </div>`;

  el.modal.hidden = false;
  el.backdrop.hidden = false;

  document
    .getElementById("order-status-select")
    ?.addEventListener("change", async (event) => {
      const select = event.target;
      const note = document.getElementById("order-status-note");
      const newStatus = select.value;
      select.disabled = true;
      if (note) note.textContent = "Saving...";

      try {
        const stock = await updateOrderStatus(order, newStatus, adminUser);

        // Paying for an order is what confirms the trail slots that
        // were staged in the same cart.
        if (lower(newStatus) === "paid") {
          for (const booking of linked) {
            if (booking.status !== "confirmed" && booking.status !== "cancelled") {
              await updateBookingStatus(booking, "Confirmed", adminUser);
            }
          }
        }
        if (note) {
          const bits = [
            lower(newStatus) === "paid" && linked.length
              ? `Saved — ${linked.length} booking(s) confirmed and the customer notified.`
              : "Saved and the customer notified."
          ];

          /* Say what happened to stock here, rather than leaving it to
             be noticed on the Products table days later. The awkward
             cases are the ones worth naming: a line that could not be
             fully covered, and a product with no count to subtract. */
          if (stock?.error) {
            bits.push(`Stock could NOT be updated: ${stock.error}`);
          } else if (stock?.alreadyDone) {
            bits.push(
              stock.direction === "deduct"
                ? "Stock was already deducted for this order, so nothing was taken twice."
                : "No stock had been deducted for this order, so nothing was returned."
            );
          } else if (stock?.applied?.length) {
            bits.push(
              stock.direction === "deduct"
                ? `${stock.applied.length} product(s) taken off stock.`
                : `${stock.applied.length} product(s) returned to stock.`
            );
            if (stock.shortfalls?.length) {
              bits.push(
                "Short on: " +
                  stock.shortfalls
                    .map((f) => `${f.name} (needed ${f.asked}, had ${f.had})`)
                    .join(", ") +
                  ". Those are now at zero — check what you actually shipped."
              );
            }
            if (stock.untracked?.length) {
              bits.push(
                `${stock.untracked.length} product(s) have no stock count, so nothing was subtracted for them.`
              );
            }
            if (stock.missing?.length) {
              bits.push(`${stock.missing.length} product(s) on this order no longer exist.`);
            }
          }

          note.textContent = bits.join(" ");
          const needsAttention = Boolean(
            stock?.error || stock?.shortfalls?.length || stock?.missing?.length
          );
          note.style.color = needsAttention ? "#facc15" : "";
        }
      } catch (err) {
        console.error("Order status update failed:", err);
        select.value = order.status;
        if (note) note.textContent = "Could not save. Check your Firestore rules.";
      } finally {
        select.disabled = false;
      }
    });
}

/* ==========================================================
   NO ORDER EDITING — by design
   ----------------------------------------------------------
   An editor for the contact and delivery fields used to live here.
   It is gone at your instruction, and it is the right call: an order
   is the record of a transaction that already happened. A panel that
   can quietly rewrite what a customer gave at checkout is a panel you
   cannot lean on when that customer disputes a charge.

   The order status dropdown is the one thing still writable, because
   that is workflow (dispatch, refund) rather than the record itself,
   and every change to it goes through the audit log.

   If a mistyped address ever blocks a dispatch, correct it in the
   Firebase console so the change is yours and traceable, not the
   panel's.
   ========================================================== */

function closeModal() {
  el.modal.hidden = true;
  el.backdrop.hidden = true;
  el.modalBody.innerHTML = "";
}

el.body?.addEventListener("click", (event) => {
  const button = event.target.closest('button[data-action="view"]');
  if (!button) return;
  const order = orders.find((o) => o.id === button.dataset.id);
  if (order) openOrder(order);
});

document.getElementById("order-modal-close")?.addEventListener("click", closeModal);
el.backdrop?.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.modal.hidden) closeModal();
});

/* ---------- export ---------- */

const csvCell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;

el.exportBtn?.addEventListener("click", () => {
  const rows = [
    ["Order ID", "Customer", "Email", "Phone", "Products items", "Bookings", "Subtotal", "Shipping", "Total", "Status", "Payment", "Method", "Checkout ID", "Ship to", "Placed"],
    ...visible().map((o) => [
      o.orderId,
      o.customerName,
      o.email,
      o.phone,
      o.items.reduce((sum, i) => sum + (Number(i.qty) || 1), 0),
      o.bookingIds.length,
      o.subtotal,
      o.shippingFee,
      o.total,
      o.status,
      o.paymentStatus,
      o.paymentMethod,
      o.checkoutId,
      [o.shipping?.address, o.shipping?.city, o.shipping?.zip, o.shipping?.region]
        .filter(Boolean).join(", "),
      toDate(o.createdAt)?.toISOString() || ""
    ])
  ];

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const link = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })),
    download: `trailbound-orders-${new Date().toISOString().slice(0, 10)}.csv`
  });
  link.click();
  URL.revokeObjectURL(link.href);
});