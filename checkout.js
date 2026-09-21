/* ==========================================================
   Trailbound — Checkout (single page)
   Layout: Review information (Contact / Emergency contact /
   Ship to, each with "Change") -> Payment (Maya only) ->
   Remember me -> Pay Now.

   THREE SEPARATE POPUPS — each edits its own thing only:
     1. Contact details    — their name, email, phone
     2. Emergency contact  — name, country code + number, relation
     3. Shipping address   — street, city, ZIP, region + the map
   Booking-only orders (no gear) never see the shipping popup.

   RULES: the customer cannot pay until
     - contact details pass checkContact(),
     - an emergency contact passes checkEmergency() and is NOT
       their own number, and
     - for orders with gear, the address passes checkAddress()
       AND is actually found in the Philippines by findAddress().
       If the place doesn't exist, they're blocked.

   PAYMENT: Maya Checkout (Sandbox / test mode).
     1. Save the order to Firestore as "Pending Payment"
     2. Ask Maya for a payment link (maya.js)
     3. Send the customer to Maya's page
   Maya sends them back to payment-result.html, which marks the
   order Paid / Failed / Cancelled, confirms bookings, and clears
   the cart only on success.

   TODO (after Auth is added): attach `user_id` to the order doc.
   ========================================================== */

import { db } from "./firebase-config.js";
import { collection, addDoc, doc, updateDoc } from "firebase/firestore";
import {
  getCart,
  getSubtotal,
  hasProducts,
  onCartUpdated,
  updateCartBadge,
  lineTotal,
} from "./cart-store.js";
import { auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { createMayaCheckout } from "./maya.js";
import { showAddressOnMap } from "./shipping-map.js";
import {
  checkContact,
  checkEmergency,
  checkAddress,
  findAddress,
  normalizePhone,
} from "./address-check.js";

onAuthStateChanged(auth, (user) => {
  if (!user) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `login.html?redirect=${returnTo}`;
  }
});

const SHIPPING_RATES = { ncr: 100, luzon: 150, visayas: 200, mindanao: 220 }; // ₱, gear only

const REGION_LABELS = {
  ncr: "Metro Manila (NCR)",
  luzon: "Luzon (outside NCR)",
  visayas: "Visayas",
  mindanao: "Mindanao",
};

const REMEMBER_KEY = "trailbound_checkout";

const CONTACT_IDS = ["ship-name", "ship-email", "ship-phone"];
const EMERGENCY_IDS = ["emg-name", "emg-number", "emg-relation"];
const SHIPPING_IDS = ["ship-address", "ship-city", "ship-zip", "ship-notes"];

const els = {};
let needsAddress = false;  // true when the cart has gear to ship
let contact = null;        // saved contact details (null = not yet)
let emergency = null;      // saved emergency contact (null = not yet)
let shipping = null;       // saved shipping address (null = not yet)
let checkedAddress = null; // address that passed the map lookup

document.addEventListener("DOMContentLoaded", init);

function init() {
  [
    "cart-count", "co-layout", "checkout-empty",
    "review-contact", "review-emergency", "review-ship-to",
    "row-emergency", "row-ship", "review-map", "remember-me",
    "checkout-error", "pay-btn", "pay-hint", "crumb-info", "crumb-pay",
    "summary-list", "summary-count", "summary-subtotal",
    "summary-shipping", "summary-shipping-row", "summary-total",
    "contact-dialog", "contact-form",
    "emergency-dialog", "emergency-form", "emg-code",
    "shipping-dialog", "shipping-form", "shipping-save",
    "ship-region-group", "address-msg", "dialog-map",
  ].forEach((id) => (els[toKey(id)] = document.getElementById(id)));

  updateCartBadge(els.cartCount);
  onCartUpdated(() => updateCartBadge(els.cartCount));

  if (getCart().length === 0) {
    els.coLayout.hidden = true;
    els.checkoutEmpty.hidden = false;
    return;
  }

  needsAddress = hasProducts();
  if (!needsAddress) {
    els.rowShip.hidden = true;           // booking-only: no shipping row
    els.summaryShippingRow.hidden = true;
  }

  bindDialogs();
  bindRegionCards();
  loadRemembered();

  els.rememberMe.addEventListener("change", () => {
    if (els.rememberMe.checked) remember();
    else safeStorage("remove");
  });
  els.payBtn.addEventListener("click", handlePay);

  render();
  openNextMissing(); // first visit: start them on whatever is still blank
}

/** Opens the first popup that still has nothing saved in it. */
function openNextMissing() {
  if (!contact) openDialog("contact");
  else if (!emergency) openDialog("emergency");
  else if (needsAddress && !shipping) openDialog("shipping");
}

/* ================= Popups ================= */

function bindDialogs() {
  // "Change" buttons in the review card
  document.querySelectorAll("[data-open]").forEach((btn) =>
    btn.addEventListener("click", () => openDialog(btn.dataset.open))
  );

  // Close buttons (× and Cancel) + clicking the dark background
  [els.contactDialog, els.emergencyDialog, els.shippingDialog].forEach((dlg) => {
    dlg.querySelectorAll("[data-close]").forEach((btn) =>
      btn.addEventListener("click", () => dlg.close())
    );
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
  });

  // Clear a field's error as soon as it's edited
  [...CONTACT_IDS, ...EMERGENCY_IDS].forEach((id) =>
    document.getElementById(id).addEventListener("input", () => clearError(id))
  );
  els.emgCode.addEventListener("change", () => clearError("emg-number"));

  // Editing any address field means the map check must run again
  SHIPPING_IDS.forEach((id) =>
    document.getElementById(id).addEventListener("input", () => {
      clearError(id);
      if (id !== "ship-notes") resetAddressCheck();
    })
  );

  els.contactForm.addEventListener("submit", saveContact);
  els.emergencyForm.addEventListener("submit", saveEmergency);
  els.shippingForm.addEventListener("submit", saveShipping);
}

function openDialog(which) {
  if (which === "contact") {
    if (contact) fillContact(contact);
    els.contactDialog.showModal();
    return;
  }

  if (which === "emergency") {
    if (emergency) fillEmergency(emergency);
    els.emergencyDialog.showModal();
    return;
  }

  if (!needsAddress) return;
  if (shipping) {
    fillShipping(shipping);
    // Already confirmed — show the map and let them save straight away
    checkedAddress = shipping;
    showAddressResult(shipping.location_exact ? "exact" : "city", shipping);
  }
  els.shippingDialog.showModal();
}

/* ---------- Contact popup ---------- */

function saveContact(e) {
  e.preventDefault();

  const values = {
    name: val("ship-name"),
    email: val("ship-email"),
    phone: val("ship-phone"),
  };

  const errors = checkContact(values);
  showErrors(errors);
  if (Object.keys(errors).length > 0) return;

  contact = values;
  remember();
  els.contactDialog.close();
  render();
  openNextMissing(); // straight on to whatever is still blank
}

/* ---------- Emergency contact popup ---------- */

function saveEmergency(e) {
  e.preventDefault();

  const values = {
    name: val("emg-name"),
    code: els.emgCode.value,
    number: val("emg-number"),
    relation: val("emg-relation"),
  };

  const errors = checkEmergency(values, contact?.phone);
  showErrors(errors);
  if (Object.keys(errors).length > 0) return;

  // Store the tidied-up number, so "0917…" and "+63 917…" both
  // end up saved the same way
  const { national } = normalizePhone(values.code, values.number);
  emergency = { ...values, number: national };
  setVal("emg-number", national);
  remember();
  els.emergencyDialog.close();
  render();
  openNextMissing();
}

/* ---------- Shipping popup ---------- */

async function saveShipping(e) {
  e.preventDefault();

  // Second click: the address already passed the check -> save it
  if (checkedAddress) {
    shipping = checkedAddress;
    remember();
    els.shippingDialog.close();
    render();
    return;
  }

  const values = {
    address: val("ship-address"),
    city: val("ship-city"),
    zip: val("ship-zip"),
    region: getRegion(),
    notes: val("ship-notes"),
  };

  const errors = checkAddress(values);
  showErrors(errors);
  if (Object.keys(errors).length > 0) return;

  // Look the address up on the map
  els.shippingSave.disabled = true;
  els.shippingSave.textContent = "Checking address…";
  const result = await findAddress(values);
  els.shippingSave.disabled = false;

  if (result.status === "notFound") {
    els.shippingSave.textContent = "Check address";
    showErrors({
      "ship-city": `We couldn't find "${values.city}" in the Philippines. Please check the spelling.`,
    });
    setMessage("error", "This address couldn't be found. Please fix it before continuing.");
    els.dialogMap.hidden = true;
    return;
  }

  checkedAddress = {
    ...values,
    location: result.location || null,
    location_exact: result.status === "exact",
  };
  showAddressResult(result.status, checkedAddress);
}

function showAddressResult(status, details) {
  const text = addressText(details);

  if (status === "exact") {
    setMessage("ok", "✓ Address found. Check that the pin is in the right place, then save.");
    showAddressOnMap("dialog-map", text, details.location, 17);
  } else if (status === "city") {
    setMessage(
      "warn",
      `We found ${details.city}, but not your exact street. The pin shows your city — ` +
        "make sure your house no., street, and barangay are complete, then save."
    );
    showAddressOnMap("dialog-map", text, details.location, 14);
  } else {
    // "offline": the search service didn't answer — let Google search the text
    setMessage("warn", "We couldn't check the map right now. Please double-check your address, then save.");
    showAddressOnMap("dialog-map", text, null, 16);
  }
  els.shippingSave.textContent = "Save address";
}

function resetAddressCheck() {
  if (!checkedAddress) return;
  checkedAddress = null;
  els.addressMsg.hidden = true;
  els.dialogMap.hidden = true;
  els.shippingSave.textContent = "Check address";
}

/* ================= Region cards ================= */

function bindRegionCards() {
  els.shipRegionGroup.querySelectorAll(".option-card").forEach((card) => {
    const input = card.querySelector("input");
    card.addEventListener("click", () => {
      setRegion(input.value);
      clearError("ship-region");
      resetAddressCheck();
    });
  });
}

function setRegion(value) {
  els.shipRegionGroup.querySelectorAll(".option-card").forEach((card) => {
    const input = card.querySelector("input");
    const on = input.value === value;
    input.checked = on;
    card.classList.toggle("is-selected", on);
  });
}

function getRegion() {
  return els.shipRegionGroup.querySelector("input:checked")?.value ?? "";
}

/* ================= Fields ================= */

function fillContact(d) {
  setVal("ship-name", d.name);
  setVal("ship-email", d.email);
  setVal("ship-phone", d.phone);
}

function fillEmergency(d) {
  setVal("emg-name", d.name);
  setVal("emg-number", d.number);
  setVal("emg-relation", d.relation);
  if (d.code) els.emgCode.value = d.code;
}

function fillShipping(d) {
  setVal("ship-address", d.address);
  setVal("ship-city", d.city);
  setVal("ship-zip", d.zip);
  setVal("ship-notes", d.notes);
  if (d.region) setRegion(d.region);
}

function showErrors(errors) {
  document.querySelectorAll("[data-error-for]").forEach((p) => {
    const msg = errors[p.dataset.errorFor];
    if (msg === undefined) return; // belongs to the other popup — leave it alone
    p.textContent = msg || "";
    p.hidden = !msg;
    document.getElementById(p.dataset.errorFor)?.classList.toggle("is-invalid", Boolean(msg));
  });
  const first = Object.keys(errors)[0];
  if (first) document.getElementById(first)?.focus();
}

function clearError(id) {
  const p = document.querySelector(`[data-error-for="${id}"]`);
  if (p) p.hidden = true;
  document.getElementById(id)?.classList.remove("is-invalid");
}

function setMessage(kind, text) {
  els.addressMsg.className = `co-address-msg co-address-msg--${kind}`;
  els.addressMsg.textContent = text;
  els.addressMsg.hidden = false;
}

/* ================= Remember me ================= */

function loadRemembered() {
  const data = safeStorage("get");
  if (!data) return;
  els.rememberMe.checked = true;

  if (data.contact) {
    fillContact(data.contact);
    if (Object.keys(checkContact(data.contact)).length === 0) contact = data.contact;
  }

  if (data.emergency) {
    fillEmergency(data.emergency);
    if (Object.keys(checkEmergency(data.emergency, contact?.phone)).length === 0) {
      emergency = data.emergency;
    }
  }

  if (data.shipping) {
    fillShipping(data.shipping);
    if (Object.keys(checkAddress(data.shipping)).length === 0 && needsAddress) {
      shipping = data.shipping;
    }
  }
}

function remember() {
  if (!els.rememberMe.checked) return;
  safeStorage("set", { contact, emergency, shipping });
}

function safeStorage(action, data) {
  try {
    if (action === "get") return JSON.parse(localStorage.getItem(REMEMBER_KEY) || "null");
    if (action === "set") localStorage.setItem(REMEMBER_KEY, JSON.stringify(data));
    if (action === "remove") localStorage.removeItem(REMEMBER_KEY);
  } catch {
    return null; // storage blocked (e.g. private window) — just skip it
  }
  return null;
}

/* ================= Rendering ================= */

function render() {
  renderReview();
  renderSummary();
}

function renderReview() {
  // Contact
  setRow(
    "reviewContact",
    contact ? `${contact.name} · ${contact.email} · ${contact.phone}` : "Add your contact details",
    !contact
  );

  // Emergency contact
  if (emergency) {
    const rel = emergency.relation ? ` (${emergency.relation})` : "";
    setRow("reviewEmergency", `${emergency.name}${rel} · ${emgPhoneText(emergency)}`, false);
  } else {
    setRow("reviewEmergency", "Add an emergency contact", true);
  }

  // Shipping
  if (needsAddress) {
    if (shipping) {
      setRow(
        "reviewShipTo",
        `${addressText(shipping)} · ${REGION_LABELS[shipping.region]}`,
        false
      );
      showAddressOnMap(
        "review-map",
        addressText(shipping),
        shipping.location,
        shipping.location_exact ? 16 : 13
      );
    } else {
      setRow("reviewShipTo", "Add your shipping address", true);
      els.reviewMap.hidden = true;
    }
  }

  // Pay button
  const ready = Boolean(contact) && Boolean(emergency) && (!needsAddress || Boolean(shipping));
  els.payBtn.disabled = !ready;
  els.payHint.hidden = ready;
  els.payBtn.textContent = ready
    ? `Pay ₱${computeTotal().toLocaleString("en-PH")} with Maya`
    : "Pay Now";
  els.payHint.textContent = !contact
    ? "Add your contact details above to continue."
    : !emergency
    ? "Add an emergency contact above to continue."
    : "Add your shipping address above to continue.";
  els.crumbInfo.classList.toggle("is-muted", ready);
  els.crumbPay.classList.toggle("is-muted", !ready);
}

function setRow(key, text, muted) {
  els[key].textContent = text;
  els[key].classList.toggle("is-muted", muted);
}

function renderSummary() {
  const items = getCart();

  els.summaryList.innerHTML = items
    .map((i) => {
      const meta =
        i.type === "booking"
          ? [i.meta?.date, i.meta?.groupSize ? `${i.meta.groupSize} pax` : null, i.meta?.guideName]
              .filter(Boolean)
              .join(" · ")
          : [i.size ? `Size: ${i.size}` : null, i.color].filter(Boolean).join(" · ");
      const qty = i.type === "product" ? i.qty : 1;
      const thumb = i.image
        ? `<img src="${i.image}" alt="" loading="lazy" />`
        : `<span>${i.type === "booking" ? "🥾" : "🎒"}</span>`;

      return `
        <div class="co-item">
          <div class="co-item-thumb">${thumb}</div>
          <div class="co-item-body">
            <span class="co-item-name">${i.name}</span>
            ${meta ? `<span class="co-item-meta">${meta}</span>` : ""}
            <span class="co-item-price">${qty}× ₱${(lineTotal(i) / qty).toLocaleString("en-PH")}</span>
          </div>
          <span class="co-item-total">₱${lineTotal(i).toLocaleString("en-PH")}</span>
        </div>`;
    })
    .join("");

  const count = items.reduce((n, i) => n + (i.type === "product" ? i.qty : 1), 0);
  els.summaryCount.textContent = `(${count} item${count === 1 ? "" : "s"})`;
  els.summarySubtotal.textContent = "₱" + getSubtotal().toLocaleString("en-PH");

  if (needsAddress) {
    els.summaryShipping.textContent = shipping
      ? "₱" + shippingCost().toLocaleString("en-PH")
      : "Add address";
  }

  els.summaryTotal.textContent = "₱" + computeTotal().toLocaleString("en-PH");
}

function shippingCost() {
  if (!needsAddress || !shipping) return 0;
  return SHIPPING_RATES[shipping.region] ?? 0;
}

function computeTotal() {
  return getSubtotal() + shippingCost();
}

/* ================= Maya items ================= */
// Maya checks that item totals add up to the order total,
// so shipping is sent as its own line.
function buildMayaItems(items, shippingFee) {
  const mayaItems = items.map((i) => {
    const quantity = i.type === "product" ? i.qty : 1;
    const total = lineTotal(i);
    return { name: i.name, quantity, amount: total / quantity, totalAmount: total };
  });
  if (shippingFee > 0) {
    mayaItems.push({ name: "Shipping fee", quantity: 1, amount: shippingFee, totalAmount: shippingFee });
  }
  return mayaItems;
}

/* ================= Pay with Maya ================= */

async function handlePay() {
  // Safety net: never pay without confirmed details
  if (!contact || !emergency || (needsAddress && !shipping)) return openNextMissing();

  els.checkoutError.hidden = true;
  els.payBtn.disabled = true;
  els.payBtn.textContent = "Connecting to Maya…";

  const items = getCart();
  const bookingItems = items.filter((i) => i.type === "booking");
  const productItems = items.filter((i) => i.type === "product");
  const shippingFee = shippingCost();
  const total = computeTotal();

  const order = {
    items: productItems.map((i) => ({
      productId: i.productId,
      name: i.name,
      price: i.price,
      qty: i.qty,
      size: i.size ?? null,
      color: i.color ?? null,
    })),
    booking_ids: bookingItems.map((i) => i.bookingId),
    contact: {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
    },
    emergency_contact: {
      name: emergency.name,
      phone: emgPhoneText(emergency),          // e.g. "+63 9171234567"
      phone_e164: "+" + normalizePhone(emergency.code, emergency.number).e164,
      relation: emergency.relation || null,
    },
    shipping: needsAddress
      ? {
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          address: shipping.address,
          city: shipping.city,
          region: shipping.region,
          zip: shipping.zip,
          notes: shipping.notes,
          location: shipping.location ?? null,        // { lat, lng } or null
          location_exact: shipping.location_exact ?? false,
        }
      : null,
    payment: { method: "maya_checkout_sandbox", status: "Pending" },
    subtotal: getSubtotal(),
    shipping_fee: shippingFee,
    total,
    status: "Pending Payment", // becomes "Paid" on payment-result.html
    created_at: new Date().toISOString(),
    // TODO: add `user_id: currentUser.uid` here once Auth is wired up
  };

  try {
    const orderRef = await addDoc(collection(db, "orders"), order);

    const { checkoutId, redirectUrl } = await createMayaCheckout(
      orderRef.id,
      total,
      buildMayaItems(items, shippingFee)
    );

    try {
      await updateDoc(doc(db, "orders", orderRef.id), { "payment.checkout_id": checkoutId });
    } catch (saveErr) {
      console.warn("Could not save Maya checkout id (check Firestore rules):", saveErr);
    }

    window.location.href = redirectUrl;
  } catch (err) {
    console.error("Failed to start Maya payment:", err);
    els.checkoutError.textContent =
      "We couldn't connect to Maya. Please try again. (Details are in the browser console.)";
    els.checkoutError.hidden = false;
    renderReview(); // puts the button back
  }
}

/* ================= Helpers ================= */

function val(id) {
  return document.getElementById(id).value.trim();
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el && value != null) el.value = value;
}

function addressText(d) {
  return [d.address, d.city, d.zip, "Philippines"].filter(Boolean).join(", ");
}

// Emergency number as people read it, e.g. "+63 917 123 4567"
function emgPhoneText(d) {
  return `+${d.code} ${d.number}`.replace(/\s+/g, " ").trim();
}

// "ship-region-group" -> "shipRegionGroup"
function toKey(id) {
  return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
