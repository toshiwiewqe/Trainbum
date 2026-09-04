/* ==========================================================
   Trailbound — Checkout
   3-step wizard: Shipping -> Payment (simulated) -> Review.
   On "Place Order":
     - writes an order doc to Firestore ("orders" collection)
     - flips any booking cart lines from Pending -> Confirmed
     - clears the cart

   Payment here is entirely simulated (no network call to a
   processor) — the "payment" object saved on the order records
   a masked card number and a status of "Paid (Simulated)" so
   it's obvious in Firestore this wasn't a real charge yet.
   Swapping in real Stripe/PayPal happens inside
   handlePlaceOrder(), replacing the simulated block — the rest
   of the flow (steps, review, order doc shape) stays the same.

   Shipping region and payment method are presented as selectable
   cards (instead of a <select> / fixed fields) — shippingCost()
   and handlePlaceOrder() read the currently-checked radio inputs
   rather than a single form control.

   TODO (after Auth is added): attach `user_id` to the order doc
   here, same as the TODO already in booking.js, and add a
   Firestore-backed "My Orders" list next to "My Bookings".
   ========================================================== */

import { db } from "./firebase-config.js";
import { collection, addDoc, doc, updateDoc } from "firebase/firestore";
import {
  getCart,
  getSubtotal,
  clearCart,
  hasProducts,
  onCartUpdated,
  updateCartBadge,
  lineTotal,
} from "./cart-store.js";

const SHIPPING_RATES = {
  ncr: 100,       // Metro Manila
  luzon: 150,     // Luzon, outside NCR
  visayas: 200,
  mindanao: 220,
}; // ₱ — only charged if the order includes gear; free for booking-only orders

const REGION_LABELS = {
  ncr: "Metro Manila (NCR)",
  luzon: "Luzon (outside NCR)",
  visayas: "Visayas",
  mindanao: "Mindanao",
};

const STEP_COUNT = 3;

const els = {};
let currentStep = 1;

document.addEventListener("DOMContentLoaded", init);

function init() {
  els.cartCount = document.getElementById("cart-count");
  els.eyebrow = document.getElementById("checkout-eyebrow");
  els.stepper = document.getElementById("checkout-stepper");
  els.form = document.getElementById("checkout-form");
  els.panels = document.querySelectorAll(".checkout-panel");
  els.tabs = document.querySelectorAll(".checkout-step-tab");
  els.shippingNote = document.getElementById("shipping-note");
  els.regionGroup = document.getElementById("ship-region-group");
  els.regionError = document.getElementById("region-error");
  els.payMethodGroup = document.getElementById("pay-method-group");
  els.reviewShippingSection = document.getElementById("review-shipping-section");
  els.reviewShippingSummary = document.getElementById("review-shipping-summary");
  els.reviewPaymentSummary = document.getElementById("review-payment-summary");
  els.reviewList = document.getElementById("checkout-review-list");
  els.reviewSubtotal = document.getElementById("review-subtotal");
  els.reviewShipping = document.getElementById("review-shipping");
  els.reviewTotal = document.getElementById("review-total");
  els.summaryList = document.getElementById("checkout-summary-list");
  els.summaryTotal = document.getElementById("summary-total");
  els.checkoutError = document.getElementById("checkout-error");
  els.placeOrderBtn = document.getElementById("place-order-btn");
  els.checkoutLayout = document.querySelector(".checkout-layout");
  els.confirmation = document.getElementById("checkout-confirmation");
  els.confirmationOrderId = document.getElementById("confirmation-order-id");
  els.confirmationOrderDate = document.getElementById("confirmation-order-date");
  els.confirmationOrderTotal = document.getElementById("confirmation-order-total");
  els.confirmationBookingStep = document.getElementById("confirmation-booking-step");
  els.confirmationShippingStep = document.getElementById("confirmation-shipping-step");
  els.emptyState = document.getElementById("checkout-empty");

  updateCartBadge(els.cartCount);
  onCartUpdated(() => updateCartBadge(els.cartCount));

  if (getCart().length === 0) {
    els.stepper.hidden = true;
    els.checkoutLayout.hidden = true;
    els.emptyState.hidden = false;
    return;
  }

  if (!hasProducts()) {
    els.shippingNote.hidden = false;
    els.reviewShippingSection.hidden = true;
  }

  bindNav();
  bindOptionCardGroup(els.regionGroup, () => {
    els.regionError.hidden = true;
    renderSummary();
  });
  bindOptionCardGroup(els.payMethodGroup);
  renderSummary();
  els.form.addEventListener("submit", handlePlaceOrder);
}

/* ---------- Selectable option cards (region / payment method) ---------- */
function bindOptionCardGroup(group, onChange) {
  if (!group) return;
  group.querySelectorAll(".option-card").forEach((card) => {
    const input = card.querySelector("input[type='radio']");
    if (input.disabled) return;
    card.addEventListener("click", () => {
      group.querySelectorAll(".option-card").forEach((c) => c.classList.remove("is-selected"));
      card.classList.add("is-selected");
      input.checked = true;
      if (onChange) onChange();
    });
  });
}

function getSelectedRegion() {
  return els.regionGroup.querySelector("input[name='ship-region']:checked")?.value ?? null;
}

function getSelectedPaymentMethod() {
  return els.payMethodGroup.querySelector("input[name='pay-method']:checked")?.value ?? "card";
}

/* ---------- Step navigation ---------- */
function bindNav() {
  document.querySelectorAll("[data-next]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!validateStep(currentStep)) return;
      goToStep(Number(btn.dataset.next));
    });
  });
  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => goToStep(Number(btn.dataset.back)));
  });
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => goToStep(Number(btn.dataset.edit)));
  });
}

function validateStep(step) {
  const panel = document.querySelector(`.checkout-panel[data-panel="${step}"]`);
  const inputs = panel.querySelectorAll("input[required]:not([type='radio'])");
  for (const input of inputs) {
    if (!input.reportValidity()) return false;
  }
  if (step === 1 && hasProducts() && !getSelectedRegion()) {
    els.regionError.hidden = false;
    els.regionGroup.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }
  return true;
}

function goToStep(step) {
  currentStep = step;

  els.panels.forEach((p) => p.classList.toggle("is-active", Number(p.dataset.panel) === step));
  els.tabs.forEach((t) => {
    const n = Number(t.dataset.step);
    t.classList.toggle("is-active", n === step);
    t.classList.toggle("is-done", n < step);
  });
  els.eyebrow.textContent = `Step ${step} of ${STEP_COUNT}`;

  if (step === 3) renderReview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- Rendering ---------- */
function renderSummary() {
  const items = getCart();
  els.summaryList.innerHTML = items
    .map(
      (i) => `
        <div class="checkout-summary-item">
          <span class="checkout-summary-item-name">${i.name}${i.type === "product" ? ` ×${i.qty}` : ""}</span>
          <span>₱${lineTotal(i).toLocaleString("en-PH")}</span>
        </div>`
    )
    .join("");
  els.summaryTotal.textContent = "₱" + computeTotal().toLocaleString("en-PH");
}

function renderReview() {
  const items = getCart();

  els.reviewList.innerHTML = items
    .map((i) => {
      const metaLine =
        i.type === "booking"
          ? [i.meta?.date, i.meta?.groupSize ? `${i.meta.groupSize} pax` : null, i.meta?.guideName]
              .filter(Boolean)
              .join(" · ")
          : [i.size, i.color, `Qty ${i.qty}`].filter(Boolean).join(" · ");
      const icon = i.type === "booking" ? "🥾" : "🎒";

      return `
        <div class="checkout-review-item">
          <span class="checkout-review-item-icon">${icon}</span>
          <span class="checkout-review-item-name">
            ${i.name}
            <span class="checkout-review-item-meta">${metaLine}</span>
          </span>
          <span>₱${lineTotal(i).toLocaleString("en-PH")}</span>
        </div>`;
    })
    .join("");

  if (hasProducts()) {
    const region = getSelectedRegion();
    els.reviewShippingSummary.innerHTML = `
      ${val("ship-name")}<br />
      ${val("ship-address")}, ${val("ship-city")}<br />
      ${region ? REGION_LABELS[region] : ""} ${val("ship-zip")}<br />
      <span class="checkout-review-summary-muted">${val("ship-phone")} · ${val("ship-email")}</span>
    `;
  }

  const method = getSelectedPaymentMethod();
  if (method === "card") {
    const cardNumber = val("pay-number").replace(/\s+/g, "");
    els.reviewPaymentSummary.innerHTML = `
      Credit / Debit Card ending in ${cardNumber.slice(-4) || "····"}<br />
      <span class="checkout-review-summary-muted">${val("pay-name")} · Simulated payment (no real charge)</span>
    `;
  } else {
    els.reviewPaymentSummary.textContent = "Selected payment method not yet supported.";
  }

  const subtotal = getSubtotal();
  const shipping = shippingCost();

  els.reviewSubtotal.textContent = "₱" + subtotal.toLocaleString("en-PH");
  els.reviewShipping.textContent = shipping === 0 ? "Free" : "₱" + shipping.toLocaleString("en-PH");
  els.reviewTotal.textContent = "₱" + computeTotal().toLocaleString("en-PH");
}

function shippingCost() {
  if (!hasProducts()) return 0;
  const region = getSelectedRegion();
  return SHIPPING_RATES[region] ?? SHIPPING_RATES.ncr; // default until step 1 is filled in
}

function computeTotal() {
  return getSubtotal() + shippingCost();
}

/* ---------- Place order ---------- */
async function handlePlaceOrder(e) {
  e.preventDefault();
  if (!validateStep(3)) return;

  els.checkoutError.hidden = true;
  els.placeOrderBtn.disabled = true;
  els.placeOrderBtn.textContent = "Processing payment…";

  const items = getCart();
  const bookingItems = items.filter((i) => i.type === "booking");
  const productItems = items.filter((i) => i.type === "product");

  const shipping = {
    name: val("ship-name"),
    email: val("ship-email"),
    phone: val("ship-phone"),
    address: val("ship-address"),
    city: val("ship-city"),
    region: getSelectedRegion(),
    zip: val("ship-zip"),
    notes: val("ship-notes"),
  };

  // --- Simulated payment. Swap this block for a real Stripe/PayPal
  // charge later; everything below expects a `{ status, last4 }` shape. ---
  const cardNumber = val("pay-number").replace(/\s+/g, "");
  const payment = {
    method: "simulated",
    status: "Paid (Simulated)",
    last4: cardNumber.slice(-4),
    name_on_card: val("pay-name"),
  };

  const createdAt = new Date();

  const order = {
    items: productItems.map((i) => ({
      productId: i.productId,
      name: i.name,
      price: i.price,
      qty: i.qty,
      size: i.size,
      color: i.color,
    })),
    booking_ids: bookingItems.map((i) => i.bookingId),
    shipping: hasProducts() ? shipping : null,
    payment,
    subtotal: getSubtotal(),
    shipping_fee: shippingCost(),
    total: computeTotal(),
    status: "Paid",
    created_at: createdAt.toISOString(),
    // TODO: add `user_id: currentUser.uid` here once Auth is wired up
  };

  try {
    const orderRef = await addDoc(collection(db, "orders"), order);

    await Promise.all(
      bookingItems.map((i) =>
        updateDoc(doc(db, "bookings", i.bookingId), {
          status: "Confirmed",
          payment_status: "Paid",
        })
      )
    );

    clearCart();
    showConfirmation(orderRef.id, createdAt, order.total, bookingItems.length > 0, hasProducts());
  } catch (err) {
    console.error("Failed to place order:", err);
    els.checkoutError.textContent = "Something went wrong placing your order. Please try again.";
    els.checkoutError.hidden = false;
    els.placeOrderBtn.disabled = false;
    els.placeOrderBtn.textContent = "Place Order";
  }
}

function val(id) {
  return document.getElementById(id).value.trim();
}

function showConfirmation(orderId, createdAt, total, hasBookings, hadProducts) {
  els.stepper.hidden = true;
  els.checkoutLayout.hidden = true;
  els.confirmationOrderId.textContent = orderId;
  els.confirmationOrderDate.textContent = createdAt.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  els.confirmationOrderTotal.textContent = "₱" + total.toLocaleString("en-PH");
  els.confirmationBookingStep.hidden = !hasBookings;
  els.confirmationShippingStep.hidden = !hadProducts;
  els.confirmation.hidden = false;
}
