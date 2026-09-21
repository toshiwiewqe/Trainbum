/* ==========================================================
   Trailbound — Payment result (after Maya Checkout)
   Maya sends the customer here with a link like:
     payment-result.html?order=ORDER_ID&status=success
   status can be: success | failed | cancelled

   On success:  order -> "Paid", bookings -> "Confirmed", cart cleared
   On failed / cancelled: order status updated, cart kept so they can retry

   NOTE (school-project simplification): we trust the "status" in
   the link. A real store would confirm with Maya's server using a
   webhook or the "Retrieve Payment Status" API before marking paid.
   ========================================================== */

import { db } from "./firebase-config.js";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { clearCart, updateCartBadge } from "./cart-store.js";
import { showAddressOnMap } from "./shipping-map.js";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("order");
  const status = params.get("status");

  if (!orderId || !status) {
    showProblem("Something's missing", "We couldn't find your order details in the link.");
    return;
  }

  try {
    const orderRef = doc(db, "orders", orderId);
    const snap = await getDoc(orderRef);

    if (!snap.exists()) {
      showProblem("Order not found", "We couldn't find this order. Please contact us if you were charged.");
      return;
    }

    const order = snap.data();

    if (status === "success") {
      // Only confirm once (in case the page is refreshed)
      if (order.status !== "Paid") {
        await Promise.all(
          (order.booking_ids || []).map((id) =>
            updateDoc(doc(db, "bookings", id), {
              status: "Confirmed",
              payment_status: "Paid",
            })
          )
        );
        await updateDoc(orderRef, {
          status: "Paid",
          "payment.status": "Paid (Maya Sandbox)",
          paid_at: new Date().toISOString(),
        });
      }

      clearCart();
      updateCartBadge(document.getElementById("cart-count"));
      showSuccess(orderId, order);
    } else if (status === "cancelled") {
      await updateDoc(orderRef, { status: "Cancelled", "payment.status": "Cancelled" });
      showProblem("Payment cancelled", "You left the Maya page before paying. Your cart is still saved.");
    } else {
      await updateDoc(orderRef, { status: "Payment Failed", "payment.status": "Failed" });
      showProblem("Payment failed", "Maya couldn't process the payment. No money was taken — please try again.");
    }
  } catch (err) {
    console.error("Could not update order:", err);
    showProblem("Something went wrong", "We couldn't update your order. Please try again.");
  }
}

function showSuccess(orderId, order) {
  document.getElementById("result-loading").hidden = true;
  document.getElementById("confirmation-order-id").textContent = orderId;
  document.getElementById("confirmation-order-date").textContent = new Date(order.created_at).toLocaleDateString(
    "en-PH",
    { year: "numeric", month: "long", day: "numeric" }
  );
  document.getElementById("confirmation-order-total").textContent = "₱" + order.total.toLocaleString("en-PH");
  document.getElementById("confirmation-booking-step").hidden = !(order.booking_ids || []).length;
  document.getElementById("confirmation-shipping-step").hidden = !order.shipping;
  document.getElementById("result-success").hidden = false;

  // Show the shipping address on Google Maps
  if (order.shipping) {
    const s = order.shipping;
    const address = [s.address, s.city, s.zip, "Philippines"].filter(Boolean).join(", ");
    document.getElementById("result-address").textContent = address;
    document.getElementById("result-map-section").hidden = false;
    showAddressOnMap("result-map", address, s.location || null, s.location_exact === false ? 13 : 16);
  }
}

function showProblem(title, text) {
  document.getElementById("result-loading").hidden = true;
  document.getElementById("problem-title").textContent = title;
  document.getElementById("problem-text").textContent = text;
  document.getElementById("result-problem").hidden = false;
}
