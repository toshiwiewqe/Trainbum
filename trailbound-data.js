/* ==========================================================
   Trailbound — shared Firestore data layer
   ----------------------------------------------------------
   ONE module for BOTH sides of the app:

     admin pages  ──┐
                    ├──►  trailbound-data.js  ──►  Firestore
     user pages   ──┘

   Everything in here is realtime (onSnapshot). When an admin
   saves a product, every browser that is watching products —
   including a customer sitting on the trails page — re-renders
   within a second. Nobody has to refresh anything.

   It also normalises the messy field names that crept into the
   bookings collection (full_name vs customerName, total_price vs
   amount vs price...) so that every page computes the SAME
   numbers. Before this, the dashboard read `b.price` while the
   bookings page read `b.total_price` — which is why revenue kept
   showing 0.

   This file never contains your Firebase config. It imports
   `auth` and `db` from your existing firebase-init.js, which
   stays exactly as it is.
   ========================================================== */

import { auth, db } from "./firebase-init.js";
import { salePricing, buildSalePayload, summariseSale } from "./sale-pricing.js";
import { IMAGE_UPLOAD } from "./image-upload-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export { auth, db };

/* ==========================================================
   1. COLLECTIONS — the single source of truth for names
   ========================================================== */

export const COL = {
  // Booking catalog — what booking.js builds its three dropdowns from.
  trails: "trails",
  guides: "guides",
  packages: "packages",
  // Shop + transactions
  products: "products",
  bookings: "bookings",
  orders: "orders",
  contact: "contact",
  // Accounts + system
  users: "users",
  admins: "admins",
  activity: "activity",
  settings: "settings",
  // ADDED. products.js has been writing customer reviews here since the
  // product drawer shipped, and reading the whole collection back to
  // compute the storefront's "popularity" sort. No admin page ever read
  // it, so the ratings driving that sort were invisible to you and an
  // abusive review had no route to removal.
  reviews: "product_reviews"
};

export const SETTINGS_DOC_ID = "site";

const trailsRef = () => collection(db, COL.trails);
const guidesRef = () => collection(db, COL.guides);
const packagesRef = () => collection(db, COL.packages);
const ordersRef = () => collection(db, COL.orders);
const contactRef = () => collection(db, COL.contact);
const productsRef = () => collection(db, COL.products);
const reviewsRef = () => collection(db, COL.reviews);
const bookingsRef = () => collection(db, COL.bookings);
const usersRef = () => collection(db, COL.users);
const settingsRef = () => doc(db, COL.settings, SETTINGS_DOC_ID);
const wishlistRef = (uid) => collection(db, COL.users, uid, "wishlist");
const notificationsRef = (uid) => collection(db, COL.users, uid, "notifications");

/* ==========================================================
   2. HELPERS
   ========================================================== */

/** Firestore Timestamp | ISO string | Date  ->  Date | null */
export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

export function peso(value) {
  return "₱" + Number(value || 0).toLocaleString("en-PH", {
    maximumFractionDigits: 2
  });
}

export function timeAgo(value) {
  const date = toDate(value);
  if (!date) return "";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ==========================================================
   3. NORMALISERS
   ----------------------------------------------------------
   Old documents in Firestore use several different names for
   the same thing. Rather than rewrite your database, every read
   passes through here, so the rest of the app only ever deals
   with ONE shape.
   ========================================================== */

const PRODUCT_KNOWN_KEYS = new Set([
  "name", "title", "category", "subcategory", "description", "price", "amount",
  "status", "image", "imageUrl", "photo", "images", "attributes", "specs",
  "inStock", "in_stock", "quantity", "stock", "stockQuantity",
  "popularity", "location", "difficulty", "bookingCount",
  "dateAdded", "createdAt", "updatedAt", "archived", "archivedBy", "archivedAt",
  "sale"
]);

/* The sale price, and the shape it is stored in, live in
   sale-pricing.js — a module with no imports, so the shop pages
   (which build Firestore from firebase-config.js) can use exactly the
   same function as the admin pages (which use firebase-init.js via
   this file) without two Firebase apps ending up in one page.

   Re-exported so every admin page keeps importing salePricing from
   trailbound-data.js, as it always has. */
export { salePricing, summariseSale };

/**
 * REBUILT. This returned thirteen scalar fields and none of the three
 * that the shop actually renders a product from.
 *
 * admin-products.js reads product.images, product.attributes,
 * product.specs, product.inStock, product.subcategory,
 * product.popularity and product.hasStatusField. None of them existed
 * here, so `Object.keys(product.specs)` ran against undefined and the
 * Products page threw on its first render. The write path had the matching
 * hole: saveProduct() accepted those keys from the form and wrote none
 * of them.
 *
 * The field names below are not guesses. products.js — the storefront —
 * reads `p.images[0]`, `p.attributes.size`, `p.attributes.color`,
 * `p.specs`, `p.subcategory` and `p.inStock` straight off the document,
 * so those are the names the data already uses.
 */
export function normalizeProduct(id, raw = {}) {
  const images = Array.isArray(raw.images)
    ? raw.images.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  const legacyImage = String(raw.image || raw.imageUrl || raw.photo || "").trim();

  /* attributes is a map of picker name -> list of choices
     (attributes.size, attributes.color on the product page). A value
     saved as a bare string instead of a list is read as a one-item
     list rather than dropped. */
  const attributes = {};
  if (raw.attributes && typeof raw.attributes === "object" && !Array.isArray(raw.attributes)) {
    for (const [key, value] of Object.entries(raw.attributes)) {
      attributes[key] = Array.isArray(value)
        ? value.map((v) => String(v ?? "").trim()).filter(Boolean)
        : String(value ?? "").trim()
        ? [String(value).trim()]
        : [];
    }
  }

  const specs = {};
  if (raw.specs && typeof raw.specs === "object" && !Array.isArray(raw.specs)) {
    for (const [key, value] of Object.entries(raw.specs)) specs[key] = String(value ?? "");
  }

  /* Does this document carry a `status` field AT ALL?
     Yours do not — availability on your products is `inStock` — and
     that distinction matters, because the stock toggle used to write
     `status` unconditionally. Pressing it once would have bolted a
     second, competing availability flag onto a record that had none,
     and the shop reads both. hasStatusField is what lets the writers
     leave such a document alone. */
  const hasStatusField = typeof raw.status === "string" && raw.status.trim() !== "";
  const storedInStock =
    typeof raw.inStock === "boolean" ? raw.inStock
    : typeof raw.in_stock === "boolean" ? raw.in_stock
    : undefined;

  const popularity =
    raw.popularity === undefined || raw.popularity === null || raw.popularity === ""
      ? null
      : Number(raw.popularity);

  /* STOCK COUNT — and the single most important rule about it:
     an ABSENT quantity is not zero.

     None of your 63 products carries this field yet. If a missing
     value were read as 0, the first time anything saved them they
     would all be "out of stock" and vanish from the shop. So quantity
     is null until somebody actually sets one, `hasQuantity` says which
     is which, and availability keeps coming from inStock on records
     that are not tracked yet. Exactly the reasoning behind
     hasStatusField. */
  const saleInfo = salePricing(raw);

  const rawQuantity =
    raw.quantity ?? raw.stock ?? raw.stockQuantity ?? null;
  const parsedQuantity = Number(rawQuantity);
  const hasQuantity =
    rawQuantity !== null &&
    rawQuantity !== undefined &&
    rawQuantity !== "" &&
    Number.isFinite(parsedQuantity);

  return {
    id,
    name: raw.name || raw.title || "Untitled",
    category: raw.category || "Uncategorized",
    subcategory: raw.subcategory || "",
    description: raw.description || "",
    price: Number(raw.price ?? raw.amount ?? 0),
    popularity: Number.isFinite(popularity) ? popularity : null,

    status: hasStatusField ? String(raw.status).toLowerCase() : "",
    hasStatusField,

    /* The thumbnail the table shows. images[0] first, because that is
       what the shop uses; the old single `image` field is the fallback
       for records written before the gallery existed. */
    image: images[0] || legacyImage,
    images,
    hasImagesField: Array.isArray(raw.images),
    attributes,
    specs,

    /* Default true when neither field is present — the storefront does
       exactly this (`if (p.inStock === undefined) p.inStock = true`),
       and disagreeing with it would mean the panel showed a product as
       out of stock while the shop sold it. */
    inStock:
      storedInStock !== undefined
        ? storedInStock
        : hasStatusField
        ? String(raw.status).toLowerCase() === "active"
        : true,
    hasInStockField: storedInStock !== undefined,

    // Whole units, never negative — a stored -3 is a data error, not a
    // debt, and showing it as -3 would put it below the low-stock line
    // and read as if it were nearly sold out.
    quantity: hasQuantity ? Math.max(0, Math.trunc(parsedQuantity)) : null,
    hasQuantity,

    /* SALE. `sale` is what is stored and what the form edits; the four
       fields under it are what every surface renders, worked out once
       by salePricing() so nothing downstream does its own arithmetic.

       onSale is deliberately not the same as sale.on: the switch can
       be on with a value of 0, or with a discount that rounds away to
       nothing, and neither is a sale the customer can see. */
    sale: { on: saleInfo.on, type: saleInfo.type, value: saleInfo.value, cap: saleInfo.cap },
    hasSaleField: Boolean(raw.sale && typeof raw.sale === "object" && !Array.isArray(raw.sale)),
    onSale: saleInfo.active,
    salePrice: saleInfo.salePrice,
    saleDiscount: saleInfo.discount,
    salePercentOff: saleInfo.percentOff,
    saleBadge: saleInfo.badge,

    location: raw.location || "",
    difficulty: raw.difficulty || "",
    bookingCount: Number(raw.bookingCount || 0),
    dateAdded: raw.dateAdded ?? raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,

    /* watchProducts() filters on `p.archived`, and nothing here ever
       returned it — so the filter did nothing and the Archived view
       could never work. Same bug the catalog had. */
    archived: raw.archived === true,
    archivedBy: raw.archivedBy || "",
    archivedAt: raw.archivedAt ?? null,

    extras: Object.keys(raw)
      .filter((k) => !PRODUCT_KNOWN_KEYS.has(k))
      .map((k) => [k, raw[k]]),
    _raw: raw
  };
}

/* ---------- booking catalog ----------
   These three drive the booking form. Note that booking.js reads
   them with `snap.docs.map(d => d.data())` — it throws the document
   id away and keys everything off the BUSINESS id inside the
   document (trail_id, guide_id, package_id). So those fields are
   load-bearing: a trail saved without a trail_id will render in the
   dropdown with an empty value and can never be selected. The admin
   catalog page generates one from the name when it's missing. */

export function normalizeTrail(id, raw = {}) {
  // booking.js reads `trail.guide_id` as an array; the diagnostics
  // block in the same file calls it `guide_ids`. Accept either.
  const guideIds = Array.isArray(raw.guide_id)
    ? raw.guide_id
    : Array.isArray(raw.guide_ids)
    ? raw.guide_ids
    : [];

  return {
    docId: id,
    id: raw.trail_id || id,
    trailId: raw.trail_id || "",
    name: raw.name || "Untitled trail",
    location: raw.location || "",
    difficulty: raw.difficulty || "",
    duration: raw.duration || "",
    description: raw.description || "",
    image: raw.image || "",
    guideIds,
    // trail.js prints this on every card as "<price>/person". It is
    // NOT the booking price — booking.js charges package.price_per_pax
    // — so treat it as the "from" figure shown on the trails page.
    basePrice: Number(raw.base_price ?? raw.price ?? 0),
    // Optional. Weather-api.js takes a coordsOverride and is far more
    // accurate for a peak than for its nearest town, but booking.js
    // currently passes only the location string. Storing coordinates
    // here is what would let it pass them.
    lat: raw.lat ?? raw.latitude ?? null,
    lon: raw.lon ?? raw.longitude ?? null,
    status: raw.status || "Open",
    // Mirrors isTrailOpen() in booking.js and trail.js: only an exact
    // "closed" shuts a trail down, so a status like "Open (monolith
    // closed)" stays bookable.
    isOpen: raw.isOpen !== undefined
      ? Boolean(raw.isOpen)
      : !/^closed$/i.test(String(raw.status ?? "open").trim()),
    // ADDED. admin-catalog.js filters every list on `item.archived`,
    // but no normaliser ever returned it — so it was always undefined.
    // Consequences, all of them silent: the "Archived (n)" counter read
    // 0 forever, the Archived view was permanently empty, and archiving
    // a record left it sitting in the active list as though nothing had
    // happened. The flag was being written to Firestore correctly the
    // whole time; it just never made it back out.
    archived: raw.archived === true,
    archivedBy: raw.archivedBy || "",
    archivedAt: raw.archivedAt ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    _raw: raw
  };
}

export function normalizeGuide(id, raw = {}) {
  return {
    docId: id,
    id: raw.guide_id || id,
    guideId: raw.guide_id || "",
    fullName: raw.full_name || raw.name || "Unnamed guide",
    specialty: raw.specialty || "",
    rating: Number(raw.rating || 0),
    status: raw.status || "Active",
    isActive: String(raw.status || "Active").toLowerCase() === "active",

    // ADDED — three fields that are in every guide document but were
    // dropped on the way in, so the admin could neither see nor edit
    // them. `Photo` really is stored with a capital P (see G001); the
    // lowercase spelling is accepted too so a document written either
    // way still shows its picture.
    photo: raw.Photo || raw.photo || "",
    contact: raw.contact || "",
    yearsExperience: Number(raw.years_experience ?? raw.yearsExperience ?? 0),

    archived: raw.archived === true,
    archivedBy: raw.archivedBy || "",
    archivedAt: raw.archivedAt ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    _raw: raw
  };
}

export function normalizePackage(id, raw = {}) {
  return {
    docId: id,
    id: raw.package_id || id,
    packageId: raw.package_id || "",
    name: raw.name || "Untitled package",
    pricePerPax: Number(raw.price_per_pax ?? raw.price ?? 0),
    includes: Array.isArray(raw.includes) ? raw.includes : [],
    requiresActivityChoice: Boolean(raw.requires_activity_choice),
    // ADDED — present on every package document, never read.
    requiresAccommodation: Boolean(raw.requires_accommodation),

    archived: raw.archived === true,
    archivedBy: raw.archivedBy || "",
    archivedAt: raw.archivedAt ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    _raw: raw
  };
}

/* ---------- Products orders + support ---------- */

export function normalizeOrder(id, raw = {}) {
  return {
    id,
    uid: raw.uid || raw.user_id || null,
    orderId: id.slice(0, 8).toUpperCase(),
    items: Array.isArray(raw.items) ? raw.items : [],
    bookingIds: Array.isArray(raw.booking_ids) ? raw.booking_ids : [],
    customerName: raw.contact?.name || "",
    email: raw.contact?.email || "",
    phone: raw.contact?.phone || "",
    emergencyContact: raw.emergency_contact || null,
    shipping: raw.shipping || null,
    payment: raw.payment || null,
    paymentMethod: raw.payment?.method || "",
    paymentStatus: raw.payment?.status || "Pending",
    // The full id, not a truncation — this is what you paste into the
    // Maya dashboard to reconcile a disputed charge.
    checkoutId: raw.payment?.checkout_id || "",
    // "maya_checkout_sandbox" vs a live method is the difference
    // between a real payment and a test one. Worth surfacing.
    isSandbox: /sandbox|test/i.test(String(raw.payment?.method || "")),
    subtotal: Number(raw.subtotal || 0),
    shippingFee: Number(raw.shipping_fee || 0),
    total: Number(raw.total || 0),
    status: raw.status || "Pending Payment",
    // Set once stock has been taken off the shelf for this order, so it
    // can never be deducted twice.
    stockDeductedAt: raw.stockDeductedAt ?? null,
    stockZeroed: Array.isArray(raw.stockZeroed) ? raw.stockZeroed : [],
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    _raw: raw
  };
}

/* Every key this normalizer deliberately accounts for. Anything in a
   contact document that is NOT in here is handed back as `extras` and
   printed in the modal, so a field the contact form starts writing
   tomorrow cannot sit in the database invisible. */
const MESSAGE_KNOWN_KEYS = new Set([
  "name", "email", "subject", "message", "user_id", "uid", "status",
  "created_at", "createdAt", "phone", "contact_number", "order_id", "orderId",
  "reply", "repliedAt", "replied_at", "repliedBy", "replies",
  "updatedAt", "updated_at", "updatedBy"
]);

export function normalizeMessage(id, raw = {}) {
  /* The reply history, oldest first.

     Old documents hold a SINGLE `reply` string — that is what the
     previous version of replyToMessage wrote. Those are read back here
     as a one-entry thread so nothing already in your database is lost
     or hidden by the change. New replies append to `replies`. */
  const thread = Array.isArray(raw.replies)
    ? raw.replies.map((r) => ({
        text: String(r?.text || ""),
        by: String(r?.by || ""),
        at: r?.at ?? null
      }))
    : raw.reply
    ? [{ text: String(raw.reply), by: String(raw.repliedBy || ""), at: raw.repliedAt ?? raw.replied_at ?? null }]
    : [];

  const extras = Object.keys(raw)
    .filter((k) => !MESSAGE_KNOWN_KEYS.has(k))
    .map((k) => [k, raw[k]]);

  return {
    id,
    ref: id.slice(0, 8).toUpperCase(),
    name: raw.name || "",
    email: raw.email || "",
    // The contact form may collect a number; it was never read back.
    phone: raw.phone || raw.contact_number || "",
    subject: raw.subject || "other",
    message: raw.message || "",
    uid: raw.user_id || raw.uid || null,
    // A message sent from an order page may carry the order it is about.
    orderId: raw.order_id || raw.orderId || "",
    status: raw.status || "New",
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    // Written by replyToMessage / updateMessageStatus since day one and
    // never displayed: you could not tell when a thread was last touched.
    repliedAt: raw.repliedAt ?? raw.replied_at ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
    updatedBy: raw.updatedBy || "",
    thread,
    replyCount: thread.length,
    extras,
    _raw: raw
  };
}

export function normalizeBooking(id, raw = {}) {
  // booking.js writes "Pending" / "Unpaid" and cart.js writes
  // "Cancelled" — capitalised. Comparisons use the lowercase
  // `status`; `statusLabel` keeps the original for display so the
  // admin table doesn't silently rewrite what's in the database.
  const status = String(raw.status || "pending").toLowerCase();
  return {
    id,
    orderId: raw.orderId || id.slice(0, 8).toUpperCase(),
    uid: raw.uid || raw.user_id || raw.userId || null,
    statusLabel: raw.status || "Pending",
    packageId: raw.package_id || null,
    guideId: raw.guide_id || null,
    emergencyName: raw.emergency_name || "",
    emergencyNumber: raw.emergency_number || "",
    customerName: raw.full_name || raw.customerName || raw.name || "Unknown",
    email: raw.email || "",
    phone: raw.contact_number || raw.phone || "",
    trailId: raw.trail_id || raw.trailId || raw.productId || null,
    trailName: raw.trail_name || raw.trailName || raw.productName || "-",
    packageName: raw.package_name || raw.packageInfo || "",
    date: raw.date || raw.bookingDate || "",
    groupSize: Number(raw.group_size ?? raw.groupSize ?? 1),
    amount: Number(raw.total_price ?? raw.amount ?? raw.price ?? 0),
    status,
    paymentStatus: String(raw.payment_status || raw.paymentStatus || "unpaid").toLowerCase(),
    paymentStatusLabel: raw.payment_status || raw.paymentStatus || "Unpaid",

    // SPLIT. These were one field: `specialRequests` fell back to
    // `activity`, so a booking whose activity was "Tree Planting"
    // displayed it on the admin page under the heading "Special
    // request". They are different things — the activity is what the
    // customer CHOSE and the package may require, a special request is
    // free text they typed — and merging them meant the admin could
    // never tell which one they were looking at, nor edit either.
    activity: raw.activity || "",
    specialRequests: raw.special_requests || "",

    guideName: raw.guide_name || "",
    departureTime: raw.departure_time || "",
    customerAvatar: raw.customerAvatar || raw.photoURL || "",
    history: Array.isArray(raw.history) ? raw.history : [],
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    _raw: raw
  };
}

const USER_KNOWN_KEYS = new Set([
  "displayName", "name", "email", "phone", "photoURL", "role", "disabled",
  "shippingAddress", "billingAddress", "createdAt", "lastActiveAt", "updatedAt"
]);

export function normalizeUser(id, raw = {}, adminUids = new Set()) {
  /* Your database holds TWO generations of profile document.

     The newer ones come from ensureUserDoc() and carry photoURL,
     role and lastActiveAt. The older ones — anything created before
     that function existed — have only createdAt, displayName, email
     and phone. The document you screenshotted is one of those.

     Everything below has to read correctly for both, and anything it
     cannot find must be reported as MISSING rather than quietly
     defaulted, because a default that looks like data is what made
     the stat cards lie. */
  const email = raw.email || "";

  /* displayName is an empty string on the older documents, and
     "Unnamed" told you nothing about who the row was. The local part
     of the address is a far better guess and is clearly marked as a
     guess by `hasName`. */
  const storedName = raw.displayName || raw.name || "";

  return {
    id,
    uid: id,
    displayName: storedName || (email ? email.split("@")[0] : "") || "Unnamed",
    hasName: Boolean(storedName),
    email,
    phone: raw.phone || "",
    photoURL: raw.photoURL || "",
    role: adminUids.has(id) ? "admin" : String(raw.role || "customer").toLowerCase(),
    /* An older document has no `role` at all. The page used to render
       that as "Customer", indistinguishable from a role someone chose.
       isAdminDoc says the badge came from the admins collection. */
    hasRole: Boolean(raw.role) || adminUids.has(id),
    isAdminDoc: adminUids.has(id),
    disabled: raw.disabled === true,
    shippingAddress: raw.shippingAddress || null,
    billingAddress: raw.billingAddress || null,
    createdAt: raw.createdAt ?? null,
    lastActiveAt: raw.lastActiveAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    /* The distinction the Active Users card needs: a profile with no
       lastActiveAt has never recorded a sign-in since that stamp was
       introduced. It is NOT the same as a dormant account, and
       counting it as inactive is what made the card read zero. */
    hasActivityStamp: Boolean(raw.lastActiveAt),
    extras: Object.keys(raw)
      .filter((k) => !USER_KNOWN_KEYS.has(k))
      .map((k) => [k, raw[k]]),
    _raw: raw
  };
}

export const DEFAULT_SETTINGS = {
  siteName: "Trailbound Adventure Platform",
  timezone: "UTC+08:00",
  notifications: {
    newBookings: true,
    cancellations: true,
    newRegistrations: true,
    systemUpdates: true
  }
};

export function normalizeSettings(raw = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(raw.notifications || {}) }
  };
}

/* ==========================================================
   4. AUTH GUARDS
   ========================================================== */

export async function isAdmin(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, COL.admins, uid));
    return snap.exists();
  } catch (err) {
    console.error("Admin check failed:", err);
    return false;
  }
}

/**
 * Admin pages: run `onReady(user)` only for a verified admin.
 * Anyone else is signed out and bounced to the login page.
 */
/* CHANGED — the default is login.html, not admin-login.html.
   admin-login.html is gone: there is now one sign-in page for
   everyone, and login.js already routes an admin to the dashboard
   after sign-in (it checks admins/{uid} exactly as the old page did).
   Every admin page calls this with no second argument, so changing
   the default here is what moves all ten of them at once. */
export function requireAdmin(onReady, loginPage = "login.html") {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = loginPage;
      return;
    }
    if (!(await isAdmin(user.uid))) {
      await signOut(auth);
      window.location.href = loginPage;
      return;
    }
    // Mounted here, once, rather than in each of the ten admin pages:
    // this is the single line every admin page already runs after auth
    // succeeds, and the bell must never appear before it does.
    mountNotificationBell();
    onReady(user);
  });
}

/**
 * User pages: `onReady(user)` when signed in, `onGuest()` otherwise.
 * Pass `redirect` to force a login (account page), or leave it null
 * for pages that work fine for signed-out visitors (trails, home).
 */
export function requireUser(onReady, { onGuest = null, redirect = null } = {}) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      touchUser(user).catch(() => {});
      onReady(user);
      return;
    }
    if (redirect) window.location.href = redirect;
    else if (onGuest) onGuest();
  });
}

/* ==========================================================
   5. LIVE READS  (admin AND user side)
   ----------------------------------------------------------
   Every watcher returns its unsubscribe function.
   ========================================================== */

/**
 * @param {(products: object[]) => void} callback
 * @param {{ activeOnly?: boolean }} options
 *        activeOnly: true  -> what CUSTOMERS see (admin-published only)
 *        activeOnly: false -> what ADMINS see (everything)
 */
export function watchProducts(
  callback,
  { activeOnly = false, includeArchived = false, onError = null } = {}
) {
  // The filter is applied server-side on purpose. firestore.rules
  // only lets a signed-out visitor read ACTIVE products, and Firestore
  // rejects any query that could return a document the rules forbid —
  // so filtering client-side would fail the whole read for customers.
  const ref = activeOnly
    ? query(productsRef(), where("status", "==", "active"))
    : productsRef();

  return onSnapshot(
    ref,
    (snap) => {
      let items = snap.docs.map((d) => normalizeProduct(d.id, d.data()));
      // Archived Products stays in Firestore but leaves every list.
      if (!includeArchived) items = items.filter((p) => !p.archived);
      items.sort((a, b) => a.name.localeCompare(b.name));
      callback(items);
    },
    (err) => {
      console.error("Products stream error:", err);
      onError ? onError(err) : callback([]);
    }
  );
}

/**
 * All bookings (admin), or just one customer's bookings (user side).
 * @param {{ uid?: string, email?: string }} options
 */
export function watchBookings(callback, { uid = null, email = null, onError = null } = {}) {
  const byNewest = (a, b) =>
    (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0);

  // Admin: no filter, the whole collection.
  if (!uid && !email) {
    return onSnapshot(
      bookingsRef(),
      (snap) => callback(snap.docs.map((d) => normalizeBooking(d.id, d.data())).sort(byNewest)),
      (err) => {
        console.error("Bookings stream error:", err);
        onError ? onError(err) : callback([]);
      }
    );
  }

  // Customer: every filter runs server-side, because firestore.rules
  // only lets someone read their OWN bookings and Firestore refuses a
  // query that could return documents the rules would block.
  //
  // Two queries rather than one: bookings written before checkout
  // started stamping `uid` can still be matched on email, so a
  // customer's older orders don't vanish from their account.
  const queries = [];
  if (uid) queries.push(query(bookingsRef(), where("uid", "==", uid)));
  if (email) queries.push(query(bookingsRef(), where("email", "==", email)));

  const results = queries.map(() => []);
  const emit = () => {
    const merged = new Map();
    results.flat().forEach((booking) => merged.set(booking.id, booking));
    callback([...merged.values()].sort(byNewest));
  };

  const stops = queries.map((ref, index) =>
    onSnapshot(
      ref,
      (snap) => {
        results[index] = snap.docs.map((d) => normalizeBooking(d.id, d.data()));
        emit();
      },
      (err) => {
        console.error("Bookings stream error:", err);
        results[index] = [];
        emit();
        if (onError) onError(err);
      }
    )
  );

  return () => stops.forEach((stop) => stop());
}

/* ---------- booking catalog streams ----------
   Admin edits here change what customers can actually book. The
   booking page reads the same three collections. */

function watchCollection(ref, normalize, callback, { sort = null, onError = null } = {}) {
  return onSnapshot(
    ref,
    (snap) => {
      const items = snap.docs.map((d) => normalize(d.id, d.data()));
      if (sort) items.sort(sort);
      callback(items);
    },
    (err) => {
      console.error("Stream error:", err);
      onError ? onError(err) : callback([]);
    }
  );
}

const byName = (a, b) => (a.name || "").localeCompare(b.name || "");

/* `includeArchived` was being PASSED by admin-catalog.js but none of
   these three accepted it, so the option did nothing. It works now:
   the customer-facing pages (booking.js, trail.js) get the live
   catalogue, and only the admin asks for the archived records it needs
   in order to offer Restore. */

export function watchTrails(
  callback,
  { openOnly = false, includeArchived = false, onError = null } = {}
) {
  return watchCollection(
    trailsRef(),
    normalizeTrail,
    (items) => {
      let list = includeArchived ? items : items.filter((t) => !t.archived);
      if (openOnly) list = list.filter((t) => t.isOpen);
      callback(list);
    },
    { sort: byName, onError }
  );
}

export function watchGuides(
  callback,
  { activeOnly = false, includeArchived = false, onError = null } = {}
) {
  return watchCollection(
    guidesRef(),
    normalizeGuide,
    (items) => {
      let list = includeArchived ? items : items.filter((g) => !g.archived);
      if (activeOnly) list = list.filter((g) => g.isActive);
      callback(list);
    },
    { sort: (a, b) => a.fullName.localeCompare(b.fullName), onError }
  );
}

export function watchPackages(callback, { includeArchived = false, onError = null } = {}) {
  return watchCollection(
    packagesRef(),
    normalizePackage,
    (items) => callback(includeArchived ? items : items.filter((p) => !p.archived)),
    { sort: (a, b) => a.pricePerPax - b.pricePerPax, onError }
  );
}

/* ---------- Products orders + support inbox (admin) ---------- */

const byNewest = (a, b) =>
  (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0);

export function watchOrders(callback, { uid = null, onError = null } = {}) {
  const ref = uid ? query(ordersRef(), where("uid", "==", uid)) : ordersRef();
  return watchCollection(ref, normalizeOrder, callback, { sort: byNewest, onError });
}

/**
 * ADDED — customer product reviews, live.
 *
 * products.js writes these with exactly five fields:
 *   { productId, name, rating, comment, created_at }
 * created_at is an ISO STRING, not a Firestore timestamp, which is
 * why sorting leans on toDate() rather than orderBy().
 */
export function normalizeReview(id, raw = {}) {
  /* `typeof === "number"`, NOT Number(raw.rating).
     loadProductPopularity() in products.js skips a review with
     `typeof r.rating !== "number"`, so a rating stored as the STRING
     "5" counts for nothing on the shop. Coercing it here would make
     this page report an average the storefront does not use — I tried
     that first and the two disagreed by a whole star on a product with
     one such review. Matching the storefront's test exactly is the
     only way the number here and the shop's ordering stay in step. */
  const usable = typeof raw.rating === "number" && Number.isFinite(raw.rating);
  return {
    id,
    productId: raw.productId || raw.product_id || "",
    name: raw.name || "Anonymous",
    rating: usable ? raw.rating : null,
    // Kept so the page can show what is actually stored on a review the
    // shop is ignoring — "unusable" is more useful with the value next to it.
    rawRating: raw.rating,
    comment: raw.comment || "",
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    extras: Object.keys(raw)
      .filter((k) => !["productId", "product_id", "name", "rating", "comment",
                       "created_at", "createdAt"].includes(k))
      .map((k) => [k, raw[k]]),
    _raw: raw
  };
}

export function watchReviews(callback, { onError = null } = {}) {
  return watchCollection(reviewsRef(), normalizeReview, callback, {
    sort: byNewest,
    onError
  });
}

/**
 * Removing a review. Permanent, and logged.
 *
 * There is no `hidden` flag here on purpose: products.js counts every
 * document in this collection toward a product's average rating and
 * review count, so a review merely marked hidden would vanish from
 * this page while still moving the storefront's popularity sort. A
 * control that looks like moderation but changes nothing a customer
 * sees is the same mistake as the permission toggles on the users
 * page. Deleting is honoured everywhere immediately.
 */
export async function deleteReview(review, adminUser = null) {
  await deleteDoc(doc(db, COL.reviews, review.id));
  await logAudit({
    action: "delete",
    entity: "review",
    entityId: review.id,
    entityLabel: `${review.rating ?? "?"}★ by ${review.name}`,
    summary: `Deleted a ${review.rating ?? "?"}-star review by ${review.name}`,
    changes: [{ field: "Comment", from: String(review.comment || "").slice(0, 140), to: "(deleted)" }],
    status: "cancelled"
  });
}

export function watchSupportMessages(callback, { onError = null } = {}) {
  return watchCollection(contactRef(), normalizeMessage, callback, {
    sort: byNewest,
    onError
  });
}

/** A single booking, live — used by the admin booking detail page. */
export function watchBooking(id, callback, { onError = null } = {}) {
  return onSnapshot(
    doc(db, COL.bookings, id),
    (snap) => callback(snap.exists() ? normalizeBooking(snap.id, snap.data()) : null),
    (err) => {
      console.error("Booking stream error:", err);
      onError ? onError(err) : callback(null);
    }
  );
}

/** Users, with the `admins` collection folded in so roles are correct. */
export function watchUsers(callback, { onError = null } = {}) {
  let adminUids = new Set();
  let latest = null;

  const emit = () => {
    if (!latest) return;
    callback(latest.docs.map((d) => normalizeUser(d.id, d.data(), adminUids)));
  };

  const stopAdmins = onSnapshot(
    collection(db, COL.admins),
    (snap) => {
      adminUids = new Set(snap.docs.map((d) => d.id));
      emit();
    },
    (err) => {
      // Not fatal — it only costs the Super Admin badge — but the page
      // should still say so rather than quietly mislabel everyone.
      console.error("Admins stream error:", err);
      if (onError) onError(err, "admins");
    }
  );

  const stopUsers = onSnapshot(
    usersRef(),
    (snap) => {
      latest = snap;
      emit();
    },
    (err) => {
      console.error("Users stream error:", err);
      if (onError) onError(err, "users");
      else callback([]);
    }
  );

  return () => {
    stopAdmins();
    stopUsers();
  };
}

/** Site settings — admin edits these, the public site reads them. */
export function watchSettings(callback) {
  return onSnapshot(
    settingsRef(),
    (snap) => callback(normalizeSettings(snap.exists() ? snap.data() : {})),
    (err) => {
      console.error("Settings stream error:", err);
      callback(normalizeSettings({}));
    }
  );
}

export function watchNotifications(uid, callback) {
  return onSnapshot(
    query(notificationsRef(uid), orderBy("createdAt", "desc")),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error("Notifications stream error:", err);
      callback([]);
    }
  );
}

export function watchWishlist(uid, callback) {
  return onSnapshot(
    wishlistRef(uid),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error("Wishlist stream error:", err);
      callback([]);
    }
  );
}

export function watchActivity(callback, { max = 10, onError = null } = {}) {
  return onSnapshot(
    query(collection(db, COL.activity), orderBy("createdAt", "desc"), limit(max)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error("Activity stream error:", err);
      // The dashboard's little feed can quietly show nothing, but the
      // Activity Log page must say "denied" rather than "no activity
      // yet" — they mean opposite things.
      onError ? onError(err) : callback([]);
    }
  );
}

export function watchUserProfile(uid, callback) {
  return onSnapshot(
    doc(db, COL.users, uid),
    (snap) => callback(snap.exists() ? normalizeUser(snap.id, snap.data()) : null),
    (err) => {
      console.error("Profile stream error:", err);
      callback(null);
    }
  );
}

/* ==========================================================
   6. WRITES — PRODUCTS (admin)
   ----------------------------------------------------------
   Saving an ACTIVE product is what publishes it to customers.
   ========================================================== */

/* ==========================================================
   IMAGE UPLOAD
   ----------------------------------------------------------
   Images could only ever be pasted URLs. This adds a real file
   upload to Firebase Storage while leaving the URL field exactly
   where it was — some of your images are picsum/ibb links and
   there is no reason to re-host those.

   THE SDK IS LOADED LAZILY, inside the function. Two reasons, and
   both matter:

     1. Storage may not be turned on for this project. It is not
        enabled by default, and newer Firebase projects need the
        Blaze plan for it. A static import plus a getStorage() call
        at module load would throw while the module was being
        evaluated, which takes down EVERY admin page — the same
        failure mode as the missing export earlier today, and for
        a feature most sessions never touch.

     2. The storage bundle is ~70 KB that nobody who isn't
        uploading should have to download.

   If Storage is unavailable the error is caught and reported in
   the modal; the URL field keeps working regardless.

   Storage rules this needs (Firebase console -> Storage -> Rules):

       rules_version = '2';
       service firebase.storage {
         match /b/{bucket}/o {
           match /{folder}/{allPaths=**} {
             allow read: if true;
             allow write: if request.auth != null
                          && request.resource.size < 5 * 1024 * 1024
                          && request.resource.contentType.matches('image/.*');
           }
         }
       }
   ========================================================== */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/* How long the SDK may spend retrying before it gives up. The default
   is 10 minutes, which is what turned a missing bucket into an upload
   that sat at 0% and never came back. */
const UPLOAD_RETRY_MS = 20000;

/* And how long we wait for the FIRST byte before deciding nothing is
   listening. Slightly longer than the retry window, so a failure the
   SDK can report arrives as a real error code rather than as this
   catch-all. */
const UPLOAD_STALL_MS = 25000;

/* Set once a failure is clearly about the bucket rather than the file,
   so the other four images in a drop fail instantly instead of waiting
   their turn. A page reload clears it — which is also when someone
   would have gone and enabled Storage. */
let STORAGE_BLOCKED = "";

/**
 * @param {File} file
 * @param {{ productId?: string, onProgress?: (percent:number)=>void }} options
 * @returns {Promise<string>} the public download URL to store on the product
 */
/* ==========================================================
   IMAGE UPLOAD
   ----------------------------------------------------------
   One entry point, uploadImage(), and three possible
   destinations behind it. Which one is used comes from
   image-upload-config.js; every caller just gets a URL back
   and stores it in the same field a pasted URL goes in, so
   nothing downstream knows or cares where the bytes live.

   Switching hosts is a one-line edit in that file.
   ========================================================== */

/**
 * Shrink an image in the browser before sending it.
 *
 * A phone photo is routinely 4000px and 6 MB, and is displayed
 * at about 600px. Uploading the original wastes the admin's data
 * once and every shop visitor's data forever after.
 *
 * Returns the original file untouched if it is already small, if
 * resizing is switched off, or if anything at all goes wrong —
 * a failed optimisation must never become a failed upload.
 */
async function shrinkImage(file) {
  const cfg = IMAGE_UPLOAD.resize || {};
  if (!cfg.enabled) return file;
  if (file.size < (cfg.minBytes ?? 0)) return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const maxWidth = cfg.maxWidth || 1600;
    const scale = Math.min(1, maxWidth / Math.max(bitmap.width, bitmap.height));

    /* Transparency check, before deciding on a format. Re-encoding a
       logo with a transparent background as JPEG fills that
       background with black, which is a worse outcome than a slightly
       larger file. Sampled rather than scanned: every 16th pixel is
       plenty to notice a transparent region, and a full scan of a
       12-megapixel image is not free. */
    let hasAlpha = false;
    if (/png|webp|gif/i.test(file.type)) {
      const probe = document.createElement("canvas");
      probe.width = Math.min(bitmap.width, 400);
      probe.height = Math.max(1, Math.round((probe.width / bitmap.width) * bitmap.height));
      const pctx = probe.getContext("2d");
      pctx.drawImage(bitmap, 0, 0, probe.width, probe.height);
      const data = pctx.getImageData(0, 0, probe.width, probe.height).data;
      /* The threshold is 200, not 254, and that matters. A screenshot
         or an editor export routinely carries stray pixels at alpha
         249 along an anti-aliased edge — invisible, but enough to make
         a "> 0 transparent pixels" test fire on every image, which
         then skips both the resize and the JPEG conversion for
         everything. A genuinely transparent background is alpha 0 over
         a large area, so it clears 200 easily. */
      for (let i = 3; i < data.length; i += 4 * 16) {
        if (data[i] < 200) { hasAlpha = true; break; }
      }
    }

    // Nothing to gain: already small enough and must stay PNG.
    if (scale === 1 && hasAlpha) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const type = hasAlpha ? "image/png" : "image/jpeg";
    const blob = await new Promise((res) =>
      canvas.toBlob(res, type, hasAlpha ? undefined : cfg.quality ?? 0.82)
    );
    if (!blob) return file;
    // Re-encoding made it bigger. Happens with small or already
    // well-compressed images; keep whichever is smaller.
    if (blob.size >= file.size) return file;

    const name = String(file.name || "image").replace(/\.[^.]+$/, "") + (hasAlpha ? ".png" : ".jpg");
    return new File([blob], name, { type });
  } catch (err) {
    console.warn("Could not resize the image; sending the original.", err);
    return file;
  }
}

/**
 * POST with real upload progress.
 *
 * XMLHttpRequest rather than fetch(), for one reason: fetch has no
 * upload progress event. The percentage in the admin panel would be
 * stuck at 0 until the whole file had gone, which is the exact thing
 * that made the Firebase failure so confusing.
 */
function postWithProgress(url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.timeout = 60000;

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      let parsed = null;
      try { parsed = JSON.parse(xhr.responseText); } catch { /* handled below */ }
      if (xhr.status >= 200 && xhr.status < 300 && parsed) return resolve(parsed);
      reject(
        new Error(
          parsed?.error?.message ||
            parsed?.error ||
            `The image host answered ${xhr.status || "nothing"}.`
        )
      );
    };
    xhr.onerror = () =>
      reject(new Error("Could not reach the image host. Check your internet connection."));
    xhr.ontimeout = () => reject(new Error("The upload timed out after 60 seconds."));
    xhr.send(body);
  });
}

/* ---------- imgbb ---------- */

async function uploadToImgbb(file, { onProgress }) {
  const key = String(IMAGE_UPLOAD.imgbb?.apiKey || "").trim();
  if (!key) {
    throw new Error(
      "No imgbb API key yet. Get one free at https://api.imgbb.com and paste it into " +
        "image-upload-config.js, or paste an image URL instead."
    );
  }

  const body = new FormData();
  body.append("image", file);
  body.append("name", String(file.name || "image").replace(/\.[^.]+$/, ""));

  const json = await postWithProgress(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, body, onProgress);

  // imgbb answers 200 with success:false for a bad key, so the status
  // code alone is not the test.
  const url = json?.data?.url || json?.data?.display_url;
  if (!json?.success || !url) {
    throw new Error(
      json?.error?.message || "imgbb rejected the upload. Check the API key in image-upload-config.js."
    );
  }
  return url;
}

/* ---------- Cloudinary ----------
   NOT VERIFIED against Cloudinary's own docs: their documentation
   pages would not render for me when this was written, so the request
   shape below is from knowledge rather than from the reference. imgbb
   above WAS checked against api.imgbb.com. If this path misbehaves,
   the thing to re-check is the preset name and that its signing mode
   is set to Unsigned. */

async function uploadToCloudinary(file, { folder, onProgress }) {
  const cloud = String(IMAGE_UPLOAD.cloudinary?.cloudName || "").trim();
  const preset = String(IMAGE_UPLOAD.cloudinary?.uploadPreset || "").trim();
  if (!cloud || !preset) {
    throw new Error(
      "Cloudinary is selected but its cloud name or upload preset is missing from " +
        "image-upload-config.js. The preset must be an UNSIGNED one."
    );
  }

  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", preset);
  if (folder) body.append("folder", folder);

  const json = await postWithProgress(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`,
    body,
    onProgress
  );
  const url = json?.secure_url || json?.url;
  if (!url) throw new Error(json?.error?.message || "Cloudinary did not return an image URL.");
  return url;
}

/* ---------- firebase ---------- */

async function uploadToFirebase(file, { folder, id, onProgress }) {
  let storage, storageRef, uploadBytesResumable, getDownloadURL;
  try {
    ({ getStorage: storage, ref: storageRef, uploadBytesResumable, getDownloadURL } = await import(
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js"
    ));
  } catch {
    throw new Error("Could not load the Firebase Storage library. Check your connection.");
  }

  // A bucket-level problem is the same for every file. Dropping five
  // images should cost one failure, not five waits.
  if (STORAGE_BLOCKED) throw new Error(STORAGE_BLOCKED);

  let bucket;
  try {
    bucket = storage();
  } catch {
    /* getStorage() only throws when the config has no storageBucket at
       all. It does NOT check that the bucket exists — that is why the
       old version of this function could not catch the real problem
       here, and left the upload hanging instead. */
    STORAGE_BLOCKED =
      "This project's Firebase config has no storageBucket, so there is nowhere to upload to. " +
      "Paste an image URL instead.";
    throw new Error(STORAGE_BLOCKED);
  }

  /* FAIL FAST.

     The default is 10 MINUTES. When a bucket does not exist the upload
     request 404s, the SDK treats that as retryable, and it quietly
     backs off and retries for the whole window before calling the
     error handler — which is exactly "it sits at 0% forever and
     nothing happens". Twenty seconds is long enough for a slow phone
     connection to get a 5 MB file moving and short enough to be an
     answer rather than a hang. */
  bucket.maxUploadRetryTime = UPLOAD_RETRY_MS;
  bucket.maxOperationRetryTime = UPLOAD_RETRY_MS;

  /* A predictable, collision-proof path. The timestamp keeps two
     uploads of the same filename apart, and the sanitised name keeps
     the file recognisable in the console. */
  const safeName = String(file.name || "image")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-60) || "image";
  const safeFolder = String(folder || "products").replace(/[^a-z0-9_-]+/gi, "") || "products";
  const safeId = String(id || "new").replace(/[^a-zA-Z0-9._-]+/g, "-") || "new";
  const path = `${safeFolder}/${safeId}/${Date.now()}-${safeName}`;

  const task = uploadBytesResumable(storageRef(bucket, path), file, {
    contentType: file.type,
    cacheControl: "public,max-age=31536000"
  });

  await new Promise((resolve, reject) => {
    let settled = false;
    let movedBytes = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      fn(value);
    };

    /* The backstop. maxUploadRetryTime covers the case where the SDK
       reports a failure; this covers the case where it never reports
       anything at all — a request that is neither answered nor
       rejected leaves `state_changed` silent and the promise pending
       forever, which no amount of retry configuration fixes. */
    const watchdog = setTimeout(() => {
      if (movedBytes) return; // slow but alive — let it finish

      STORAGE_BLOCKED = storageUnreachableMessage(bucketName(bucket));

      /* Reject BEFORE cancelling, not after. task.cancel() fires the
         error handler synchronously with storage/canceled, so doing it
         the other way round settles the promise with "The upload was
         cancelled" — technically true, and useless: it describes what
         this code did, not why the upload was going nowhere. */
      finish(reject, new Error(STORAGE_BLOCKED));
      try { task.cancel(); } catch { /* already gone */ }
    }, UPLOAD_STALL_MS);

    task.on(
      "state_changed",
      (snap) => {
        if (snap.bytesTransferred > 0) movedBytes = true;
        if (onProgress && snap.totalBytes) {
          onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        }
      },
      (err) => finish(reject, new Error(describeUploadError(err, bucketName(bucket)))),
      () => finish(resolve)
    );
  });

  return getDownloadURL(task.snapshot.ref);
}

/** The bucket this Storage instance points at, for error messages. */
function bucketName(bucket) {
  // Not part of the public API, so every access is guarded — a missing
  // name must not turn an error message into a second error.
  try {
    return bucket?.app?.options?.storageBucket || bucket?._bucket?.bucket || "(unknown bucket)";
  } catch {
    return "(unknown bucket)";
  }
}

function storageUnreachableMessage(name) {
  return (
    `Could not reach the storage bucket "${name}". The most likely reason is that ` +
    "Cloud Storage has never been set up on this Firebase project — it has to be turned on in the " +
    "Firebase console under Build → Storage, and that now requires the project to be on the Blaze " +
    "plan. Until then, paste an image URL instead; it is saved on the record exactly the same way."
  );
}

/* Firebase's own messages for these are things like "An unknown error
   occurred", which tells nobody what to do next. */
function describeUploadError(err, name) {
  switch (String(err?.code || "")) {
    case "storage/unauthorized":
      return (
        "Storage rejected the upload. The bucket exists, so this is the rules: they need to allow " +
        "signed-in writes under products/ and trails/."
      );
    case "storage/unauthenticated":
      return "You are signed out. Sign in again and retry the upload.";
    case "storage/quota-exceeded":
      return `The storage bucket "${name}" is over its quota.`;
    case "storage/retry-limit-exceeded":
    case "storage/unknown":
      STORAGE_BLOCKED = storageUnreachableMessage(name);
      return STORAGE_BLOCKED;
    case "storage/canceled":
      return "The upload was cancelled.";
    default:
      return err?.message || "The upload failed.";
  }
}

/**
 * Why uploads are unavailable, or "" while they look fine.
 *
 * The admin pages call this after a failed upload so the drop zone can
 * stop inviting something that cannot work, rather than letting
 * someone try the same thing with every image they have.
 */
export function storageUnavailableReason() {
  return STORAGE_BLOCKED || "";
}


/* ---------- the entry point ---------- */

/**
 * Upload an image and get back a URL to store on the record.
 *
 * The signature has not changed, so every existing caller works
 * untouched — only the destination behind it is now configurable.
 */
export async function uploadImage(file, { folder = "products", id = "new", onProgress = null } = {}) {
  if (!file) throw new Error("No file selected.");
  if (!String(file.type || "").startsWith("image/")) {
    throw new Error(`"${file.name}" is not an image.`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB. The limit is 5 MB — resize it first.`
    );
  }

  // A problem with the destination itself is the same for every file,
  // so the rest of a dropped batch fails immediately rather than each
  // one waiting its own turn.
  if (STORAGE_BLOCKED) throw new Error(STORAGE_BLOCKED);

  const provider = String(IMAGE_UPLOAD.provider || "off").toLowerCase();
  if (provider === "off") {
    STORAGE_BLOCKED =
      "Image upload is switched off in image-upload-config.js. Paste an image URL instead.";
    throw new Error(STORAGE_BLOCKED);
  }

  /* Resized BEFORE the provider sees it, so every destination gets the
     same treatment and none of them has to know about it. */
  const payload = await shrinkImage(file);

  try {
    if (provider === "imgbb") return await uploadToImgbb(payload, { onProgress });
    if (provider === "cloudinary") return await uploadToCloudinary(payload, { folder, onProgress });
    if (provider === "firebase") return await uploadToFirebase(payload, { folder, id, onProgress });
  } catch (err) {
    /* A missing key is configuration, not a transient failure — every
       other file in the batch will hit it too, and the drop zone
       should stand down rather than invite another attempt. */
    if (/API key|upload preset|switched off/i.test(err?.message || "")) {
      STORAGE_BLOCKED = err.message;
    }
    throw err;
  }

  STORAGE_BLOCKED = `"${provider}" is not a known upload provider. Check image-upload-config.js.`;
  throw new Error(STORAGE_BLOCKED);
}

/** Kept so admin-products.js needs no change. */
export const uploadProductImage = (file, { productId = "new", onProgress = null } = {}) =>
  uploadImage(file, { folder: "products", id: productId, onProgress });

export async function saveProduct(data, id = null, previous = null) {
  /* Lists and maps, normalised before they are written.
     Firestore replaces a map wholesale on updateDoc, so `attributes`
     and `specs` have to be sent complete — which they are, because the
     modal's row editors load every existing key and hand them all back.
     That is also why an empty attribute is kept: deleting a picker the
     product page expects should be a deliberate act, not a side effect
     of leaving a row blank. */
  const images = Array.isArray(data.images)
    ? data.images.map((v) => String(v || "").trim()).filter(Boolean)
    : [];

  const attributes = {};
  for (const [key, value] of Object.entries(data.attributes || {})) {
    const name = String(key || "").trim();
    if (!name) continue;
    attributes[name] = Array.isArray(value)
      ? value.map((v) => String(v ?? "").trim()).filter(Boolean)
      : String(value ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
  }

  const specs = {};
  for (const [key, value] of Object.entries(data.specs || {})) {
    const name = String(key || "").trim();
    if (name) specs[name] = String(value ?? "").trim();
  }

  /* QUANTITY, and how it relates to inStock.

     An empty box means "not tracking a count for this product" and
     writes nothing — it does NOT mean zero. That is what lets you add
     counts to a few products without implying the other 60 have none.

     Where a count IS given, zero wins: a product with nothing left
     cannot be on sale, whatever the switch says. Allowing both to be
     set independently would hand you two competing availability flags,
     which is the exact bug that took a day to find between `status`
     and `inStock`. The switch still decides when quantity is above
     zero — having stock you choose not to sell is a real situation. */
  const quantityGiven =
    data.quantity !== undefined && data.quantity !== null && String(data.quantity).trim() !== "";
  const quantity = quantityGiven ? Math.max(0, Math.trunc(Number(data.quantity) || 0)) : null;

  const payload = {
    name: String(data.name || "").trim(),
    category: String(data.category || "").trim(),
    subcategory: String(data.subcategory || "").trim(),
    description: String(data.description || "").trim(),
    price: Number(data.price) || 0,
    inStock: quantity === 0 ? false : data.inStock !== false,
    images,
    /* Kept in step with images[0]. The shop falls back to this field
       for records written before the gallery existed, and leaving a
       stale value here would show one picture on the card and a
       different one in the drawer. */
    image: images[0] || String(data.image || "").trim(),
    attributes,
    specs,
    updatedAt: serverTimestamp()
  };

  if (quantityGiven) payload.quantity = quantity;

  /* SALE — written EVERY time, unlike quantity.

     Firestore replaces a map wholesale on updateDoc, which is exactly
     what is wanted here: turning a sale off has to persist `on: false`
     rather than leaving yesterday's map in place. Omitting the field
     when the switch is off would do the opposite — the old sale would
     survive the save that was meant to end it. */
  payload.sale = buildSalePayload(data.sale);

  const popularity = Number(data.popularity);
  if (Number.isFinite(popularity)) payload.popularity = popularity;

  /* `status` is written ONLY to a document that already has one.
     Your product documents do not: availability on them is `inStock`.
     Writing a status onto those would give every record a second
     availability flag, and products.js reads both — so a product could
     be inStock and status-inactive at the same time, visible in the
     panel and missing from the shop. */
  if (previous?.hasStatusField || (!id && data.status)) {
    payload.status = String(data.status || "active").toLowerCase();
  }

  const LABELS = {
    name: "Name", category: "Category", subcategory: "Subcategory",
    price: "Price", status: "Status", image: "Image",
    description: "Description", inStock: "In stock", quantity: "Quantity",
    images: "Images", attributes: "Attributes", specs: "Specs",
    popularity: "Popularity", sale: "Sale"
  };

  if (id) {
    await updateDoc(doc(db, COL.products, id), payload);
    await logAudit({
      action: "update", entity: "product", entityId: id, entityLabel: payload.name,
      changes: diffFields(
        /* Compare like with like: the lists and maps are flattened to
           text on both sides, or the log reports "[object Object] ->
           [object Object]" for every edit. */
        previous
          ? {
              ...previous,
              inStock: previous.inStock ? "yes" : "no",
              images: (previous.images || []).join(", "),
              attributes: summariseMap(previous.attributes),
              specs: summariseMap(previous.specs),
              // Flattened on both sides, or the log reads
              // "[object Object] -> [object Object]" for every sale edit.
              sale: summariseSale(previous)
            }
          : null,
        {
          ...payload,
          inStock: payload.inStock ? "yes" : "no",
          images: images.join(", "),
          attributes: summariseMap(attributes),
          specs: summariseMap(specs),
          sale: summariseSale(payload)
        },
        LABELS
      )
    });
    return id;
  }

  const created = await addDoc(productsRef(), {
    ...payload,
    bookingCount: 0,
    dateAdded: serverTimestamp()
  });
  // No `amount` here on purpose — a product's price in the activity
  // feed reads like revenue, which is what made "Added product" show
  // a ₱803,826 figure next to it.
  await logAudit({
    action: "create", entity: "product", entityId: created.id, entityLabel: payload.name
  });
  return created.id;
}

/** "size: S, M, L · color: Red" — a map rendered for the audit log. */
function summariseMap(map) {
  if (!map || typeof map !== "object") return "";
  return Object.entries(map)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join(" · ");
}

/**
 * ADDED — set a product's stock count on its own.
 *
 * Receiving a delivery or counting the shelf is a different job from
 * editing a product, and making you open the whole form to change one
 * number is how counts stop being kept up to date.
 *
 * Writes inStock alongside, for the same reason saveProduct does: a
 * count of zero means the shop must stop selling it, and letting the
 * two disagree is what creates a product that reads "in stock" with
 * nothing behind it. Going from zero back up does NOT silently put it
 * on sale — `resume` says whether to, so restocking something you had
 * deliberately delisted cannot relist it behind your back.
 */
export async function setProductQuantity(product, nextQuantity, { resume = true } = {}) {
  const quantity = Math.max(0, Math.trunc(Number(nextQuantity) || 0));
  const previous = product.hasQuantity ? product.quantity : null;
  if (previous === quantity) return false;

  const inStock = quantity === 0 ? false : resume ? true : product.inStock;

  await updateDoc(doc(db, COL.products, product.id), {
    quantity,
    inStock,
    updatedAt: serverTimestamp()
  });

  const changes = [
    { field: "Quantity", from: previous === null ? "not tracked" : String(previous), to: String(quantity) }
  ];
  if (inStock !== product.inStock) {
    changes.push({ field: "In stock", from: product.inStock ? "yes" : "no", to: inStock ? "yes" : "no" });
  }

  await logAudit({
    action: "update",
    entity: "product",
    entityId: product.id,
    entityLabel: product.name,
    summary: `Set stock of "${product.name}" to ${quantity}${
      quantity === 0 ? " — now out of stock" : ""
    }`,
    changes,
    status: quantity === 0 ? "pending" : "completed"
  });

  return true;
}

/**
 * The stock toggle on the Products table.
 *
 * CHANGED — it takes a fourth argument, which admin-products.js has
 * been passing all along to a function that did not accept it.
 *
 * The old version always wrote `status`. Your product documents have
 * no status field; availability on them is `inStock`, and the shop
 * reads both. So one press of "Mark out" would have added a competing
 * flag to a record that had none, and pressing it across the table
 * would have done that to all of them. With `hasStatusField: false`
 * this writes `inStock` and leaves the document's shape alone.
 */
export async function setProductStatus(id, status, label = "", { hasStatusField = true } = {}) {
  const wanted = String(status).toLowerCase();
  const patch = hasStatusField
    ? { status: wanted, updatedAt: serverTimestamp() }
    : { inStock: wanted === "active", updatedAt: serverTimestamp() };

  await updateDoc(doc(db, COL.products, id), patch);

  await logAudit({
    action: "status", entity: "product", entityId: id, entityLabel: label,
    summary: hasStatusField
      ? `Set product "${label}" to ${wanted}`
      : `Marked product "${label}" ${wanted === "active" ? "in stock" : "out of stock"}`,
    changes: [
      hasStatusField
        ? { field: "Status", from: wanted === "active" ? "inactive" : "active", to: wanted }
        : { field: "In stock", from: wanted === "active" ? "no" : "yes",
            to: wanted === "active" ? "yes" : "no" }
    ],
    status: wanted === "active" ? "completed" : "pending"
  });
}

export const deleteProduct = (id, label = "") => hardDelete(COL.products, id, label, "product");

/* ==========================================================
   6b. WRITES — BOOKING CATALOG (admin)
   ----------------------------------------------------------
   Saving here is what changes the customer's booking form.
   ========================================================== */

/** "Mt. Pulag Traverse" -> "mt-pulag-traverse". Used for the
    business ids booking.js keys its dropdowns off. */
export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `id-${Date.now().toString(36)}`;
}

export async function saveTrail(data, docId = null, previous = null) {
  const payload = {
    trail_id: data.trailId?.trim() || slugify(data.name),
    name: String(data.name || "").trim(),
    location: String(data.location || "").trim(),
    difficulty: String(data.difficulty || "").trim(),
    duration: String(data.duration || "").trim(),
    description: String(data.description || "").trim(),
    image: String(data.image || "").trim(),
    // booking.js reads `guide_id` as the array of guides for a trail.
    guide_id: Array.isArray(data.guideIds) ? data.guideIds : [],
    // What trail.js shows on the trails page as "<price>/person".
    base_price: Number(data.basePrice) || 0,
    status: data.status || "Open",
    updatedAt: serverTimestamp()
  };

  // Only written when supplied, so a trail that already has
  // coordinates doesn't get them wiped by an edit that left the
  // fields blank.
  if (data.lat !== "" && data.lat != null && Number.isFinite(Number(data.lat))) {
    payload.lat = Number(data.lat);
  }
  if (data.lon !== "" && data.lon != null && Number.isFinite(Number(data.lon))) {
    payload.lon = Number(data.lon);
  }

  if (docId) {
    await updateDoc(doc(db, COL.trails, docId), payload);
    await logAudit({
      action: "update",
      entity: "trail",
      entityId: docId,
      entityLabel: payload.name,
      changes: diffFields(previous, {
        name: payload.name, location: payload.location, difficulty: payload.difficulty,
        duration: payload.duration, basePrice: payload.base_price, status: payload.status,
        image: payload.image, description: payload.description, guideIds: payload.guide_id
      }, {
        name: "Name", location: "Location", difficulty: "Difficulty", duration: "Duration",
        basePrice: "Price", status: "Status", image: "Image", description: "Description",
        guideIds: "Guides"
      })
    });
    return docId;
  }

  const created = await addDoc(trailsRef(), { ...payload, createdAt: serverTimestamp() });
  await logAudit({ action: "create", entity: "trail", entityId: created.id, entityLabel: payload.name });
  return created.id;
}

export async function saveGuide(data, docId = null, previous = null) {
  const payload = {
    guide_id: data.guideId?.trim() || slugify(data.fullName),
    full_name: String(data.fullName || "").trim(),
    specialty: String(data.specialty || "").trim(),
    rating: Number(data.rating) || 0,
    status: data.status || "Active",
    // Capital P on purpose — that is the key your guide documents
    // already use. Writing `photo` instead would leave the old field
    // in place and create a second one beside it, so every guide would
    // quietly end up with two competing photo fields.
    Photo: String(data.photo || "").trim(),
    contact: String(data.contact || "").trim(),
    years_experience: Number(data.yearsExperience) || 0,
    updatedAt: serverTimestamp()
  };

  if (docId) {
    await updateDoc(doc(db, COL.guides, docId), payload);
    await logAudit({
      action: "update", entity: "guide", entityId: docId, entityLabel: payload.full_name,
      changes: diffFields(previous, {
        fullName: payload.full_name, specialty: payload.specialty,
        rating: payload.rating, status: payload.status,
        photo: payload.Photo, contact: payload.contact,
        yearsExperience: payload.years_experience
      }, {
        fullName: "Name", specialty: "Specialty", rating: "Rating", status: "Status",
        photo: "Photo", contact: "Contact", yearsExperience: "Years experience"
      })
    });
    return docId;
  }
  const created = await addDoc(guidesRef(), { ...payload, createdAt: serverTimestamp() });
  await logAudit({ action: "create", entity: "guide", entityId: created.id, entityLabel: payload.full_name });
  return created.id;
}

export async function savePackage(data, docId = null, previous = null) {
  const payload = {
    package_id: data.packageId?.trim() || slugify(data.name),
    name: String(data.name || "").trim(),
    price_per_pax: Number(data.pricePerPax) || 0,
    includes: Array.isArray(data.includes)
      ? data.includes
      : String(data.includes || "")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
    requires_activity_choice: Boolean(data.requiresActivityChoice),
    requires_accommodation: Boolean(data.requiresAccommodation),
    updatedAt: serverTimestamp()
  };

  if (docId) {
    await updateDoc(doc(db, COL.packages, docId), payload);
    await logAudit({
      action: "update", entity: "package", entityId: docId, entityLabel: payload.name,
      changes: diffFields(previous, {
        name: payload.name, pricePerPax: payload.price_per_pax,
        includes: payload.includes,
        requiresActivityChoice: payload.requires_activity_choice,
        requiresAccommodation: payload.requires_accommodation
      }, { name: "Name", pricePerPax: "Price per pax", includes: "Includes",
           requiresActivityChoice: "Activity choice",
           requiresAccommodation: "Accommodation" })
    });
    return docId;
  }
  const created = await addDoc(packagesRef(), { ...payload, createdAt: serverTimestamp() });
  await logAudit({ action: "create", entity: "package", entityId: created.id, entityLabel: payload.name });
  return created.id;
}

/* ---------- archive / restore ----------
   Delete is the one action nobody can undo, so the panel no longer
   does it by default. Archiving flips a flag: the record leaves every
   list but stays in Firestore, and it also goes Closed / Inactive so
   booking.js and the shop drop it too — they read `status`, not
   `archived`, and rewriting those files to understand a new field
   would have been the fragile way to do this.

   Permanent delete still exists below, for the archived view only. */

const ARCHIVE_STATUS = {
  trails: { off: "Closed", on: "Open" },
  guides: { off: "Inactive", on: "Active" },
  products: { off: "inactive", on: "active" }
};

async function setArchived(col, docId, label, entity, archived, restoreStatus) {
  const patch = { archived, updatedAt: serverTimestamp() };
  const map = ARCHIVE_STATUS[col];
  if (map) patch.status = archived ? map.off : restoreStatus || map.on;
  if (archived) {
    patch.archivedAt = serverTimestamp();
    patch.archivedBy = auth.currentUser?.displayName || auth.currentUser?.email || "admin";
  }
  await updateDoc(doc(db, col, docId), patch);
  await logAudit({
    action: archived ? "archive" : "restore",
    entity,
    entityId: docId,
    entityLabel: label,
    summary: `${archived ? "Archived" : "Restored"} ${entity} "${label}"`,
    status: archived ? "cancelled" : "completed"
  });
}

export const archiveTrail = (docId, label) => setArchived(COL.trails, docId, label, "trail", true);
export const restoreTrail = (docId, label) => setArchived(COL.trails, docId, label, "trail", false);
export const archiveGuide = (docId, label) => setArchived(COL.guides, docId, label, "guide", true);
export const restoreGuide = (docId, label) => setArchived(COL.guides, docId, label, "guide", false);
export const archivePackage = (docId, label) => setArchived(COL.packages, docId, label, "package", true);
export const restorePackage = (docId, label) => setArchived(COL.packages, docId, label, "package", false);
export const archiveProduct = (docId, label) => setArchived(COL.products, docId, label, "product", true);
export const restoreProduct = (docId, label) => setArchived(COL.products, docId, label, "product", false);

/** Irreversible. Only offered from the archived view. */
async function hardDelete(col, docId, label, entity) {
  await deleteDoc(doc(db, col, docId));
  await logAudit({
    action: "delete", entity, entityId: docId, entityLabel: label,
    summary: `Permanently deleted ${entity} "${label}"`, status: "cancelled"
  });
}

export const deleteTrail = (docId, label = "") => hardDelete(COL.trails, docId, label, "trail");
export const deleteGuide = (docId, label = "") => hardDelete(COL.guides, docId, label, "guide");
export const deletePackage = (docId, label = "") => hardDelete(COL.packages, docId, label, "package");

/* ==========================================================
   6c. WRITES — ORDERS + SUPPORT (admin)
   ========================================================== */

/* ==========================================================
   STOCK MOVEMENT ON FULFILMENT
   ----------------------------------------------------------
   Why here and not at checkout:

   A customer's browser cannot write to `products` — the rule is
   `allow write: if isAdmin()`. And payment-result.js takes the
   word "success" straight from the URL, so anything hung off
   payment could be triggered by typing a different query string.
   Fulfilment is admin-authenticated and matches how stock really
   behaves: units leave when the goods leave.

   Why a transaction: two admins working the order queue, or one
   double-click, would otherwise read the same count and both
   write it back minus their own line. runTransaction re-reads and
   retries instead.

   Firestore requires EVERY read in a transaction before ANY
   write, which is why the product documents are all fetched into
   `entries` first rather than updated as the loop goes.
   ========================================================== */

const DEDUCT_AT = ["shipped", "completed"];
const RESTORE_AT = ["cancelled", "refunded"];

/**
 * @returns {Promise<null | {
 *   direction: "deduct"|"restore", applied: Array, shortfalls: Array,
 *   untracked: Array, missing: Array, alreadyDone: boolean
 * }>}
 */
export async function applyOrderStock(order, direction = "deduct") {
  /* One product can appear on several lines — the same tent in two
     sizes is two lines and one count. Merge before touching stock, or
     the second write overwrites the first inside the same transaction. */
  const wanted = new Map();
  for (const line of order.items || []) {
    const id = line?.productId;
    const qty = Math.max(0, Math.trunc(Number(line?.qty) || 0));
    if (!id || !qty) continue;
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }
  if (!wanted.size) return null;

  let result = null;

  await runTransaction(db, async (tx) => {
    // A transaction body can be retried, so everything it reports is
    // rebuilt from scratch on each attempt.
    const applied = [];
    const shortfalls = [];
    const untracked = [];
    const missing = [];
    const zeroed = [];

    const orderRef = doc(db, COL.orders, order.id);
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists()) throw new Error("That order no longer exists.");

    const orderData = orderSnap.data();
    const alreadyDeducted = Boolean(orderData.stockDeductedAt);

    // The idempotency gate. Shipped -> Completed must not subtract a
    // second time, and cancelling an order whose stock never left must
    // not hand back units that were never taken.
    if (direction === "deduct" && alreadyDeducted) {
      result = { direction, applied: [], shortfalls: [], untracked: [], missing: [], alreadyDone: true };
      return;
    }
    if (direction === "restore" && !alreadyDeducted) {
      result = { direction, applied: [], shortfalls: [], untracked: [], missing: [], alreadyDone: true };
      return;
    }

    // Products this order previously forced to zero. Only those get put
    // back on sale by a restore — anything you had deliberately
    // delisted stays delisted.
    const previouslyZeroed = new Set(
      Array.isArray(orderData.stockZeroed) ? orderData.stockZeroed : []
    );

    // ---- every read first ----
    const entries = [];
    for (const [productId, qty] of wanted) {
      const ref = doc(db, COL.products, productId);
      entries.push({ ref, productId, qty, snap: await tx.get(ref) });
    }

    // ---- then every write ----
    for (const entry of entries) {
      if (!entry.snap.exists()) {
        missing.push({ productId: entry.productId, qty: entry.qty });
        continue;
      }

      const data = entry.snap.data();
      const stored = data.quantity ?? data.stock ?? data.stockQuantity;
      const tracked = typeof stored === "number" && Number.isFinite(stored);

      // No count on this product means there is nothing to subtract
      // from. Writing one here would start tracking it at a number
      // nobody chose.
      if (!tracked) {
        untracked.push({ productId: entry.productId, name: data.name || entry.productId, qty: entry.qty });
        continue;
      }

      const current = Math.max(0, Math.trunc(stored));
      const patch = { updatedAt: serverTimestamp() };
      let next;

      if (direction === "deduct") {
        next = current - entry.qty;
        if (next < 0) {
          // Sold more than were on the shelf. Clamp and report it — a
          // negative count would read as a stock level below the
          // low-stock line and silently distort every total.
          shortfalls.push({
            productId: entry.productId, name: data.name || entry.productId,
            asked: entry.qty, had: current
          });
          next = 0;
        }
        if (next === 0) {
          patch.inStock = false;
          zeroed.push(entry.productId);
        }
      } else {
        next = current + entry.qty;
        if (previouslyZeroed.has(entry.productId)) patch.inStock = true;
      }

      patch.quantity = next;
      tx.update(entry.ref, patch);
      applied.push({
        productId: entry.productId, name: data.name || entry.productId,
        from: current, to: next
      });
    }

    tx.update(orderRef, {
      stockDeductedAt: direction === "deduct" ? serverTimestamp() : null,
      stockZeroed: direction === "deduct" ? zeroed : []
    });

    result = { direction, applied, shortfalls, untracked, missing, alreadyDone: false };
  });

  if (result && !result.alreadyDone && result.applied.length) {
    await logAudit({
      action: "update",
      entity: "order",
      entityId: order.id,
      entityLabel: `#${order.orderId}`,
      summary:
        direction === "deduct"
          ? `Took ${result.applied.length} product(s) off stock for order #${order.orderId}`
          : `Returned ${result.applied.length} product(s) to stock from order #${order.orderId}`,
      changes: result.applied.map((a) => ({
        field: a.name, from: String(a.from), to: String(a.to)
      })),
      status: direction === "deduct" ? "completed" : "cancelled"
    });
  }

  return result;
}

export async function updateOrderStatus(order, status, adminUser = null) {
  await updateDoc(doc(db, COL.orders, order.id), {
    status,
    updatedAt: serverTimestamp()
  });

  /* Stock moves with fulfilment, and comes back if the order is
     reversed. Deliberately AFTER the status write and in its own
     try: a stock problem must not leave the order stuck on its old
     status, because the admin would press the button again and the
     idempotency stamp is the only thing standing between that and a
     double deduction. */
  let stock = null;
  const lower = String(status).toLowerCase();
  try {
    if (DEDUCT_AT.includes(lower)) stock = await applyOrderStock(order, "deduct");
    else if (RESTORE_AT.includes(lower)) stock = await applyOrderStock(order, "restore");
  } catch (err) {
    console.error("Stock movement failed:", err);
    stock = { direction: DEDUCT_AT.includes(lower) ? "deduct" : "restore", error: err.message };
  }

  const uid = order.uid || (order.email ? await findUidByEmail(order.email) : null);
  if (uid) {
    await notifyUser(uid, {
      title: `Order ${String(status).toLowerCase()}`,
      message: `Your order #${order.orderId} is now ${String(status).toLowerCase()}.`,
      type: "order"
    });
  }

  await logActivity({
    userName: order.customerName,
    activity: `Order #${order.orderId} marked ${String(status).toLowerCase()}`,
    amount: order.total,
    status: String(status).toLowerCase(),
    adminUser
  });

  // Handed back so the page can say what happened to stock rather than
  // leaving it to be discovered on the Products table later.
  return stock;
}

export async function updateMessageStatus(messageId, status, label = "") {
  const actor = auth.currentUser;
  await updateDoc(doc(db, COL.contact, messageId), {
    status,
    // ADDED. The document recorded that it changed but not who changed
    // it, so the message alone could never answer "who closed this?" —
    // you had to go hunting in the activity log.
    updatedBy: actor?.displayName || actor?.email || "an administrator",
    updatedAt: serverTimestamp()
  });
  await logAudit({
    action: "status", entity: "message", entityId: messageId,
    entityLabel: label || messageId.slice(0, 8).toUpperCase(),
    summary: `Marked support message #${label || messageId.slice(0, 8).toUpperCase()} ${String(status).toLowerCase()}`
  });
}

/**
 * Replying marks the thread handled and, for a signed-in sender,
 * drops the reply into their notifications.
 *
 * FIXED — this used to write `reply: replyText`, a single string.
 * Replying a second time overwrote the first reply, which was then
 * gone from Firestore altogether: not hidden, deleted. On a support
 * thread that is the worst possible field to lose, because it is the
 * record of what you told a customer.
 *
 * Replies now APPEND to a `replies` array, each one stamped with who
 * sent it and when. Documents holding the old single `reply` string
 * still read back correctly — normalizeMessage turns one into a
 * one-entry thread — so nothing already in your database is lost, and
 * the old field is left exactly where it is rather than migrated.
 *
 * serverTimestamp() cannot be used inside an array element (Firestore
 * rejects it), so these carry an ISO string, the same way booking
 * history entries already do.
 */
export async function replyToMessage(message, replyText) {
  const actor = auth.currentUser;
  const entry = {
    text: String(replyText || ""),
    by: actor?.displayName || actor?.email || "an administrator",
    at: new Date().toISOString()
  };

  await updateDoc(doc(db, COL.contact, message.id), {
    status: "Replied",
    replies: [...(message.thread || []), entry],
    repliedBy: entry.by,
    repliedAt: serverTimestamp()
  });

  const uid = message.uid || (message.email ? await findUidByEmail(message.email) : null);
  if (uid) {
    await notifyUser(uid, {
      title: `Re: your support message #${message.ref}`,
      message: replyText,
      type: "support"
    });
  }

  await logAudit({
    action: "update", entity: "message", entityId: message.id, entityLabel: message.ref,
    summary: `Replied to support message #${message.ref}`, status: "completed"
  });
}

/* ==========================================================
   7. WRITES — BOOKINGS
   ========================================================== */

/**
 * Called from the USER side at checkout. Stamps the booking with
 * `uid` so it shows up in the customer's account AND in the admin
 * bookings table the moment it is written.
 */
export async function createBooking(data) {
  const user = auth.currentUser;

  // Field names and "Pending" / "Unpaid" casing match what
  // booking.js already writes, so old and new booking documents
  // stay one shape. created_at stays an ISO string for the same
  // reason (toDate() above reads either form).
  const payload = {
    uid: user?.uid || null,
    trail_id: data.trailId || data.trail_id || null,
    trail_name: data.trailName || data.trail_name || "",
    package_id: data.packageId || data.package_id || null,
    package_name: data.packageName || data.package_name || "",
    activity: data.activity ?? null,
    guide_id: data.guideId || data.guide_id || null,
    guide_name: data.guideName || data.guide_name || "",
    date: data.date || "",
    group_size: Number(data.groupSize ?? data.group_size ?? 1),
    full_name: data.customerName || data.full_name || user?.displayName || "",
    email: data.email || user?.email || "",
    contact_number: data.phone || data.contact_number || "",
    emergency_name: data.emergencyName || data.emergency_name || "",
    emergency_number: data.emergencyNumber || data.emergency_number || "",
    total_price: Number(data.amount ?? data.total_price ?? 0),
    status: "Pending",
    payment_status: data.paymentStatus || "Unpaid",
    special_requests: data.specialRequests || "",
    history: [],
    created_at: new Date().toISOString()
  };

  const created = await addDoc(bookingsRef(), payload);

  await logActivity({
    userName: payload.full_name,
    userPhoto: user?.photoURL || "",
    activity: `Booked ${payload.trail_name || "a trail"}`,
    amount: payload.total_price,
    status: "pending"
  });

  if (payload.uid) {
    await notifyUser(payload.uid, {
      title: "Booking received",
      message: `We got your booking for ${payload.trail_name || "your trail"}. We'll confirm it shortly.`,
      type: "booking"
    });
  }

  return created.id;
}

/**
 * The key admin -> user link. An admin changing a booking status
 * writes the status, appends to the booking's own history log, and
 * drops a notification into that customer's account, which their
 * open tab picks up live.
 */
export async function updateBookingStatus(booking, newStatus, adminUser = null) {
  const status = String(newStatus);
  const entry = {
    title: `Status changed to ${status}`,
    detail: adminUser
      ? `Updated by ${adminUser.displayName || adminUser.email || "an administrator"}`
      : "Updated by an administrator",
    time: new Date().toISOString()
  };

  await updateDoc(doc(db, COL.bookings, booking.id), {
    status,
    history: [...(booking.history || []), entry],
    updatedAt: serverTimestamp()
  });

  const uid = booking.uid || (booking.email ? await findUidByEmail(booking.email) : null);
  if (uid) {
    await notifyUser(uid, {
      title: `Booking ${status.toLowerCase()}`,
      message: `Your booking for ${booking.trailName || "your trail"} (#${booking.orderId}) is now ${status.toLowerCase()}.`,
      type: "booking"
    });
  }

  await logActivity({
    userName: booking.customerName,
    activity: `Booking #${booking.orderId} marked ${status.toLowerCase()}`,
    amount: booking.amount,
    status: status.toLowerCase()
  });
}

export async function updateBookingFields(id, fields) {
  await updateDoc(doc(db, COL.bookings, id), { ...fields, updatedAt: serverTimestamp() });
}

/**
 * ADDED — the write half of the booking detail page.
 *
 * Until now the only thing an admin could change on a booking was its
 * status. Everything else — a mistyped phone number, a wrong departure
 * date, a missing emergency contact — had to be fixed in the Firebase
 * console. This saves the whole record.
 *
 * What it deliberately does NOT write: trail_id, guide_id and
 * package_id. Those are the keys booking.js matches its dropdowns
 * against, and editing one by hand without changing the matching name
 * (or vice versa) leaves a booking pointing at a trail it isn't for.
 * They are shown read-only on the page instead.
 *
 * `status` is left alone here too — it has its own control, because
 * changing it also notifies the customer, and that should never be a
 * side effect of fixing a typo.
 */
export async function saveBooking(booking, data, adminUser = null) {
  const payload = {
    full_name: String(data.customerName || "").trim(),
    email: String(data.email || "").trim(),
    contact_number: String(data.phone || "").trim(),
    trail_name: String(data.trailName || "").trim(),
    package_name: String(data.packageName || "").trim(),
    guide_name: String(data.guideName || "").trim(),
    date: String(data.date || "").trim(),
    departure_time: String(data.departureTime || "").trim(),
    group_size: Number(data.groupSize) || 1,
    total_price: Number(data.amount) || 0,
    payment_status: String(data.paymentStatus || "Unpaid").trim(),
    activity: String(data.activity || "").trim(),
    special_requests: String(data.specialRequests || "").trim(),
    emergency_name: String(data.emergencyName || "").trim(),
    emergency_number: String(data.emergencyNumber || "").trim(),
    updatedAt: serverTimestamp()
  };

  const changes = diffFields(
    booking,
    {
      customerName: payload.full_name, email: payload.email, phone: payload.contact_number,
      trailName: payload.trail_name, packageName: payload.package_name,
      guideName: payload.guide_name, date: payload.date,
      departureTime: payload.departure_time, groupSize: payload.group_size,
      amount: payload.total_price, paymentStatusLabel: payload.payment_status,
      activity: payload.activity, specialRequests: payload.special_requests,
      emergencyName: payload.emergency_name, emergencyNumber: payload.emergency_number
    },
    {
      customerName: "Customer", email: "Email", phone: "Phone",
      trailName: "Trail", packageName: "Package", guideName: "Guide",
      date: "Date", departureTime: "Departure time", groupSize: "Group size",
      amount: "Amount", paymentStatusLabel: "Payment status",
      activity: "Activity", specialRequests: "Special requests",
      emergencyName: "Emergency contact", emergencyNumber: "Emergency number"
    }
  );

  // Nothing moved — don't write, and don't put a meaningless line in
  // the audit log or the booking's own history.
  if (!changes.length) return false;

  // The booking carries its own visible history on the detail page, so
  // the edit is recorded there as well as in the audit log.
  const entry = {
    title: "Booking details edited",
    detail:
      `${changes.map((c) => c.field).join(", ")} updated by ` +
      (adminUser?.displayName || adminUser?.email || "an administrator"),
    time: new Date().toISOString()
  };

  await updateDoc(doc(db, COL.bookings, booking.id), {
    ...payload,
    history: [...(booking.history || []), entry]
  });

  await logAudit({
    action: "update", entity: "booking", entityId: booking.id,
    entityLabel: `#${booking.orderId}`,
    summary: `Edited booking #${booking.orderId} (${changes.length} field${changes.length === 1 ? "" : "s"})`,
    changes,
    amount: payload.total_price,
    status: String(booking.status || "pending").toLowerCase()
  });

  return true;
}

/* ==========================================================
   8. WRITES — USERS, PROFILE, WISHLIST, NOTIFICATIONS
   ========================================================== */

/** Creates the profile doc on first sign-in and seeds a welcome note. */
export async function ensureUserDoc(user) {
  const ref = doc(db, COL.users, user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) return normalizeUser(snap.id, snap.data());

  const profile = {
    displayName: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    phone: "",
    role: "customer",
    createdAt: serverTimestamp(),
    lastActiveAt: serverTimestamp()
  };
  await setDoc(ref, profile);

  await notifyUser(user.uid, {
    title: "Welcome to Trailbound!",
    message: "Your account is ready. Start exploring trails and save your favourites.",
    type: "info"
  });
  await logActivity({
    userName: profile.displayName || profile.email,
    userPhoto: profile.photoURL,
    activity: "Created an account",
    status: "completed"
  });

  return normalizeUser(user.uid, profile);
}

/** Keeps the admin "Active users" figure honest. Best-effort. */
export async function touchUser(user) {
  try {
    await updateDoc(doc(db, COL.users, user.uid), { lastActiveAt: serverTimestamp() });
  } catch {
    /* profile not created yet — ensureUserDoc will handle it */
  }
}

export async function updateUserProfile(uid, fields, label = "") {
  await updateDoc(doc(db, COL.users, uid), { ...fields, updatedAt: serverTimestamp() });
  // Only an admin disabling or re-enabling an account is worth logging;
  // a customer editing their own phone number is not.
  if ("disabled" in fields) {
    await logAudit({
      action: "update", entity: "user", entityId: uid, entityLabel: label || uid,
      summary: `${fields.disabled ? "Disabled" : "Re-enabled"} account ${label || uid}`,
      changes: [{ field: "Account", from: fields.disabled ? "active" : "disabled",
                  to: fields.disabled ? "disabled" : "active" }],
      status: fields.disabled ? "cancelled" : "completed"
    });
  }
}

/**
 * ADDED — an admin switching an account on or off.
 *
 * NOTE ON SCOPE. This deliberately writes ONE field. An earlier
 * version of this function also let an admin edit the customer's
 * display name and phone; that was removed at your instruction, and
 * it is the right call — those belong to the customer and are theirs
 * to change from their own account page. An admin panel that can
 * quietly rewrite someone's name is a panel you cannot lean on when a
 * record is disputed, which is the same reasoning that took the editor
 * off the orders page.
 *
 * Both the table's quick toggle and the modal switch call this, so a
 * disable always behaves identically: it is logged AND the customer is
 * told. Before, the table used updateUserProfile(), which logged but
 * never notified, so whether a blocked customer found out depended on
 * which button you happened to press.
 */
export async function setAccountDisabled(user, disabled, adminUser = null) {
  const next = disabled === true;
  if (user.disabled === next) return false;

  await updateDoc(doc(db, COL.users, user.id), {
    disabled: next,
    updatedAt: serverTimestamp()
  });

  const label = user.displayName || user.email || user.id;
  await logAudit({
    action: "update",
    entity: "user",
    entityId: user.id,
    entityLabel: label,
    summary: `${next ? "Disabled" : "Re-enabled"} the account of ${label}`,
    changes: [{ field: "Account", from: next ? "active" : "disabled",
                to: next ? "disabled" : "active" }],
    status: next ? "cancelled" : "completed"
  });

  await notifyUser(user.id, {
    title: next ? "Account disabled" : "Account re-enabled",
    message: next
      ? "An administrator has disabled your account. Contact support if you think this is a mistake."
      : "An administrator has re-enabled your account. Welcome back.",
    type: "info"
  });

  return true;
}

/**
 * Admin changing someone's role. Note: writing `admins/{uid}` is
 * deliberately NOT done here — see firestore.rules. Promoting a
 * real admin stays a console/backend action so it can't be forged
 * from a browser.
 */
export async function setUserRole(uid, role, previousRole = "", label = "") {
  await updateDoc(doc(db, COL.users, uid), {
    role: String(role).toLowerCase(),
    updatedAt: serverTimestamp()
  });
  await logAudit({
    action: "update", entity: "user", entityId: uid, entityLabel: label || uid,
    summary: `Changed ${label || "a user"}'s role to ${role}`,
    changes: previousRole ? [{ field: "Role", from: previousRole, to: role }] : []
  });
  await notifyUser(uid, {
    title: "Account updated",
    message: `An administrator changed your account role to ${role}.`,
    type: "info"
  });
}

export async function findUidByEmail(email) {
  try {
    const snap = await getDocs(query(usersRef(), where("email", "==", email), limit(1)));
    return snap.empty ? null : snap.docs[0].id;
  } catch (err) {
    console.error("User lookup failed:", err);
    return null;
  }
}

export async function notifyUser(uid, { title, message, type = "info" }) {
  if (!uid) return;
  try {
    await addDoc(notificationsRef(uid), {
      title,
      message,
      type,
      read: false,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error("Notification write failed:", err);
  }
}

export async function markNotificationRead(uid, notificationId) {
  await updateDoc(doc(db, COL.users, uid, "notifications", notificationId), { read: true });
}

export async function addToWishlist(uid, product) {
  await addDoc(wishlistRef(uid), {
    productId: product.id || null,
    name: product.name || "",
    image: product.image || "",
    price: Number(product.price) || null,
    addedAt: serverTimestamp()
  });
}

export async function removeFromWishlist(uid, itemId) {
  await deleteDoc(doc(db, COL.users, uid, "wishlist", itemId));
}

/* ==========================================================
   9. WRITES — SETTINGS + ACTIVITY LOG
   ========================================================== */

export async function saveSettings(settings, previous = null) {
  await setDoc(
    settingsRef(),
    { ...settings, updatedAt: serverTimestamp() },
    { merge: true }
  );
  // The notification toggles are nested one level down, so they get
  // flattened before diffing — otherwise both sides stringify to
  // "[object Object]" and every toggle change logs as "no changes".
  const flatten = (s) =>
    s && {
      siteName: s.siteName,
      timezone: s.timezone,
      notifNewBookings: s.notifications?.newBookings,
      notifCancellations: s.notifications?.cancellations,
      notifNewRegistrations: s.notifications?.newRegistrations,
      notifSystemUpdates: s.notifications?.systemUpdates
    };

  await logAudit({
    action: "update", entity: "settings", entityId: SETTINGS_DOC_ID,
    entityLabel: "Site settings", summary: "Updated site settings",
    changes: diffFields(flatten(previous), flatten(settings), {
      siteName: "Site name",
      timezone: "Timezone",
      notifNewBookings: "Notify: new bookings",
      notifCancellations: "Notify: cancellations",
      notifNewRegistrations: "Notify: registrations",
      notifSystemUpdates: "Notify: system updates"
    })
  });
}

/* ==========================================================
   AUDIT LOG
   ----------------------------------------------------------
   Every mutation an admin makes is written here, with WHO did it
   and — for edits — exactly which fields changed and what the old
   value was. That is what makes "who dropped the price on Mt.
   Pulag?" answerable three weeks later.

   The log is append-only: firestore.rules allows create and read
   but denies update and delete to everyone, admins included. An
   audit trail an admin can quietly edit is not an audit trail.

   Old-shape fields (userName, activity, amount, status) are still
   written so the existing dashboard table keeps working unchanged.
   ========================================================== */

/** Human label for a value going into the log. Keeps it short. */
function auditValue(value) {
  if (value === undefined || value === null || value === "") return "(empty)";
  if (Array.isArray(value)) return value.length ? `${value.length} item(s)` : "(none)";
  if (typeof value === "boolean") return value ? "yes" : "no";
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/**
 * Compares two objects over the fields you name and returns only what
 * actually changed. `fields` maps a property to the label to show.
 */
export function diffFields(before, after, fields) {
  if (!before) return [];
  return Object.entries(fields).reduce((changes, [key, label]) => {
    const from = before[key];
    const to = after[key];
    const same = Array.isArray(from) && Array.isArray(to)
      ? from.length === to.length && from.every((v, i) => v === to[i])
      : String(from ?? "") === String(to ?? "");
    if (!same) changes.push({ field: label, from: auditValue(from), to: auditValue(to) });
    return changes;
  }, []);
}

/**
 * The one place anything gets written to the audit log.
 * Never throws — a failed log must not roll back the real work.
 */
export async function logAudit({
  action = "update",
  entity = "system",
  entityId = null,
  entityLabel = "",
  changes = [],
  summary = "",
  amount = null,
  status = null
} = {}) {
  try {
    const user = auth.currentUser;
    const actorName = user?.displayName || user?.email || "System";

    const verb = { create: "Added", update: "Updated", delete: "Deleted",
                   archive: "Archived", restore: "Restored", status: "Changed status of" }[action]
                 || "Changed";

    await addDoc(collection(db, COL.activity), {
      /* --- who --- */
      actorUid: user?.uid || null,
      actorName,
      actorEmail: user?.email || "",
      actorPhoto: user?.photoURL || "",

      /* --- what --- */
      action,
      entity,
      entityId,
      entityLabel,
      changes,
      summary: summary || `${verb} ${entity} "${entityLabel}"`,

      /* --- legacy shape, so the dashboard table keeps working --- */
      userName: actorName,
      userPhoto: user?.photoURL || "",
      activity: summary || `${verb} ${entity} "${entityLabel}"`,
      amount,
      status: status || "system",

      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.warn("Audit log skipped:", err.message);
  }
}

/** Kept for older call sites. Routes into the same collection. */
export async function logActivity({ userName, userPhoto, activity, amount, status }) {
  try {
    const user = auth.currentUser;
    await addDoc(collection(db, COL.activity), {
      actorUid: user?.uid || null,
      actorName: userName || user?.displayName || user?.email || "System",
      actorEmail: user?.email || "",
      actorPhoto: userPhoto || user?.photoURL || "",
      action: "activity",
      entity: "system",
      changes: [],
      summary: activity || "",
      userName: userName || user?.displayName || user?.email || "System",
      userPhoto: userPhoto || user?.photoURL || "",
      activity: activity || "",
      amount: amount ?? null,
      status: status || "system",
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.warn("Activity log skipped:", err.message);
  }
}

/* ==========================================================
   10. SHARED UI BITS
   ========================================================== */

/**
 * Turns a Firestore error into something an admin can act on. Without this
 * a denied read and an empty collection look identical on screen — which is
 * exactly the trap I fell into on the Users page.
 */
export function describeError(err) {
  const code = err?.code || "";
  if (code === "permission-denied") {
    return "Firestore denied this read. The security rules either aren't deployed yet, or they don't allow an admin to list this collection. Run: firebase deploy --only firestore:rules";
  }
  if (code === "failed-precondition") {
    return "Firestore needs an index for this query. Open the browser console — the error there contains a direct link that creates it.";
  }
  if (code === "unauthenticated") {
    return "Your session expired. Sign out and back in.";
  }
  if (code === "unavailable") {
    return "Couldn't reach Firestore. Check your connection.";
  }
  return `Firestore error${code ? ` (${code})` : ""}: ${err?.message || "unknown"}`;
}

/**
 * ADDED — puts the Reviews link in the sidebar on EVERY admin page.
 *
 * The sidebar is copied by hand into each admin HTML file, so a new
 * page normally means editing ten files. admin-reviews.html existed
 * but was only reachable from admin-users.html, because that is the
 * one file the reviews batch happened to touch.
 *
 * This inserts the link at runtime instead, which every admin page
 * picks up for free because every one of them imports this module.
 * It is idempotent — a page whose HTML already carries the link (that
 * is, admin-users.html and admin-reviews.html) is left alone — so
 * adding the markup to the other files later is safe and this can
 * simply be deleted once that is done.
 *
 * The guard on `.admin-nav` means it does nothing at all on the
 * customer-facing pages, which import this module too.
 */
/* The sidebar is copied by hand into each admin HTML file, so a link
   added to one page is missing from the other nine until someone
   edits them all. That is not hypothetical: admin-products.html was
   the only page without Activity Log, months after it was added, and
   Reviews reached only the two files its own batch happened to touch.

   These are inserted at runtime instead. Every admin page imports this
   module, so they all get them. Idempotent — a page whose HTML already
   carries a link is left alone — so pasting the markup into the files
   later is safe, and this can be deleted once they all have it. */
const NAV_LINKS = [
  {
    href: "admin-reviews.html",
    label: "Reviews",
    icon: 'm12 17.3 6.2 3.7-1.6-7 5.4-4.7-7.1-.6L12 2 9.1 8.7 2 9.3l5.4 4.7-1.6 7z',
    after: 'a[href="admin-users.html"]'   // sits in the main Menu group
  },
  {
    href: "admin-activity.html",
    label: "Activity Log",
    icon: 'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2 4.9l-1.4 1.5A9 9 0 1 0 13 3zm-1 5v5l4 2 .8-1.3-3.3-1.9V8z',
    after: ".admin-nav-label--system"     // first item under the System heading
  }
];

export function ensureAdminNav() {
  const nav = document.querySelector(".admin-nav");
  if (!nav) return; // not an admin page — the customer pages import this too

  for (const { href, label, icon, after } of NAV_LINKS) {
    if (nav.querySelector(`a[href="${href}"]`)) continue; // already in the HTML

    const link = document.createElement("a");
    link.href = href;
    link.className = "admin-nav-link";
    link.innerHTML =
      `<svg class="admin-nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="${icon}"/></svg>${label}`;

    // endsWith, not includes: /admin-activity-export.html should not
    // light up the Activity Log link.
    if (window.location.pathname.endsWith(href)) link.classList.add("active");

    const anchor = nav.querySelector(after);
    if (anchor) anchor.insertAdjacentElement("afterend", link);
    else {
      const systemLabel = nav.querySelector(".admin-nav-label--system");
      systemLabel ? systemLabel.insertAdjacentElement("beforebegin", link) : nav.appendChild(link);
    }
  }
}

/* Run as soon as the sidebar exists, not after sign-in: the nav should
   be complete while the page is still loading its data. */
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureAdminNav, { once: true });
  } else {
    ensureAdminNav();
  }
}

export function renderAdminSidebarProfile(user, { avatarImg, avatarFallback, nameEl }) {
  // Belt and braces: covers a page that renders its sidebar after auth.
  ensureAdminNav();
  if (nameEl) nameEl.textContent = user.displayName || user.email || "Admin";
  if (!avatarImg || !avatarFallback) return;

  if (user.photoURL) {
    avatarImg.referrerPolicy = "no-referrer";
    avatarImg.onerror = () => {
      avatarImg.hidden = true;
      avatarFallback.hidden = false;
      avatarFallback.textContent = (user.displayName || user.email || "?").charAt(0).toUpperCase();
    };
    avatarImg.src = user.photoURL;
    avatarImg.hidden = false;
    avatarFallback.hidden = true;
  } else {
    avatarImg.hidden = true;
    avatarFallback.hidden = false;
    avatarFallback.textContent = (user.displayName || user.email || "?").charAt(0).toUpperCase();
  }
}

/* CHANGED — logging out of the panel now lands on the shared
   login.html rather than a separate admin page. */
export function attachLogoutConfirm(logoutBtn, loginPage = "login.html") {
  if (!logoutBtn) return;

  logoutBtn.addEventListener("click", () => {
    let backdrop = document.getElementById("logout-modal-backdrop");
    let modal = document.getElementById("logout-modal");

    if (!modal) {
      backdrop = document.createElement("div");
      backdrop.className = "admin-modal-backdrop";
      backdrop.id = "logout-modal-backdrop";

      modal = document.createElement("section");
      modal.className = "admin-modal admin-logout-modal";
      modal.id = "logout-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.innerHTML = `
        <div class="admin-logout-icon">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>
        </div>
        <h2>Log Out</h2>
        <p>Are you sure you want to log out of your account?</p>
        <button type="button" class="admin-logout-confirm-btn" id="logout-confirm-btn">Log Out</button>
        <button type="button" class="admin-logout-cancel-btn" id="logout-cancel-btn">Cancel</button>
        <p class="admin-logout-footer">Trailbound Secure Exit</p>
      `;

      document.body.appendChild(backdrop);
      document.body.appendChild(modal);

      const close = () => {
        backdrop.hidden = true;
        modal.hidden = true;
      };
      backdrop.addEventListener("click", close);
      modal.querySelector("#logout-cancel-btn").addEventListener("click", close);
      modal.querySelector("#logout-confirm-btn").addEventListener("click", async () => {
        await signOut(auth);
        window.location.href = loginPage;
      });
    }

    backdrop.hidden = false;
    modal.hidden = false;
  });
}

/* ==========================================================
   NOTIFICATION BELL
   ----------------------------------------------------------
   The bell in the topbar was decoration — a static icon on nine
   pages and a literal "●" character on two others. It now carries
   the one thing an admin genuinely needs pushing at them: a
   customer has written in and nobody has answered yet.

   "Unread" is deliberately NOT stored per-admin. A message counts
   as unread while its status is still "New", which is the same
   state the Support page shows and the same state that clears when
   any admin replies or closes it. So the badge means "needs
   someone", not "I personally haven't looked" — with a team
   sharing one panel, that is the number that matters, and it can
   never drift between two people's browsers.

   Mounted from requireAdmin() rather than from each page, so every
   admin page gets it without ten separate wiring steps.
   ========================================================== */

const BELL_MAX = 8;

export function mountNotificationBell() {
  const button = document.querySelector(".admin-bell-btn");
  // The login and diagnose pages have no topbar. Nothing to do.
  if (!button || button.dataset.bellReady) return null;
  button.dataset.bellReady = "1";

  // Wrap the button so the dropdown can anchor to it without the
  // topbar needing a position of its own.
  const wrap = document.createElement("div");
  wrap.className = "admin-bell";
  button.replaceWith(wrap);
  wrap.appendChild(button);

  const badge = document.createElement("span");
  badge.className = "admin-bell-badge";
  badge.hidden = true;
  button.appendChild(badge);

  const panel = document.createElement("div");
  panel.className = "admin-bell-panel";
  panel.hidden = true;
  wrap.appendChild(panel);

  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");

  const baseTitle = document.title;
  let messages = [];

  const open = () => {
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
  };
  const close = () => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden ? open() : close();
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // Clicking an item hands the id to the Support page, which opens
  // that message on load — see the ?msg= handler in admin-support.js.
  panel.addEventListener("click", (e) => {
    const row = e.target.closest("[data-msg-id]");
    if (row) window.location.href = `admin-support.html?msg=${encodeURIComponent(row.dataset.msgId)}`;
  });

  const render = () => {
    const unread = messages.filter((m) => String(m.status).toLowerCase() === "new");

    badge.textContent = unread.length > 99 ? "99+" : String(unread.length);
    badge.hidden = unread.length === 0;
    button.classList.toggle("has-unread", unread.length > 0);
    button.setAttribute(
      "aria-label",
      unread.length ? `Notifications, ${unread.length} unanswered` : "Notifications"
    );

    // Visible even when the admin is on another browser tab.
    document.title = unread.length ? `(${unread.length}) ${baseTitle}` : baseTitle;

    const items = messages.slice(0, BELL_MAX);

    panel.innerHTML = `
      <div class="admin-bell-head">
        <p>Notifications</p>
        <span>${unread.length ? `${unread.length} unanswered` : "All caught up"}</span>
      </div>
      ${
        items.length
          ? `<div class="admin-bell-list">${items.map(bellRow).join("")}</div>`
          : '<p class="admin-bell-empty">No customer messages yet. New ones land here the moment they are sent.</p>'
      }
      <a class="admin-bell-all" href="admin-support.html">View all messages</a>`;
  };

  render();

  const stop = watchSupportMessages(
    (items) => {
      messages = items;
      render();
    },
    {
      onError: (err) => {
        console.warn("Notification bell offline:", err?.code || err?.message);
        panel.innerHTML =
          '<p class="admin-bell-empty">Messages could not be loaded. Check your Firestore rules.</p>';
      }
    }
  );

  window.addEventListener("beforeunload", () => stop?.());
  return stop;
}

function bellRow(m) {
  const isNew = String(m.status).toLowerCase() === "new";
  const snippet = m.message.length > 90 ? `${m.message.slice(0, 90)}…` : m.message;

  return `<button type="button" class="admin-bell-item${
    isNew ? " is-unread" : ""
  }" data-msg-id="${escapeHtml(m.id)}">
    <span class="admin-bell-dot" aria-hidden="true"></span>
    <span class="admin-bell-item-body">
      <span class="admin-bell-item-top">
        <strong>${escapeHtml(m.name || m.email || "Someone")}</strong>
        <time>${escapeHtml(timeAgo(m.createdAt) || "just now")}</time>
      </span>
      <span class="admin-bell-item-text">${escapeHtml(snippet || "(no message)")}</span>
      <span class="admin-bell-item-meta">#${escapeHtml(m.ref)} · ${escapeHtml(m.status)}</span>
    </span>
  </button>`;
}

/** Tidy up every listener a page opened when it unloads. */
export function collectUnsubscribers() {
  const stops = [];
  window.addEventListener("beforeunload", () => stops.forEach((stop) => stop?.()));
  return (stop) => {
    stops.push(stop);
    return stop;
  };
}