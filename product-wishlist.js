/* ==========================================================
   Saved Products (the heart on a product card)

   REWRITTEN to use the wishlist you already have.

   The first version wrote to a `wishlist` field on the user's
   document, which was a guess, and a wrong one: your wishlist is a
   live subcollection driven by three helpers in trailbound-data.js
   — addToWishlist / removeFromWishlist / watchWishlist — the same
   three account.js uses. This file now calls those, so the heart
   and the Wishlist section are reading and writing the exact same
   records. Nothing to configure.

   No localStorage here, on purpose. The Firestore stream IS the
   state: whatever watchWishlist reports is what the heart shows,
   so the shop can never claim something is saved that the account
   page doesn't have. Saving needs a login, same as account.js.
   ========================================================== */

// auth comes from trailbound-data.js, the way account.js takes it,
// so this is certain to be the same Firebase app the wishlist
// helpers write with.
import {
  auth,
  addToWishlist,
  removeFromWishlist,
  watchWishlist,
} from "./trailbound-data.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const CHANGE_EVENT = "trailbound:saved-products-change";

let currentUser = null;
let items = []; // the live wishlist, straight from Firestore
let stopWatching = null;

function announce() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { count: items.length } }));
}

/* ---------- matching a card to a wishlist entry ----------
   Three ways, because addToWishlist() may or may not keep the id
   we hand it as the document id, and may or may not carry extra
   fields through:
     1. productId  — the field written below
     2. id         — if the product id became the document id
     3. name       — last resort, for anything saved before this
   ---------------------------------------------------------- */
function findEntry(product) {
  const id = String((product && product.id) ?? product ?? "").trim();
  const name = String((product && product.name) || "").trim().toLowerCase();
  if (!id && !name) return null;

  return (
    items.find((i) => {
      if (id && String(i.productId ?? "").trim() === id) return true;
      if (id && String(i.id ?? "").trim() === id) return true;
      if (name && String(i.name ?? "").trim().toLowerCase() === name) return true;
      return false;
    }) || null
  );
}

/* ---------- what products.js uses ---------- */

export function isProductSaved(product) {
  return Boolean(findEntry(product));
}

export function isSignedIn() {
  return Boolean(currentUser);
}

export function onSavedProductsChange(callback) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

/* Flips one product. Takes the whole product, not just the id,
   because the wishlist stores the name, price and photo that
   account.js renders on the card.

   Returns { saved, needsLogin } — products.js decides what to say. */
export async function toggleProductSaved(product) {
  if (!product) return { saved: false, needsLogin: false };

  if (!currentUser) {
    // The wishlist lives under the user's document, so there's
    // nowhere to put this yet. Say so rather than pretending.
    return { saved: false, needsLogin: true };
  }

  const existing = findEntry(product);

  if (existing) {
    await removeFromWishlist(currentUser.uid, existing.id);
    // Drop it locally too, so the heart empties immediately instead
    // of waiting for the snapshot to come back.
    items = items.filter((i) => i !== existing);
    announce();
    return { saved: false, needsLogin: false };
  }

  const entry = {
    id: product.id,
    productId: product.id, // what findEntry() matches on
    type: "product",
    name: product.name || "",
    price: Number(product.price) || 0,
    image: (Array.isArray(product.images) && product.images[0]) || product.image || "",
  };

  await addToWishlist(currentUser.uid, entry);

  // Shown filled right away. Skipped when the live snapshot has
  // already landed, so there's never a duplicate in memory.
  if (!findEntry(product)) items = [...items, entry];
  announce();
  return { saved: true, needsLogin: false };
}

/* ---------- the live stream ---------- */

onAuthStateChanged(auth, (user) => {
  currentUser = user || null;

  // Never leave an old user's listener running
  if (typeof stopWatching === "function") stopWatching();
  stopWatching = null;
  items = [];
  announce();

  if (!user) return;

  try {
    const unsubscribe = watchWishlist(user.uid, (list) => {
      items = Array.isArray(list) ? list : [];
      announce();
    });
    if (typeof unsubscribe === "function") stopWatching = unsubscribe;
  } catch (err) {
    console.error("[saved Products] couldn't watch the wishlist:", err);
  }
});
