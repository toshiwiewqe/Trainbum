/* ==========================================================
   Booking & Scheduling Module
   Loads trails, guides, and packages from Firestore.
   Saves each booking as a document in Firestore's "bookings"
   collection, so it's visible to Admin regardless of who's
   browsing.

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
} from "firebase/firestore";
import { addBookingToCart } from "./cart-store.js";
import { fetchHourlyForecast, buildHikerTip, buildAlertMessage } from "./Weather-api.js";

const trailSelect = document.getElementById("trail-select");
const guideSelect = document.getElementById("guide-select");
const packageSelect = document.getElementById("package-select");
const packageCardsEl = document.getElementById("package-cards");
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
const submitBtn = document.getElementById("booking-submit-btn");

const postBookingBackdrop = document.getElementById("post-booking-modal-backdrop");
const postBookingModal = document.getElementById("post-booking-modal");
const postBookingCopy = document.getElementById("post-booking-modal-copy");
const postBookingAddGearBtn = document.getElementById("post-booking-add-gear");
const postBookingCheckoutBtn = document.getElementById("post-booking-checkout");

/* ---------- Booking summary panel DOM refs ---------- */

const summaryEmptyState = document.getElementById("summary-empty-state");
const summaryContent = document.getElementById("summary-content");
const summaryTrailImg = document.getElementById("summary-trail-img");
const summaryTrailName = document.getElementById("summary-trail-name");
const summaryTrailLocation = document.getElementById("summary-trail-location");
const summaryTrailDifficulty = document.getElementById("summary-trail-difficulty");
const summaryDate = document.getElementById("summary-date");
const summaryGroupSize = document.getElementById("summary-group-size");
const summaryGuide = document.getElementById("summary-guide");
const summaryPackageName = document.getElementById("summary-package-name");
const summaryIncluded = document.getElementById("summary-included");
const summaryPricePerPerson = document.getElementById("summary-price-per-person");
const summarySubtotalLabel = document.getElementById("summary-subtotal-label");
const summarySubtotal = document.getElementById("summary-subtotal");

/* ---------- Header show/hide on scroll ----------
   Hides the header while the page is actively being scrolled (either
   direction), and brings it back once scrolling stops for a moment.
   Always visible while at the very top of the page. */

const siteHeaderEl = document.getElementById("site-header");

if (siteHeaderEl) {
  let idleTimer = null;
  const idleDelay = 200; // ms of no scroll activity before the header reappears

  function handleScroll() {
    if (window.scrollY <= 12) {
      siteHeaderEl.classList.remove("site-header--hidden");
    } else {
      siteHeaderEl.classList.add("site-header--hidden");
    }

    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      siteHeaderEl.classList.remove("site-header--hidden");
    }, idleDelay);
  }

  window.addEventListener("scroll", handleScroll, { passive: true });
}

/* ---------- Weather modal DOM refs ---------- */

const weatherModal = document.getElementById("weather-modal");
const weatherModalBackdrop = document.getElementById("weather-modal-backdrop");
const weatherModalClose = document.getElementById("weather-modal-close");
const weatherModalDate = document.getElementById("weather-modal-date");
const weatherModalWeekday = document.getElementById("weather-modal-weekday");
const weatherModalLocation = document.getElementById("weather-modal-location");
const weatherModalIconBig = document.getElementById("weather-modal-icon-big");
const weatherModalTempBig = document.getElementById("weather-modal-temp-big");
const weatherModalConditionBig = document.getElementById("weather-modal-condition-big");
const weatherModalFeelslike = document.getElementById("weather-modal-feelslike");
const weatherModalHumidity = document.getElementById("weather-modal-humidity");
const weatherModalWind = document.getElementById("weather-modal-wind");
const weatherModalAlertText = document.getElementById("weather-modal-alert-text");
const weatherHourlyList = document.getElementById("weather-hourly-list");
const weatherTipText = document.getElementById("weather-tip-text");
const weatherChangeDateBtn = document.getElementById("weather-change-date-btn");
const weatherConfirmBtn = document.getElementById("weather-confirm-btn");

let trails = [];
let guides = [];
let packages = [];
let weatherRequestToken = 0; // guards against out-of-order responses if the user changes date/trail quickly

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
  updateSummaryPanel();

  const today = new Date().toISOString().split("T")[0];
  dateInput.min = today;
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

/* ---------- Package selection cards ----------
   The real <select id="package-select"> stays in the DOM (visually
   hidden) so all of the existing validation/read logic below keeps
   working unchanged. These cards are just a nicer way to set its
   value — clicking a card sets packageSelect.value and dispatches a
   "change" event, which runs the same handlePackageChange() as before. */

function renderPackageCards() {
  if (!packageCardsEl) return;

  if (packages.length === 0) {
    packageCardsEl.innerHTML = `<p class="package-cards-placeholder">No packages available right now.</p>`;
    return;
  }

  packageCardsEl.innerHTML = packages
    .map(
      (p) => `
        <button type="button" class="package-card" data-id="${p.package_id}">
          <span class="package-card-radio" aria-hidden="true"></span>
          <span class="package-card-name">${p.name}</span>
          <span class="package-card-desc">${(p.includes || []).slice(0, 2).join(", ")}</span>
          <span class="package-card-price">${formatPrice(p.price_per_pax)} <small>/ person</small></span>
        </button>
      `,
    )
    .join("");

  packageCardsEl.querySelectorAll(".package-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      packageSelect.value = btn.dataset.id;
      packageSelect.dispatchEvent(new Event("change"));
    });
  });

  syncPackageCardSelection();
}

function syncPackageCardSelection() {
  if (!packageCardsEl) return;
  packageCardsEl.querySelectorAll(".package-card").forEach((btn) => {
    btn.classList.toggle("package-card--selected", btn.dataset.id === packageSelect.value);
  });
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

  if (packageCardsEl) {
    packageCardsEl.classList.remove("package-cards--disabled");
    renderPackageCards();
  }

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

  // Trail (and therefore location) changed — if a date is already picked,
  // refresh the forecast so it still matches the current trail.
  if (dateInput.value) {
    openWeatherModalForCurrentSelection();
  }
}

function resetPackageSelect() {
  packageSelect.disabled = true;
  packageSelect.innerHTML = `<option value="" disabled selected>Select a trail first...</option>`;
  packageInfo.hidden = true;
  activityGroup.hidden = true;

  if (packageCardsEl) {
    packageCardsEl.classList.add("package-cards--disabled");
    packageCardsEl.innerHTML = `<p class="package-cards-placeholder">Select a trail to see available packages.</p>`;
  }
}

function resetGuideSelect() {
  guideSelect.disabled = true;
  guideSelect.innerHTML = `<option value="" disabled selected>Select a trail first...</option>`;
}

/* ---------- Package change ---------- */

function handlePackageChange() {
  const pkg = getPackageById(packageSelect.value);

  syncPackageCardSelection();

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

/* ---------- Price + summary panel ---------- */

function updatePrice() {
  const pkg = getPackageById(packageSelect.value);
  const groupSize = Math.max(1, parseInt(groupSizeInput.value, 10) || 1);
  const total = pkg ? pkg.price_per_pax * groupSize : 0;
  priceTotalEl.textContent = formatPrice(total);
  updateSummaryPanel();
}

function updateSummaryPanel() {
  const trail = getTrailById(trailSelect.value);
  const pkg = getPackageById(packageSelect.value);
  const guide = getGuideById(guideSelect.value);
  const groupSize = Math.max(1, parseInt(groupSizeInput.value, 10) || 1);

  if (!summaryContent || !summaryEmptyState) return;

  if (!trail) {
    summaryContent.hidden = true;
    summaryEmptyState.hidden = false;
    return;
  }

  summaryContent.hidden = false;
  summaryEmptyState.hidden = true;

  summaryTrailImg.src = trail.image;
  summaryTrailImg.alt = trail.name;
  summaryTrailName.textContent = trail.name;
  summaryTrailLocation.textContent = trail.location;
  summaryTrailDifficulty.textContent = trail.difficulty;

  summaryDate.textContent = dateInput.value ? formatDateForDisplay(dateInput.value).dateLabel : "Not selected yet";
  summaryGroupSize.textContent = `${groupSize} ${groupSize === 1 ? "person" : "people"}`;
  summaryGuide.textContent = guide ? guide.full_name : "Not selected yet";
  summaryPackageName.textContent = pkg ? pkg.name : "Not selected yet";
  summaryIncluded.textContent = pkg ? pkg.includes.join(", ") : "—";

  const perPerson = pkg ? pkg.price_per_pax : 0;
  const subtotal = perPerson * groupSize;
  summaryPricePerPerson.textContent = formatPrice(perPerson);
  summarySubtotalLabel.textContent = `Subtotal (${groupSize} × ${formatPrice(perPerson)})`;
  summarySubtotal.textContent = formatPrice(subtotal);
}

trailSelect.addEventListener("change", handleTrailChange);
packageSelect.addEventListener("change", handlePackageChange);
guideSelect.addEventListener("change", updateSummaryPanel);
// group-size is a <select> now (to match the redesigned UI) instead of a
// number input — "change" is the reliable event for <select> across
// browsers, "input" is kept too since modern browsers fire it as well.
groupSizeInput.addEventListener("input", updatePrice);
groupSizeInput.addEventListener("change", updatePrice);
dateInput.addEventListener("input", updateSummaryPanel);

/* ---------- Weather forecast popup ---------- */

function formatDateForDisplay(dateStr) {
  // dateStr is "YYYY-MM-DD" from <input type="date">; parse as local, not UTC.
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dateLabel = dateObj.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const weekdayLabel = dateObj.toLocaleDateString("en-US", { weekday: "long" });
  return { dateLabel, weekdayLabel };
}

function renderWeatherHourlyList(slots, featuredHour) {
  weatherHourlyList.innerHTML = slots
    .map(
      (s) => `
        <div class="weather-hour-card${s.hour === featuredHour ? " weather-hour-card--selected" : ""}">
          <span class="weather-hour-time">${s.timeLabel}</span>
          <span class="weather-hour-icon" aria-hidden="true">${s.icon}</span>
          <span class="weather-hour-temp">${s.tempC ?? "—"}°C</span>
          <span class="weather-hour-label">${s.label}</span>
          <span class="weather-hour-precip">💧 ${s.precipProbability ?? "—"}%</span>
          <span class="weather-hour-wind">🌬️ ${s.windKph ?? "—"} km/h</span>
        </div>
      `,
    )
    .join("");
}

function setWeatherLoadingState(dateStr, trail) {
  const { dateLabel, weekdayLabel } = formatDateForDisplay(dateStr);
  weatherModalDate.textContent = dateLabel;
  weatherModalWeekday.textContent = weekdayLabel;
  weatherModalLocation.textContent = trail ? `${trail.name} · ${trail.location}` : "";

  weatherModalTempBig.textContent = "—°C";
  weatherModalConditionBig.textContent = "Loading...";
  weatherModalIconBig.textContent = "⏳";
  weatherModalFeelslike.textContent = "—°C";
  weatherModalHumidity.textContent = "—%";
  weatherModalWind.textContent = "—";
  weatherModalAlertText.textContent = "Fetching the latest forecast…";
  weatherTipText.textContent = "Checking conditions for your hike…";
  weatherHourlyList.innerHTML = "";
}

async function openWeatherModalForCurrentSelection() {
  const trail = getTrailById(trailSelect.value);
  const dateStr = dateInput.value;

  if (!dateStr) return;

  const thisRequest = ++weatherRequestToken;

  weatherModal.hidden = false;
  document.body.style.overflow = "hidden";
  setWeatherLoadingState(dateStr, trail);

  const locationForForecast = trail ? trail.location : "Manila, Philippines"; // sensible default while no trail is picked yet

  try {
    const { slots, featured, isFallback } = await fetchHourlyForecast(dateStr, locationForForecast);

    // If the user changed date/trail again while this request was in flight, drop this result.
    if (thisRequest !== weatherRequestToken) return;

    weatherModalIconBig.textContent = featured.icon;
    weatherModalTempBig.textContent = `${featured.tempC ?? "—"}°C`;
    weatherModalConditionBig.textContent = featured.label;
    weatherModalFeelslike.textContent = `${featured.feelsLikeC ?? "—"}°C`;
    weatherModalHumidity.textContent = `${featured.humidity ?? "—"}%`;
    weatherModalWind.textContent = `${featured.windKph ?? "—"} km/h`;
    weatherModalAlertText.textContent = buildAlertMessage(slots, isFallback);
    weatherTipText.textContent = buildHikerTip(slots);

    renderWeatherHourlyList(slots, featured.hour);
  } catch (err) {
    if (thisRequest !== weatherRequestToken) return;
    console.error(err);
    weatherModalConditionBig.textContent = "Unavailable";
    weatherModalAlertText.textContent = "Couldn't load the forecast right now. You can still continue with booking.";
    weatherTipText.textContent = "Bring general hiking essentials just in case.";
  }
}

function closeWeatherModal() {
  weatherModal.hidden = true;
  document.body.style.overflow = "";
}

dateInput.addEventListener("change", () => {
  if (dateInput.value) {
    openWeatherModalForCurrentSelection();
  }
});

weatherModalClose.addEventListener("click", closeWeatherModal);
weatherModalBackdrop.addEventListener("click", closeWeatherModal);

weatherChangeDateBtn.addEventListener("click", () => {
  closeWeatherModal();
  if (typeof dateInput.showPicker === "function") {
    dateInput.showPicker();
  } else {
    dateInput.focus();
  }
});

weatherConfirmBtn.addEventListener("click", () => {
  closeWeatherModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !weatherModal.hidden) {
    closeWeatherModal();
  }
});

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

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span aria-hidden="true">🔒</span> Booking...`;

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
    openPostBookingModal(trail.name, booking.date);
  } catch (err) {
    console.error(err);
    showFeedback("Something went wrong saving your booking. Please try again.", true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span aria-hidden="true">🔒</span> Confirm booking`;
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

loadData();