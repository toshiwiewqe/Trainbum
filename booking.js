/* ==========================================================
   Booking & Scheduling Module
   Loads trails, guides, and packages from Firestore.
   Saves each booking as a document in Firestore's "bookings"
   collection, so it's visible to Admin regardless of who's
   browsing. Since Auth isn't wired up yet, "My Bookings" on
   this page tracks which bookings THIS BROWSER made using a
   small local list of IDs — see the TODO comment below for
   exactly what to change once login is ready.

   Once a booking is saved (status: "Pending" = slot reserved,
   not yet paid), it's added to the shared cart as a line item
   via cart-store.js, and a modal offers the person a choice:
   add gear from the shop, or go straight to checkout. Checkout
   is what actually flips the booking to "Confirmed" once
   payment goes through — see checkout.js.
   ========================================================== */

import { db } from "./firebase-config.js";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
} from "firebase/firestore";
import {
  addBookingToCart,
  removeBookingByBookingId,
  updateCartBadge,
  onCartUpdated,
} from "./cart-store.js";

const MY_BOOKING_IDS_KEY = "trailbound_my_booking_ids";

const trailSelect = document.getElementById("trail-select");
const guideSelect = document.getElementById("guide-select");
const packageSelect = document.getElementById("package-select");
const activityGroup = document.getElementById("activity-group");
const activitySelect = document.getElementById("activity-select");

const trailInfo = document.getElementById("trail-info");
const trailInfoImg = document.getElementById("trail-info-img");
const trailInfoMeta = document.getElementById("trail-info-meta");
const trailInfoDesc = document.getElementById("trail-info-desc");

const packageInfo = document.getElementById("package-info");
const packageInfoPrice = document.getElementById("package-info-price");
const packageInfoIncludes = document.getElementById("package-info-includes");

const dateInput = document.getElementById("booking-date");
const groupSizeInput = document.getElementById("group-size");
const priceTotalEl = document.getElementById("price-total");
const form = document.getElementById("booking-form");
const feedbackEl = document.getElementById("booking-feedback");
const bookingsListEl = document.getElementById("bookings-list");
const cartCountEl = document.getElementById("cart-count");

const postBookingBackdrop = document.getElementById("post-booking-modal-backdrop");
const postBookingModal = document.getElementById("post-booking-modal");
const postBookingCopy = document.getElementById("post-booking-modal-copy");
const postBookingAddGearBtn = document.getElementById("post-booking-add-gear");
const postBookingCheckoutBtn = document.getElementById("post-booking-checkout");

let trails = [];
let guides = [];
let packages = [];

/* ---------- Helpers ---------- */

function formatPrice(value) {
  return `₱${value.toLocaleString("en-PH")}`;
}

function getTrailById(id) {
  return trails.find((t) => t.trail_id === id);
}

function getGuideById(id) {
  return guides.find((g) => g.guide_id === id);
}

function getPackageById(id) {
  return packages.find((p) => p.package_id === id);
}

// TODO (after Auth is added): replace this whole "my booking ids in
// localStorage" approach with a Firestore query like:
//   query(collection(db, "bookings"), where("user_id", "==", currentUser.uid))
// That will show a user's real bookings on any device they log into,
// instead of only the browser they booked from.
function getMyBookingIds() {
  try {
    return JSON.parse(localStorage.getItem(MY_BOOKING_IDS_KEY)) || [];
  } catch {
    return [];
  }
}

function addMyBookingId(id) {
  const ids = getMyBookingIds();
  ids.unshift(id);
  localStorage.setItem(MY_BOOKING_IDS_KEY, JSON.stringify(ids));
}

/* ---------- Load data from Firestore ---------- */

async function loadData() {
  const [trailsSnap, guidesSnap, packagesSnap] = await Promise.all([
    getDocs(collection(db, "trails")),
    getDocs(collection(db, "guides")),
    getDocs(collection(db, "packages")),
  ]);

  trails = trailsSnap.docs.map((d) => d.data());
  guides = guidesSnap.docs.map((d) => d.data());
  packages = packagesSnap.docs.map((d) => d.data());

  populateTrailSelect();
  populatePackageSelectOptions();
  preselectTrailFromURL();
  renderBookings();

  const today = new Date().toISOString().split("T")[0];
  dateInput.min = today;

  updateCartBadge(cartCountEl);
  onCartUpdated(() => updateCartBadge(cartCountEl));
}

function populateTrailSelect() {
  const openTrails = trails.filter((t) => t.status === "Open");
  trailSelect.innerHTML =
    `<option value="" disabled selected>Select a trail...</option>` +
    openTrails
      .map((t) => `<option value="${t.trail_id}">${t.name}</option>`)
      .join("");
}

// Package list doesn't depend on which trail was picked, but we keep
// it disabled until a trail is chosen so the form fills out top-to-bottom.
function populatePackageSelectOptions() {
  packageSelect.dataset.optionsHtml =
    `<option value="" disabled selected>Select a package...</option>` +
    packages
      .map(
        (p) =>
          `<option value="${p.package_id}">${p.name} — ${formatPrice(p.price_per_pax)}/pax</option>`,
      )
      .join("");
}

function preselectTrailFromURL() {
  const params = new URLSearchParams(window.location.search);
  const trailId = params.get("trail");
  if (trailId && getTrailById(trailId)) {
    trailSelect.value = trailId;
    handleTrailChange();
  }
}

/* ---------- Trail change ---------- */

function handleTrailChange() {
  const trail = getTrailById(trailSelect.value);

  if (!trail) {
    trailInfo.hidden = true;
    resetPackageSelect();
    resetGuideSelect();
    updatePrice();
    return;
  }

  trailInfo.hidden = false;
  trailInfoImg.src = trail.image;
  trailInfoImg.alt = trail.name;
  trailInfoMeta.textContent = `${trail.difficulty} · ${trail.location} · ${trail.duration}`;
  trailInfoDesc.textContent = trail.description;

  packageSelect.disabled = false;
  packageSelect.innerHTML = packageSelect.dataset.optionsHtml;
  packageInfo.hidden = true;
  activityGroup.hidden = true;

  const availableGuides = trail.guide_ids
    .map(getGuideById)
    .filter(Boolean)
    .filter((g) => g.status === "Active");

  guideSelect.disabled = false;
  guideSelect.innerHTML =
    `<option value="" disabled selected>Select a guide...</option>` +
    availableGuides
      .map(
        (g) =>
          `<option value="${g.guide_id}">${g.full_name} — ${g.specialty} (★${g.rating})</option>`,
      )
      .join("");

  updatePrice();
}

function resetPackageSelect() {
  packageSelect.disabled = true;
  packageSelect.innerHTML = `<option value="" disabled selected>Select a trail first...</option>`;
  packageInfo.hidden = true;
  activityGroup.hidden = true;
}

function resetGuideSelect() {
  guideSelect.disabled = true;
  guideSelect.innerHTML = `<option value="" disabled selected>Select a trail first...</option>`;
}

/* ---------- Package change ---------- */

function handlePackageChange() {
  const pkg = getPackageById(packageSelect.value);

  if (!pkg) {
    packageInfo.hidden = true;
    activityGroup.hidden = true;
    updatePrice();
    return;
  }

  packageInfo.hidden = false;
  packageInfoPrice.textContent = `${formatPrice(pkg.price_per_pax)} per person`;
  packageInfoIncludes.textContent = `Includes: ${pkg.includes.join(", ")}`;

  activityGroup.hidden = !pkg.requires_activity_choice;
  activitySelect.required = pkg.requires_activity_choice;
  if (!pkg.requires_activity_choice) {
    activitySelect.value = "";
  }

  updatePrice();
}

/* ---------- Price ---------- */

function updatePrice() {
  const pkg = getPackageById(packageSelect.value);
  const groupSize = Math.max(1, parseInt(groupSizeInput.value, 10) || 1);
  const total = pkg ? pkg.price_per_pax * groupSize : 0;
  priceTotalEl.textContent = formatPrice(total);
}

trailSelect.addEventListener("change", handleTrailChange);
packageSelect.addEventListener("change", handlePackageChange);
groupSizeInput.addEventListener("input", updatePrice);

/* ---------- Submit booking ---------- */

function showFeedback(message, isError = false) {
  feedbackEl.textContent = message;
  feedbackEl.hidden = false;
  feedbackEl.classList.toggle("booking-feedback--error", isError);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const trail = getTrailById(trailSelect.value);
  const pkg = getPackageById(packageSelect.value);
  const guide = getGuideById(guideSelect.value);
  const groupSize = Math.max(1, parseInt(groupSizeInput.value, 10) || 1);

  if (!trail || !pkg || !guide) {
    showFeedback("Please select a trail, package, and guide.", true);
    return;
  }
  if (!dateInput.value) {
    showFeedback("Please choose a hike date.", true);
    return;
  }
  if (pkg.requires_activity_choice && !activitySelect.value) {
    showFeedback("Please choose an activity for this package.", true);
    return;
  }

  const submitBtn = form.querySelector(".booking-submit-btn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Booking...";

  const booking = {
    trail_id: trail.trail_id,
    trail_name: trail.name,
    package_id: pkg.package_id,
    package_name: pkg.name,
    activity: pkg.requires_activity_choice ? activitySelect.value : null,
    guide_id: guide.guide_id,
    guide_name: guide.full_name,
    date: dateInput.value,
    group_size: groupSize,
    full_name: document.getElementById("full-name").value.trim(),
    email: document.getElementById("email").value.trim(),
    contact_number: document.getElementById("contact-number").value.trim(),
    emergency_name: document.getElementById("emergency-name").value.trim(),
    emergency_number: document.getElementById("emergency-number").value.trim(),
    total_price: pkg.price_per_pax * groupSize,
    status: "Pending",
    payment_status: "Unpaid",
    created_at: new Date().toISOString(),
    // TODO: add `user_id: currentUser.uid` here once Auth is wired up
  };

  try {
    const docRef = await addDoc(collection(db, "bookings"), booking);
    addMyBookingId(docRef.id);

    // Stage this reservation in the cart so it can be paid for at
    // checkout, alongside anything the person adds from the shop.
    addBookingToCart({
      bookingId: docRef.id,
      trailName: trail.name,
      packageName: pkg.name,
      date: booking.date,
      guideName: guide.full_name,
      groupSize,
      activity: booking.activity,
      price: booking.total_price,
      image: trail.image,
    });

    form.reset();
    trailInfo.hidden = true;
    resetPackageSelect();
    resetGuideSelect();
    updatePrice();
    renderBookings();
    openPostBookingModal(trail.name, booking.date);
  } catch (err) {
    console.error(err);
    showFeedback("Something went wrong saving your booking. Please try again.", true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Confirm Booking";
  }
});

/* ---------- Post-booking modal: add gear or check out ---------- */

function openPostBookingModal(trailName, date) {
  postBookingCopy.textContent =
    `Your spot on ${trailName} for ${date} is reserved and waiting in your cart. ` +
    `Add trail gear now, or head straight to checkout to confirm it with payment.`;
  postBookingBackdrop.hidden = false;
  postBookingModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closePostBookingModal() {
  postBookingBackdrop.hidden = true;
  postBookingModal.hidden = true;
  document.body.style.overflow = "";
}

if (postBookingBackdrop) postBookingBackdrop.addEventListener("click", closePostBookingModal);
if (postBookingAddGearBtn) {
  postBookingAddGearBtn.addEventListener("click", () => {
    window.location.href = "products.html";
  });
}
if (postBookingCheckoutBtn) {
  postBookingCheckoutBtn.addEventListener("click", () => {
    window.location.href = "checkout.html";
  });
}

/* ---------- Booking history (My Bookings) ---------- */

async function renderBookings() {
  const myIds = getMyBookingIds();

  if (myIds.length === 0) {
    bookingsListEl.innerHTML = `<p class="bookings-empty">You have no bookings yet.</p>`;
    return;
  }

  const snapshot = await getDocs(collection(db, "bookings"));
  const allBookings = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  const myBookings = myIds
    .map((id) => allBookings.find((b) => b.id === id))
    .filter(Boolean);

  if (myBookings.length === 0) {
    bookingsListEl.innerHTML = `<p class="bookings-empty">You have no bookings yet.</p>`;
    return;
  }

  bookingsListEl.innerHTML = myBookings
    .map(
      (b) => `
        <div class="booking-item" data-id="${b.id}">
          <div class="booking-item-main">
            <h5>${b.trail_name} — ${b.package_name}</h5>
            <p>${b.date} · ${b.group_size} pax · Guide: ${b.guide_name}${b.activity ? ` · ${b.activity}` : ""}</p>
            <span class="booking-status booking-status--${b.status.toLowerCase()}">${b.status}</span>
          </div>
          <div class="booking-item-side">
            <span class="booking-item-price">${formatPrice(b.total_price)}</span>
            ${
              b.status !== "Cancelled"
                ? `<button type="button" class="booking-cancel-btn" data-id="${b.id}">Cancel</button>`
                : ""
            }
          </div>
        </div>
      `,
    )
    .join("");

  bookingsListEl.querySelectorAll(".booking-cancel-btn").forEach((btn) => {
    btn.addEventListener("click", () => cancelBooking(btn.dataset.id));
  });
}

async function cancelBooking(bookingId) {
  await updateDoc(doc(db, "bookings", bookingId), { status: "Cancelled" });
  // If it's still sitting unpaid in the cart, take it out too.
  removeBookingByBookingId(bookingId);
  renderBookings();
}

loadData();