/* ==========================================================
   Trailbound — sale pricing
   ----------------------------------------------------------
   THE one place a sale price is worked out, and deliberately a
   module of its own with NO imports at all.

   It cannot live in trailbound-data.js, which every admin page
   uses: that file imports firebase-init.js, while products.js
   and cart.js build their Firestore from firebase-config.js.
   Pulling one into the other is the two-Firebase-apps problem
   that broke authenticated writes earlier in this project (see
   the comment at the top of products.js). A dependency-free
   file can be imported by any page on either side without
   dragging a second Firebase app in with it.

   trailbound-data.js re-exports salePricing from here, so the
   admin pages keep importing it from where they always have.

   The stored shape, on the product document:

     sale: { on: true, type: "percent" | "amount", value: 25, cap: 50 }

   ========================================================== */

/**
 * ADDED — what a product actually costs right now.
 *
 * THE ONE PLACE A SALE PRICE IS WORKED OUT. The admin panel, the shop,
 * the cart and checkout must all arrive at the same peso figure, and
 * the surest way to guarantee that is for none of them to do the
 * arithmetic themselves. checkout.js builds a Maya payload that is
 * rejected unless the line totals add up to the order total, so two
 * surfaces disagreeing by one centavo is a failed payment, not a
 * cosmetic bug.
 *
 * Takes a RAW Firestore document as readily as a normalised product,
 * because products.js, cart.js and checkout.js all read raw docs.
 *
 * The stored shape:
 *   sale: { on: true, type: "percent" | "amount", value: 25, cap: 50 }
 *
 *   type "percent"  value is a percentage; `cap` is the most it may
 *                   take off in pesos, and is ignored when absent.
 *   type "amount"   value is pesos off; `cap` means nothing and is
 *                   not stored.
 */
export function salePricing(source = {}) {
  const price = Math.max(0, Number(source?.price ?? source?.amount ?? 0) || 0);
  const raw =
    source?.sale && typeof source.sale === "object" && !Array.isArray(source.sale)
      ? source.sale
      : {};

  const type = String(raw.type || "percent").toLowerCase() === "amount" ? "amount" : "percent";
  const parsedValue = Number(raw.value);
  const value = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;

  const parsedCap = Number(raw.cap);
  const cap =
    raw.cap === null || raw.cap === undefined || raw.cap === "" || !Number.isFinite(parsedCap) || parsedCap <= 0
      ? null
      : parsedCap;

  const on = raw.on === true;

  let discount = 0;
  let capApplied = false;
  if (on && value > 0 && price > 0) {
    if (type === "percent") {
      discount = (price * value) / 100;
      if (cap !== null && cap < discount) {
        discount = cap;
        capApplied = true;
      }
    } else {
      discount = value;
    }
    // A discount can never exceed the price. Letting it through would
    // produce a negative line total, which every total downstream
    // would then quietly subtract from the rest of the order.
    discount = Math.min(discount, price);
  }

  // Rounded to whole pesos ONCE, here. Every surface takes the result
  // rather than rounding its own copy, so no two of them can land a
  // centavo apart.
  discount = Math.round(discount);

  const active = discount > 0;
  const salePrice = active ? Math.max(0, price - discount) : price;

  /* The effective percentage, not the one that was typed. A 25% sale
     capped at ₱50 on a ₱1,399 item is 4% off, and a "25% OFF" badge on
     it would be a false claim rather than a rounding quirk. */
  const percentOff = active && price > 0 ? Math.round((discount / price) * 100) : 0;

  return {
    on,
    type,
    value,
    cap,
    price,
    discount: active ? discount : 0,
    salePrice,
    percentOff,
    capApplied,
    active,
    badge: !active ? "" : type === "amount" ? `₱${discount.toLocaleString()} OFF` : `${percentOff}% OFF`
  };
}

/** The sale map as it is stored, built from whatever the form gave. */
export function buildSalePayload(input) {
  const src = input && typeof input === "object" ? input : {};
  const type = String(src.type || "percent").toLowerCase() === "amount" ? "amount" : "percent";
  const parsedValue = Number(src.value);
  const value = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
  const parsedCap = Number(src.cap);
  const capGiven = src.cap !== undefined && src.cap !== null && String(src.cap).trim() !== "";

  return {
    // A switch turned on with no number behind it is not a sale, and
    // storing it as one would put a 0% badge on the shop.
    on: src.on === true && value > 0,
    type,
    value,
    // A cap only means anything on a percentage.
    cap: type === "percent" && capGiven && Number.isFinite(parsedCap) && parsedCap > 0 ? parsedCap : null
  };
}

/** The sale in one line, for the audit log and the admin table. */
export function summariseSale(source) {
  const s = salePricing(source);
  if (!s.on || s.value <= 0) return "none";
  const base = s.type === "amount" ? `₱${s.value.toLocaleString()} off` : `${s.value}% off`;
  return s.type === "percent" && s.cap !== null ? `${base}, up to ₱${s.cap.toLocaleString()}` : base;
}
