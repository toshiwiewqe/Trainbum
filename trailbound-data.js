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
  settings: "settings"
};

export const SETTINGS_DOC_ID = "site";

const trailsRef = () => collection(db, COL.trails);
const guidesRef = () => collection(db, COL.guides);
const packagesRef = () => collection(db, COL.packages);
const ordersRef = () => collection(db, COL.orders);
const contactRef = () => collection(db, COL.contact);
const productsRef = () => collection(db, COL.products);
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

export function normalizeProduct(id, raw = {}) {
  return {
    id,
    name: raw.name || raw.title || "Untitled",
    category: raw.category || "Uncategorized",
    description: raw.description || "",
    price: Number(raw.price ?? raw.amount ?? 0),
    status: String(raw.status || "active").toLowerCase(),
    image: raw.image || raw.imageUrl || raw.photo || "",
    location: raw.location || "",
    difficulty: raw.difficulty || "",
    bookingCount: Number(raw.bookingCount || 0),
    dateAdded: raw.dateAdded ?? raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
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
    _raw: raw
  };
}

/* ---------- gear orders + support ---------- */

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
    subtotal: Number(raw.subtotal || 0),
    shippingFee: Number(raw.shipping_fee || 0),
    total: Number(raw.total || 0),
    status: raw.status || "Pending Payment",
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    _raw: raw
  };
}

export function normalizeMessage(id, raw = {}) {
  return {
    id,
    ref: id.slice(0, 8).toUpperCase(),
    name: raw.name || "",
    email: raw.email || "",
    subject: raw.subject || "other",
    message: raw.message || "",
    uid: raw.user_id || raw.uid || null,
    status: raw.status || "New",
    createdAt: raw.created_at ?? raw.createdAt ?? null,
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
    specialRequests: raw.special_requests || raw.activity || "",
    guideName: raw.guide_name || "",
    departureTime: raw.departure_time || "",
    customerAvatar: raw.customerAvatar || raw.photoURL || "",
    history: Array.isArray(raw.history) ? raw.history : [],
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    _raw: raw
  };
}

export function normalizeUser(id, raw = {}, adminUids = new Set()) {
  return {
    id,
    uid: id,
    displayName: raw.displayName || raw.name || "Unnamed",
    email: raw.email || "",
    phone: raw.phone || "",
    photoURL: raw.photoURL || "",
    role: adminUids.has(id) ? "admin" : String(raw.role || "customer").toLowerCase(),
    disabled: raw.disabled === true,
    shippingAddress: raw.shippingAddress || null,
    billingAddress: raw.billingAddress || null,
    createdAt: raw.createdAt ?? null,
    lastActiveAt: raw.lastActiveAt ?? null,
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
export function requireAdmin(onReady, loginPage = "admin-login.html") {
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
      // Archived gear stays in Firestore but leaves every list.
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

export function watchTrails(callback, { openOnly = false, onError = null } = {}) {
  return watchCollection(
    trailsRef(),
    normalizeTrail,
    (items) => callback(openOnly ? items.filter((t) => t.isOpen) : items),
    { sort: byName, onError }
  );
}

export function watchGuides(callback, { activeOnly = false, onError = null } = {}) {
  return watchCollection(
    guidesRef(),
    normalizeGuide,
    (items) => callback(activeOnly ? items.filter((g) => g.isActive) : items),
    { sort: (a, b) => a.fullName.localeCompare(b.fullName), onError }
  );
}

export function watchPackages(callback, { onError = null } = {}) {
  return watchCollection(packagesRef(), normalizePackage, callback, {
    sort: (a, b) => a.pricePerPax - b.pricePerPax,
    onError
  });
}

/* ---------- gear orders + support inbox (admin) ---------- */

const byNewest = (a, b) =>
  (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0);

export function watchOrders(callback, { uid = null, onError = null } = {}) {
  const ref = uid ? query(ordersRef(), where("uid", "==", uid)) : ordersRef();
  return watchCollection(ref, normalizeOrder, callback, { sort: byNewest, onError });
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

export async function saveProduct(data, id = null, previous = null) {
  const payload = {
    name: String(data.name || "").trim(),
    category: String(data.category || "").trim(),
    description: String(data.description || "").trim(),
    price: Number(data.price) || 0,
    status: String(data.status || "active").toLowerCase(),
    image: String(data.image || "").trim(),
    updatedAt: serverTimestamp()
  };

  if (id) {
    await updateDoc(doc(db, COL.products, id), payload);
    await logAudit({
      action: "update", entity: "product", entityId: id, entityLabel: payload.name,
      changes: diffFields(previous, payload, {
        name: "Name", category: "Category", price: "Price",
        status: "Status", image: "Image", description: "Description"
      })
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

export async function setProductStatus(id, status, label = "") {
  await updateDoc(doc(db, COL.products, id), {
    status: String(status).toLowerCase(),
    updatedAt: serverTimestamp()
  });
  await logAudit({
    action: "status", entity: "product", entityId: id, entityLabel: label,
    summary: `Set product "${label}" to ${String(status).toLowerCase()}`,
    status: String(status).toLowerCase() === "active" ? "completed" : "pending"
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
    updatedAt: serverTimestamp()
  };

  if (docId) {
    await updateDoc(doc(db, COL.guides, docId), payload);
    await logAudit({
      action: "update", entity: "guide", entityId: docId, entityLabel: payload.full_name,
      changes: diffFields(previous, {
        fullName: payload.full_name, specialty: payload.specialty,
        rating: payload.rating, status: payload.status
      }, { fullName: "Name", specialty: "Specialty", rating: "Rating", status: "Status" })
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
    updatedAt: serverTimestamp()
  };

  if (docId) {
    await updateDoc(doc(db, COL.packages, docId), payload);
    await logAudit({
      action: "update", entity: "package", entityId: docId, entityLabel: payload.name,
      changes: diffFields(previous, {
        name: payload.name, pricePerPax: payload.price_per_pax,
        includes: payload.includes, requiresActivityChoice: payload.requires_activity_choice
      }, { name: "Name", pricePerPax: "Price per pax", includes: "Includes",
           requiresActivityChoice: "Activity choice" })
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

export async function updateOrderStatus(order, status, adminUser = null) {
  await updateDoc(doc(db, COL.orders, order.id), {
    status,
    updatedAt: serverTimestamp()
  });

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
}

export async function updateMessageStatus(messageId, status, label = "") {
  await updateDoc(doc(db, COL.contact, messageId), {
    status,
    updatedAt: serverTimestamp()
  });
  await logAudit({
    action: "status", entity: "message", entityId: messageId,
    entityLabel: label || messageId.slice(0, 8).toUpperCase(),
    summary: `Marked support message #${label || messageId.slice(0, 8).toUpperCase()} ${String(status).toLowerCase()}`
  });
}

/** Replying marks the thread handled and, for a signed-in sender,
    drops the reply into their notifications. */
export async function replyToMessage(message, replyText) {
  await updateDoc(doc(db, COL.contact, message.id), {
    status: "Replied",
    reply: replyText,
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

export function renderAdminSidebarProfile(user, { avatarImg, avatarFallback, nameEl }) {
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

export function attachLogoutConfirm(logoutBtn, loginPage = "admin-login.html") {
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

/** Tidy up every listener a page opened when it unloads. */
export function collectUnsubscribers() {
  const stops = [];
  window.addEventListener("beforeunload", () => stops.forEach((stop) => stop?.()));
  return (stop) => {
    stops.push(stop);
    return stop;
  };
}