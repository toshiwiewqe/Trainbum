/* ==========================================================
   Trailbound — Cart Store
   Single source of truth for "what's in the cart", shared by
   products.js, booking.js, cart.js, and checkout.js.

   Cart lives in localStorage (not Firestore) because it's
   purely a per-browser working set, same spirit as the
   "my booking ids" pattern already used in booking.js.

   TODO (after Auth is added): once a user is logged in, sync
   this to a per-user Firestore doc (e.g. carts/{uid}) on write
   and hydrate from it on load, so the cart follows the user
   across devices instead of living in one browser only.

   Cart item shapes:
   Product line:
     {
       cartItemId, type: "product",
       productId, name, price, qty, image, size, color
     }
   Booking line (added once a trail booking is reserved,
   removed/settled once checkout completes):
     {
       cartItemId, type: "booking",
       bookingId, name, price, qty: 1, image,
       meta: { trailName, packageName, date, guideName, groupSize, activity }
     }
   ========================================================== */

const CART_KEY = "trailbound_cart_v1";
const EVENT_NAME = "trailbound:cart-updated";

function readCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { items } }));
}

function makeId() {
  return `ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function lineTotal(item) {
  return item.price * (item.type === "booking" ? 1 : item.qty);
}

/* ---------- Reads ---------- */

export function getCart() {
  return readCart();
}

export function getCartCount() {
  return readCart().reduce((sum, i) => sum + (i.type === "booking" ? 1 : i.qty), 0);
}

export function getSubtotal() {
  return readCart().reduce((sum, i) => sum + lineTotal(i), 0);
}

export function hasProducts() {
  return readCart().some((i) => i.type === "product");
}

export function hasBookings() {
  return readCart().some((i) => i.type === "booking");
}

/* ---------- Writes ---------- */

export function addProductToCart({ productId, name, price, qty, image, size, color }) {
  const items = readCart();
  const existing = items.find(
    (i) => i.type === "product" && i.productId === productId && i.size === size && i.color === color
  );
  if (existing) {
    existing.qty = Math.min(10, existing.qty + qty);
  } else {
    items.push({
      cartItemId: makeId(),
      type: "product",
      productId,
      name,
      price,
      qty,
      image,
      size: size || null,
      color: color || null,
    });
  }
  writeCart(items);
}

export function addBookingToCart({ bookingId, trailName, packageName, date, guideName, groupSize, activity, price, image }) {
  const items = readCart();
  // A given booking should only ever have one cart line.
  const alreadyIn = items.some((i) => i.type === "booking" && i.bookingId === bookingId);
  if (alreadyIn) return;
  items.push({
    cartItemId: makeId(),
    type: "booking",
    bookingId,
    name: `${trailName} — ${packageName}`,
    price,
    qty: 1,
    image: image || null,
    meta: { trailName, packageName, date, guideName, groupSize, activity },
  });
  writeCart(items);
}

export function updateQty(cartItemId, qty) {
  const items = readCart();
  const item = items.find((i) => i.cartItemId === cartItemId);
  if (!item || item.type === "booking") return;
  item.qty = Math.max(1, Math.min(10, Math.round(qty) || 1));
  writeCart(items);
}

export function removeItem(cartItemId) {
  writeCart(readCart().filter((i) => i.cartItemId !== cartItemId));
}

export function removeBookingByBookingId(bookingId) {
  writeCart(readCart().filter((i) => !(i.type === "booking" && i.bookingId === bookingId)));
}

export function clearCart() {
  writeCart([]);
}

/* ---------- UI helpers ---------- */

export function onCartUpdated(callback) {
  window.addEventListener(EVENT_NAME, callback);
  // Keeps multiple open tabs (e.g. products.html + booking.html) in sync.
  window.addEventListener("storage", (e) => {
    if (e.key === CART_KEY) callback();
  });
}

export function updateCartBadge(el) {
  if (!el) return;
  const count = getCartCount();
  el.textContent = String(count);
  el.hidden = count === 0;
}

export { lineTotal };
