/* ==========================================================
   Trailbound — Cart Page
   Reads/writes through cart-store.js. Removing a booking line
   here also flips that booking's Firestore status to
   "Cancelled", since the cart line is the only thing standing
   between a reserved slot and an actual paid booking.
   ========================================================== */

import { db } from "./firebase-config.js";
import { doc, updateDoc } from "firebase/firestore";
import {
  getCart,
  getSubtotal,
  updateQty,
  removeItem,
  onCartUpdated,
  updateCartBadge,
  lineTotal,
} from "./cart-store.js";

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  els.list = document.getElementById("cart-list");
  els.layout = document.querySelector(".cart-layout");
  els.empty = document.getElementById("cart-empty");
  els.subtotal = document.getElementById("cart-subtotal");
  els.checkoutBtn = document.getElementById("cart-checkout-btn");
  els.cartCount = document.getElementById("cart-count");

  updateCartBadge(els.cartCount);
  onCartUpdated(() => {
    updateCartBadge(els.cartCount);
    render();
  });

  els.checkoutBtn.addEventListener("click", () => {
    window.location.href = "checkout.html";
  });

  render();
}

function render() {
  const items = getCart();

  els.list.innerHTML = "";

  if (items.length === 0) {
    els.layout.hidden = true;
    els.empty.hidden = false;
    els.checkoutBtn.disabled = true;
    els.subtotal.textContent = "₱0";
    return;
  }

  els.layout.hidden = false;
  els.empty.hidden = true;
  els.checkoutBtn.disabled = false;

  items.forEach((item) => {
    els.list.appendChild(item.type === "booking" ? bookingRow(item) : productRow(item));
  });

  els.subtotal.textContent = "₱" + getSubtotal().toLocaleString("en-PH");
}

function productRow(item) {
  const row = document.createElement("article");
  row.className = "cart-row";
  row.innerHTML = `
    <div class="cart-row-img">
      <img src="${item.image || ""}" alt="${item.name}">
    </div>
    <div class="cart-row-body">
      <span class="cart-row-kind">Gear</span>
      <h4>${item.name}</h4>
      <p class="cart-row-variant">${[item.size, item.color].filter(Boolean).join(" · ") || "—"}</p>
      <p class="cart-row-price">₱${item.price.toLocaleString("en-PH")} each</p>
    </div>
    <div class="cart-row-controls">
      <div class="cart-qty-stepper">
        <button type="button" class="cart-qty-btn" data-action="dec" aria-label="Decrease quantity">−</button>
        <span class="cart-qty-value">${item.qty}</span>
        <button type="button" class="cart-qty-btn" data-action="inc" aria-label="Increase quantity">+</button>
      </div>
      <span class="cart-row-linetotal">₱${lineTotal(item).toLocaleString("en-PH")}</span>
      <button type="button" class="cart-remove-btn">Remove</button>
    </div>
  `;

  row.querySelector('[data-action="dec"]').addEventListener("click", () => {
    updateQty(item.cartItemId, item.qty - 1 <= 0 ? 1 : item.qty - 1);
    if (item.qty - 1 <= 0) removeItem(item.cartItemId);
  });
  row.querySelector('[data-action="inc"]').addEventListener("click", () => {
    updateQty(item.cartItemId, item.qty + 1);
  });
  row.querySelector(".cart-remove-btn").addEventListener("click", () => {
    removeItem(item.cartItemId);
  });

  return row;
}

function bookingRow(item) {
  const m = item.meta || {};
  const row = document.createElement("article");
  row.className = "cart-row cart-row--booking";
  row.innerHTML = `
    <div class="cart-row-img cart-row-img--booking">🥾</div>
    <div class="cart-row-body">
      <span class="cart-row-kind cart-row-kind--booking">Trail booking</span>
      <h4>${m.trailName || item.name}</h4>
      <p class="cart-row-variant">
        ${m.packageName ? m.packageName + " · " : ""}${m.date || ""}${m.groupSize ? " · " + m.groupSize + " pax" : ""}
      </p>
      <p class="cart-row-variant">${m.guideName ? "Guide: " + m.guideName : ""}${m.activity ? " · " + m.activity : ""}</p>
      <p class="cart-row-price">Reserved — pay at checkout to confirm</p>
    </div>
    <div class="cart-row-controls">
      <span class="cart-row-linetotal">₱${item.price.toLocaleString("en-PH")}</span>
      <button type="button" class="cart-remove-btn">Cancel booking</button>
    </div>
  `;

  row.querySelector(".cart-remove-btn").addEventListener("click", async () => {
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
