/* ==========================================================
   Trailbound — Cart Page
   Reads/writes through cart-store.js (unchanged). This file
   adds the reference layout on top: per-item selection,
   delivery/tax estimate, and a promo code — all display-only
   additions that don't touch the cart-store data model.

   Removing a booking line here also flips that booking's
   Firestore status to "Cancelled", since the cart line is the
   only thing standing between a reserved slot and an actual
   paid booking.
   ========================================================== */

import { db } from "./firebase-config.js";
import { doc, updateDoc } from "firebase/firestore";
import {
  getCart,
  updateQty,
  removeItem,
  clearCart,
  onCartUpdated,
  updateCartBadge,
  lineTotal,
} from "./cart-store.js";

const els = {};

// UI-only state — not part of the cart-store data model.
let selectedIds = new Set();
let appliedPromo = null; // { code, rate }

const DELIVERY_FEE = 150;
const TAX_RATE = 0.12; // PH VAT
const PROMO_CODES = { TRAIL10: 0.10, FIRSTHIKE: 0.15 };

const icon = {
  trash: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`,
  copy: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  els.list = document.getElementById("cart-list");
  els.listHeader = document.getElementById("cart-list-header");
  els.listCount = document.getElementById("cart-list-count");
  els.layout = document.querySelector(".cart-layout");
  els.empty = document.getElementById("cart-empty");
  els.checkoutBtn = document.getElementById("cart-checkout-btn");
  els.memberBtn = document.getElementById("cart-member-btn");
  els.cartCount = document.getElementById("cart-count");
  els.selectAll = document.getElementById("cart-select-all");
  els.removeAll = document.getElementById("cart-remove-all");
  els.promoInput = document.getElementById("promo-input");
  els.promoApplyBtn = document.getElementById("promo-apply-btn");
  els.promoMessage = document.getElementById("promo-message");

  els.summary = {
    count: document.getElementById("summary-count"),
    subtotal: document.getElementById("summary-subtotal"),
    delivery: document.getElementById("summary-delivery"),
    tax: document.getElementById("summary-tax"),
    discount: document.getElementById("summary-discount"),
    total: document.getElementById("summary-total"),
  };

  // Render the actual cart contents FIRST, before wiring up anything
  // optional. If a page has an older/partial copy of this markup and
  // one of the elements below doesn't exist, that must never stop the
  // cart list itself from showing.
  syncSelectionWithCart();
  render();

  updateCartBadge(els.cartCount);
  onCartUpdated(() => {
    updateCartBadge(els.cartCount);
    syncSelectionWithCart();
    render();
  });

  safeListen(els.selectAll, "change", () => {
    const items = getCart();
    selectedIds = els.selectAll.checked ? new Set(items.map((i) => i.cartItemId)) : new Set();
    render();
  });

  safeListen(els.removeAll, "click", () => {
    if (!confirm("Remove everything from your cart?")) return;
    clearCart();
  });

  safeListen(els.checkoutBtn, "click", () => {
    window.location.href = "checkout.html";
  });
  safeListen(els.memberBtn, "click", () => {
    window.location.href = "checkout.html?member=1";
  });

  safeListen(els.promoApplyBtn, "click", applyPromo);
  safeListen(els.promoInput, "keydown", (e) => {
    if (e.key === "Enter") applyPromo();
  });
}

// Attaches a listener only if the element actually exists, and never
// lets a missing optional element (e.g. an older copy of cart.html
// without the promo/member-checkout markup) throw and break the rest
// of the page.
function safeListen(el, event, handler) {
  if (!el) {
    console.warn(`cart.js: expected element for "${event}" listener was not found on this page.`);
    return;
  }
  el.addEventListener(event, handler);
}

function peso(n) {
  return "₱" + Math.round(n).toLocaleString("en-PH");
}

// Keep selectedIds in step with the actual cart contents:
// new lines default to selected, removed lines drop out.
function syncSelectionWithCart() {
  const ids = new Set(getCart().map((i) => i.cartItemId));
  selectedIds = new Set([...selectedIds].filter((id) => ids.has(id)));
  getCart().forEach((i) => {
    if (!selectedIds.has(i.cartItemId)) selectedIds.add(i.cartItemId);
  });
}

function applyPromo() {
  if (!els.promoInput || !els.promoMessage) return;
  const code = els.promoInput.value.trim().toUpperCase();
  if (!code) return;
  const rate = PROMO_CODES[code];
  els.promoMessage.hidden = false;
  if (rate) {
    appliedPromo = { code, rate };
    els.promoMessage.textContent = `"${code}" applied — ${Math.round(rate * 100)}% off.`;
    els.promoMessage.className = "promo-message promo-message--ok";
  } else {
    appliedPromo = null;
    els.promoMessage.textContent = "That code isn't valid.";
    els.promoMessage.className = "promo-message promo-message--error";
  }
  renderSummary();
}

function render() {
  const items = getCart();

  els.list.innerHTML = "";

  if (items.length === 0) {
    els.layout.hidden = true;
    els.empty.hidden = false;
    if (els.listHeader) els.listHeader.hidden = true;
    renderSummary();
    return;
  }

  els.layout.hidden = false;
  els.empty.hidden = true;
  if (els.listHeader) els.listHeader.hidden = false;

  if (els.listCount) els.listCount.textContent = String(items.length).padStart(2, "0");
  if (els.selectAll) {
    els.selectAll.checked = items.length > 0 && items.every((i) => selectedIds.has(i.cartItemId));
  }

  items.forEach((item) => {
    els.list.appendChild(item.type === "booking" ? bookingRow(item) : productRow(item));
  });

  renderSummary();
}

function renderSummary() {
  const items = getCart();
  const selected = items.filter((i) => selectedIds.has(i.cartItemId));
  const subtotal = selected.reduce((sum, i) => sum + lineTotal(i), 0);
  const delivery = subtotal > 0 ? DELIVERY_FEE : 0;
  const tax = subtotal * TAX_RATE;
  const discount = appliedPromo ? subtotal * appliedPromo.rate : 0;
  const final = Math.max(0, subtotal + delivery + tax - discount);
  const selectedQty = selected.reduce((sum, i) => sum + (i.type === "booking" ? 1 : i.qty), 0);

  if (els.summary.count) els.summary.count.textContent = `${selectedQty} item${selectedQty !== 1 ? "s" : ""}`;
  if (els.summary.subtotal) els.summary.subtotal.textContent = peso(subtotal);
  if (els.summary.delivery) els.summary.delivery.textContent = peso(delivery);
  if (els.summary.tax) els.summary.tax.textContent = "+" + peso(tax);
  if (els.summary.discount) els.summary.discount.textContent = "−" + peso(discount);
  if (els.summary.total) els.summary.total.textContent = peso(final);

  const canCheckout = selected.length > 0;
  if (els.checkoutBtn) els.checkoutBtn.disabled = !canCheckout;
  if (els.memberBtn) els.memberBtn.disabled = !canCheckout;
}

function rowSelectCheckbox(item) {
  const checked = selectedIds.has(item.cartItemId);
  return `<input type="checkbox" class="cart-checkbox cart-row-select" ${checked ? "checked" : ""} aria-label="Select ${item.name}">`;
}

function productRow(item) {
  const row = document.createElement("article");
  row.className = "cart-row" + (selectedIds.has(item.cartItemId) ? "" : " cart-row--unselected");
  row.innerHTML = `
    ${rowSelectCheckbox(item)}
    <div class="cart-row-img">
      <img src="${item.image || ""}" alt="${item.name}">
    </div>
    <div class="cart-row-body">
      <span class="cart-row-tag">GEAR</span>
      <h4>${item.name}</h4>
      <div class="cart-row-attrs">
        ${item.color ? `<span class="cart-row-attr">Color : <b>${item.color}</b></span>` : ""}
        ${item.size ? `<span class="cart-row-attr">Size : <b>${item.size}</b></span>` : ""}
      </div>
    </div>
    <div class="cart-row-side">
      <div class="cart-row-top">
        <button type="button" class="cart-icon-btn" data-action="duplicate" aria-label="Duplicate item" title="Duplicate">${icon.copy}</button>
        <button type="button" class="cart-icon-btn cart-icon-btn--danger" data-action="remove" aria-label="Remove item" title="Remove">${icon.trash}</button>
      </div>
      <div class="cart-qty-stepper">
        <button type="button" class="cart-qty-btn" data-action="dec" aria-label="Decrease quantity">−</button>
        <span class="cart-qty-value">${String(item.qty).padStart(2, "0")}</span>
        <button type="button" class="cart-qty-btn" data-action="inc" ${item.qty >= 10 ? "disabled" : ""} aria-label="Increase quantity">+</button>
      </div>
      <span class="cart-row-price">${peso(lineTotal(item))}</span>
    </div>
  `;

  row.querySelector(".cart-row-select").addEventListener("change", (e) => {
    if (e.target.checked) selectedIds.add(item.cartItemId);
    else selectedIds.delete(item.cartItemId);
    row.classList.toggle("cart-row--unselected", !e.target.checked);
    if (els.selectAll) els.selectAll.checked = getCart().every((i) => selectedIds.has(i.cartItemId));
    renderSummary();
  });
  row.querySelector('[data-action="dec"]').addEventListener("click", () => {
    if (item.qty - 1 <= 0) removeItem(item.cartItemId);
    else updateQty(item.cartItemId, item.qty - 1);
  });
  row.querySelector('[data-action="inc"]').addEventListener("click", () => {
    updateQty(item.cartItemId, item.qty + 1);
  });
  row.querySelector('[data-action="remove"]').addEventListener("click", () => {
    removeItem(item.cartItemId);
  });
  row.querySelector('[data-action="duplicate"]').addEventListener("click", () => {
    updateQty(item.cartItemId, item.qty + 1);
  });

  return row;
}

function bookingRow(item) {
  const m = item.meta || {};
  const row = document.createElement("article");
  row.className = "cart-row" + (selectedIds.has(item.cartItemId) ? "" : " cart-row--unselected");
  row.innerHTML = `
    ${rowSelectCheckbox(item)}
    <div class="cart-row-img cart-row-img--booking">🥾</div>
    <div class="cart-row-body">
      <span class="cart-row-tag cart-row-tag--booking">TRAIL BOOKING</span>
      <h4>${m.trailName || item.name}</h4>
      <div class="cart-row-attrs">
        ${m.packageName ? `<span class="cart-row-attr">${m.packageName}</span>` : ""}
        ${m.date ? `<span class="cart-row-attr">${m.date}</span>` : ""}
        ${m.groupSize ? `<span class="cart-row-attr">${m.groupSize} pax</span>` : ""}
      </div>
      <p class="cart-row-note">${m.guideName ? "Guide: " + m.guideName : ""}${m.activity ? " · " + m.activity : ""} · Reserved, pay at checkout to confirm</p>
    </div>
    <div class="cart-row-side">
      <div class="cart-row-top">
        <button type="button" class="cart-icon-btn cart-icon-btn--danger" data-action="remove" aria-label="Cancel booking" title="Cancel booking">${icon.trash}</button>
      </div>
      <span class="cart-row-price">${peso(item.price)}</span>
    </div>
  `;

  row.querySelector(".cart-row-select").addEventListener("change", (e) => {
    if (e.target.checked) selectedIds.add(item.cartItemId);
    else selectedIds.delete(item.cartItemId);
    row.classList.toggle("cart-row--unselected", !e.target.checked);
    if (els.selectAll) els.selectAll.checked = getCart().every((i) => selectedIds.has(i.cartItemId));
    renderSummary();
  });

  row.querySelector('[data-action="remove"]').addEventListener("click", async () => {
    const sure = window.confirm(
      `Remove this booking from your cart? This will cancel your reserved slot for ${m.trailName || item.name}.`
    );
    if (!sure) return;
    try {
      await updateDoc(doc(db, "bookings", item.bookingId), { status: "Cancelled" });
    } catch (err) {
      console.error("Failed to cancel booking:", err);
    }
    removeItem(item.cartItemId);
  });

  return row;
}