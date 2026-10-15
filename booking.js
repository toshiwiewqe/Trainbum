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
// CHANGED: was `from "firebase/firestore"` (the bundled npm SDK).
// firebase-config.js built its Firestore on a SECOND Firebase app, while
// auth lived on the app in firebase-init.js — so Firestore never saw the
// signed-in user and every authenticated write failed with
// "Missing or insufficient permissions". One app, one SDK now.
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { addBookingToCart } from "./cart-store.js";
// ADDED: Step 03 accommodation — basecamp + partner hotels live in this
// one file, so prices and hotels can be changed without touching here.
import { BASECAMP, HOTELS } from "./accommodations.js";
// ADDED: writes the booking through the shared data layer, which
// stamps `uid` on it. That uid is what links the booking to the
// customer — it's what makes it appear under My Bookings on their
// account page, and what lets the Firestore rules scope it to them.
// Same document shape and same "Pending"/"Unpaid" casing as before.
import { createBooking } from "./trailbound-data.js";
import { fetchHourlyForecast, buildHikerTip, buildAlertMessage } from "./Weather-api.js";
import { auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Require login before anyone can use the booking page. Firebase
// resolves the current auth state asynchronously (even for an
// already-logged-in session), so this fires once, right away.
onAuthStateChanged(auth, (user) => {
  if (!user) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `login.html?redirect=${returnTo}`;
  }
});
/* ---------- TEMPORARY DIAGNOSTICS ----------
   These two blocks exist to show which Firestore fields are
   missing or wrong. Delete both once the trail documents are
   filled in. */

// Logs the full URL of any image that fails to load.
document.addEventListener(
  "error",
  (e) => {
    if (e.target && e.target.tagName === "IMG") {
      console.warn("IMG failed to load →", e.target.src);
    }
  },
  true, // capture phase: <img> error events don't bubble
);

// Prints every trail document as a table, and names the fields
// that are missing from each one.
function auditTrails(list) {
  const expected = ["trail_id", "name", "location", "difficulty", "duration", "image", "guide_ids", "status"];
  console.table(list);
  list.forEach((t) => {
    const missing = expected.filter((f) => t[f] === undefined);
    if (missing.length) {
      console.warn(`Trail "${t.trail_id || t.name || "(unnamed)"}" is missing:`, missing.join(", "));
    }
  });
}

const trailSelect = document.getElementById("trail-select");
const guideSelect = document.getElementById("guide-select");
const guideCardsEl = document.getElementById("guide-cards");
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
const summaryStay = document.getElementById("summary-stay");
const summaryStayLine = document.getElementById("summary-stay-line");
const summaryStayLabel = document.getElementById("summary-stay-label");
const summaryStayCost = document.getElementById("summary-stay-cost");

/* ---------- Accommodation (Step 03) DOM refs ---------- */

const stayOptionsEl = document.getElementById("stay-options");
const stayGoogleEl = document.getElementById("stay-google");
const stayGoogleLink = document.getElementById("stay-google-link");
const stayBasecampEl = document.getElementById("stay-basecamp");
const stayHotelsEl = document.getElementById("stay-hotels");
const stayHotelListEl = document.getElementById("stay-hotel-list");
const stayMapEl = document.getElementById("stay-map");
const stayNightsRow = document.getElementById("stay-nights-row");
const stayNightsSelect = document.getElementById("stay-nights");
const stayCheckinEl = document.getElementById("stay-checkin");

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

// Accommodation choice: "none" (default), "basecamp", or "hotel"
let stayType = "none";
let stayHotelId = null;
let lastStayMapQuery = null;

/* ---------- Helpers ---------- */

function formatPrice(value) {
  const n = Number(value) || 0;
  return `₱${n.toLocaleString("en-PH")}`;
}

/* Must match the identical rule in trail.js — see the comment there for
   why a plain `status !== "Open"` check is wrong (statuses like "Open
   (monolith closed)" are still bookable; only an exact "closed" really
   shuts a trail down). Keeping this in sync with trail.js is what makes
   the "Book" button on trail.html actually work for every open trail. */
function isTrailOpen(trail) {
  if (trail.isOpen !== undefined) return Boolean(trail.isOpen);
  const status = String(trail.status ?? "open").trim();
  return !/^closed$/i.test(status);
}

/* Some trail photos have spaces in the filename (e.g. "galugod baboy.jpg").
   A raw space in a URL is not valid and some servers will 404 on it, so
   escape it. Only spaces are touched, to avoid double-encoding paths that
   are already percent-encoded. */
function resolveImageSrc(path) {
  if (!path) return "";
  return path.includes(" ") ? path.replace(/ /g, "%20") : path;
}

/* Builds the "Hard · Arayat, Pampanga · 8 hours" line. Fields that are
   missing from the document are left out rather than printed as the
   string "undefined". */
function buildMetaLine(trail) {
  return [trail.difficulty, trail.location, trail.duration]
    .filter(Boolean)
    .join(" · ");
}

function getTrailById(id) {
  return trails.find((t) => t.trail_id === id);
}

/* Names and specialties go straight into card HTML, so escape them. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Guide photo: looks for guides/<guide_id>.jpg automatically, so adding
   a photo is just dropping a file named after the guide's ID into the
   guides/ folder — no Firestore editing needed. A `photo` field on the
   guide document, if one exists, wins over the automatic path. If the
   file isn't there, the card shows the guide's initials instead. */
function getGuidePhotoSrc(guide) {
  const fromFirestore = guide.photo || guide.image || guide.photo_url;
  if (fromFirestore) return resolveImageSrc(fromFirestore);
  return guide.guide_id ? `guides/${encodeURIComponent(guide.guide_id)}.jpg` : "";
}

function getInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
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

  auditTrails(trails); // TEMPORARY — see diagnostics block at the top

  populateTrailSelect();
  populatePackageSelectOptions();
  preselectTrailFromURL();
  updateSummaryPanel();

  const today = new Date().toISOString().split("T")[0];
  dateInput.min = today;
}

function populateTrailSelect() {
  const openTrails = trails.filter(isTrailOpen);
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

/* ---------- Guide selection cards ----------
   Same idea as the package cards: the real <select id="guide-select">
   stays in the DOM (visually hidden) and is still what the submit code
   reads. Each card shows the guide's photo, name, specialty and rating;
   clicking one sets guideSelect.value and fires "change". */

function renderGuideCards(availableGuides) {
  if (!guideCardsEl) return;

  guideCardsEl.classList.remove("guide-cards--disabled");

  if (availableGuides.length === 0) {
    guideCardsEl.innerHTML = `<p class="guide-cards-placeholder">No guides available for this trail yet.</p>`;
    return;
  }

  guideCardsEl.innerHTML = availableGuides
    .map((g) => {
      const photo = getGuidePhotoSrc(g);
      const hasRating = g.rating !== undefined && g.rating !== null && g.rating !== "";
      return `
        <button type="button" class="guide-card" data-id="${escapeHtml(g.guide_id)}" aria-pressed="false">
          <span class="guide-card-photo">
            <span class="guide-card-initials" aria-hidden="true">${escapeHtml(getInitials(g.full_name))}</span>
            ${photo ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" />` : ""}
            <span class="guide-card-check" aria-hidden="true"></span>
          </span>
          <span class="guide-card-name">${escapeHtml(g.full_name || "Guide")}</span>
          ${g.specialty ? `<span class="guide-card-specialty">${escapeHtml(g.specialty)}</span>` : ""}
          ${hasRating ? `<span class="guide-card-rating">★ ${escapeHtml(g.rating)}</span>` : ""}
        </button>
      `;
    })
    .join("");

  guideCardsEl.querySelectorAll(".guide-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      guideSelect.value = btn.dataset.id;
      guideSelect.dispatchEvent(new Event("change"));
    });
  });

  // A photo that fails to load is removed, so the initials underneath show.
  guideCardsEl.querySelectorAll(".guide-card-photo img").forEach((img) => {
    img.addEventListener("error", () => img.remove());
  });

  syncGuideCardSelection();
}

function syncGuideCardSelection() {
  if (!guideCardsEl) return;
  guideCardsEl.querySelectorAll(".guide-card").forEach((btn) => {
    const selected = btn.dataset.id === guideSelect.value;
    btn.classList.toggle("guide-card--selected", selected);
    btn.setAttribute("aria-pressed", String(selected));
  });
}

/* ---------- Accommodation (Step 03) ----------
   Three choices: no accommodation (default, free), Trailbound's own
   basecamp (per person / night), or a partner hotel near the trail
   (per room / night). Hotels come from accommodations.js and are
   matched to the trail by area (e.g. every "Benguet" trail). Each
   hotel shows its real address, a "View on Google Maps" link, and the
   picked one is shown on an embedded Google map (free embed, no API
   key — same approach as the checkout shipping map). */

const ICONS = {
  none:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  basecamp:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20 12 5l9 15z"/><path d="M12 20v-6l-3 6M12 14l3 6"/></svg>',
  hotel:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 21v-4h6v4M8 7h2M14 7h2M8 11h2M14 11h2"/></svg>',
  pin:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  external:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

function getGroupSize() {
  return Math.max(1, parseInt(groupSizeInput.value, 10) || 1);
}

function getStayNights() {
  return Math.max(1, parseInt(stayNightsSelect?.value, 10) || 1);
}

function getHotelById(id) {
  return HOTELS.find((h) => h.id === id);
}

// Hotels whose `areas` appear in the trail's location or name, or that
// list this trail in `trail_ids`
function hotelsForTrail(trail) {
  if (!trail) return [];
  const haystack = `${trail.name || ""} ${trail.location || ""}`.toLowerCase();
  return HOTELS.filter(
    (h) =>
      (h.trail_ids || []).includes(trail.trail_id) ||
      (h.areas || []).some((a) => haystack.includes(String(a).toLowerCase())),
  );
}

function roomsNeeded(hotel, groupSize) {
  return Math.max(1, Math.ceil(groupSize / (Number(hotel.sleeps) || 2)));
}

function trailMapsQuery(trail) {
  return [trail.name, trail.location, "Philippines"].filter(Boolean).join(", ");
}

function hotelMapsQuery(hotel) {
  return `${hotel.name}, ${hotel.address}`;
}

// Opens Google Maps (website or app) searching for the place
function mapsSearchUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// Free Google Maps embed for the in-page map
function mapsEmbedUrl(query) {
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=14&output=embed`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/* Everything the price, summary and booking need to know about the stay */
function getStayQuote() {
  const groupSize = getGroupSize();
  const nights = getStayNights();

  if (stayType === "basecamp") {
    const trail = getTrailById(trailSelect.value);
    return {
      type: "basecamp",
      name: BASECAMP.name,
      address: trail ? `Near the ${trail.name} jump-off, ${trail.location || ""}`.trim() : "",
      nights,
      rooms: null,
      cost: (Number(BASECAMP.price_per_person) || 0) * groupSize * nights,
    };
  }

  if (stayType === "hotel") {
    const hotel = getHotelById(stayHotelId);
    if (!hotel) return { type: "hotel", name: null, nights, cost: 0, incomplete: true };
    const rooms = roomsNeeded(hotel, groupSize);
    return {
      type: "hotel",
      id: hotel.id,
      name: hotel.name,
      address: hotel.address,
      nights,
      rooms,
      cost: (Number(hotel.price_per_room) || 0) * rooms * nights,
    };
  }

  return { type: "none", name: null, nights: 0, rooms: null, cost: 0 };
}

/* Check-in is the night before the hike */
function getStayDates(nights) {
  if (!dateInput.value) return null;
  const [y, m, d] = dateInput.value.split("-").map(Number);
  const checkIn = new Date(y, m - 1, d - 1);
  const checkOut = new Date(y, m - 1, d - 1 + nights);
  const iso = (x) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const nice = (x) => x.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { checkIn: iso(checkIn), checkOut: iso(checkOut), label: `${nice(checkIn)} → ${nice(checkOut)}` };
}

function renderStayOptions(trail) {
  if (!stayOptionsEl) return;
  const hotels = hotelsForTrail(trail);

  // Switching to a trail with no partner hotels drops a hotel choice
  if (stayType === "hotel" && hotels.length === 0) stayType = "none";
  if (stayHotelId && !hotels.some((h) => h.id === stayHotelId)) stayHotelId = null;

  const cheapestRoom = hotels.length
    ? Math.min(...hotels.map((h) => Number(h.price_per_room) || 0))
    : 0;

  const options = [
    {
      type: "none",
      title: "No accommodation",
      sub: "I'll arrange my own stay",
      price: "Free",
    },
    {
      type: "basecamp",
      title: BASECAMP.name,
      sub: BASECAMP.tagline || "Our own camp near the trail",
      price: `${formatPrice(BASECAMP.price_per_person)} <small>/ person / night</small>`,
    },
    {
      type: "hotel",
      title: "Nearby hotel",
      sub: hotels.length
        ? `${plural(hotels.length, "partner hotel")} near this trail`
        : "No partner hotels near this trail yet",
      price: hotels.length ? `from ${formatPrice(cheapestRoom)} <small>/ room / night</small>` : "",
      disabled: hotels.length === 0,
    },
  ];

  stayOptionsEl.innerHTML = options
    .map(
      (o) => `
        <label class="stay-option${o.disabled ? " is-disabled" : ""}${o.type === stayType ? " is-selected" : ""}">
          <input type="radio" class="stay-radio" name="stay-type" value="${o.type}"
                 ${o.type === stayType ? "checked" : ""} ${o.disabled ? "disabled" : ""} />
          <span class="stay-option-icon" aria-hidden="true">${ICONS[o.type]}</span>
          <span class="stay-option-title">${escapeHtml(o.title)}</span>
          <span class="stay-option-sub">${escapeHtml(o.sub)}</span>
          ${o.price ? `<span class="stay-option-price">${o.price}</span>` : ""}
        </label>`,
    )
    .join("");

  stayOptionsEl.querySelectorAll('input[name="stay-type"]').forEach((input) => {
    input.addEventListener("change", () => {
      stayType = input.value;
      renderStayDetails();
      updatePrice();
    });
  });

  // "Prefer somewhere else?" → Google Maps search for hotels near the trail
  if (stayGoogleEl && stayGoogleLink && trail) {
    stayGoogleLink.href = mapsSearchUrl(`hotels near ${trailMapsQuery(trail)}`);
    stayGoogleLink.textContent = `Find hotels near ${trail.name} on Google Maps`;
    stayGoogleEl.hidden = false;
  }

  renderStayDetails();
}

function renderHotelList() {
  const trail = getTrailById(trailSelect.value);
  const hotels = hotelsForTrail(trail);
  const groupSize = getGroupSize();

  stayHotelListEl.innerHTML = hotels
    .map((h) => {
      const rooms = roomsNeeded(h, groupSize);
      return `
        <label class="stay-hotel${h.id === stayHotelId ? " is-selected" : ""}">
          <input type="radio" class="stay-radio" name="stay-hotel" value="${escapeHtml(h.id)}"
                 ${h.id === stayHotelId ? "checked" : ""} />
          <span class="stay-hotel-dot" aria-hidden="true"></span>
          <span class="stay-hotel-body">
            <span class="stay-hotel-name">${escapeHtml(h.name)}</span>
            <span class="stay-hotel-address">${ICONS.pin}${escapeHtml(h.address)}</span>
            <span class="stay-hotel-meta">${[h.distance, h.sleeps ? `Sleeps ${h.sleeps} per room` : ""]
              .filter(Boolean)
              .map(escapeHtml)
              .join(" · ")}</span>
            <a class="stay-hotel-map" href="${escapeHtml(mapsSearchUrl(hotelMapsQuery(h)))}"
               target="_blank" rel="noopener">View on Google Maps ${ICONS.external}</a>
          </span>
          <span class="stay-hotel-price">
            ${formatPrice(h.price_per_room)}
            <small>/ room / night</small>
            ${rooms > 1 ? `<small class="stay-hotel-rooms">${rooms} rooms for ${groupSize}</small>` : ""}
          </span>
        </label>`;
    })
    .join("");

  stayHotelListEl.querySelectorAll('input[name="stay-hotel"]').forEach((input) => {
    input.addEventListener("change", () => {
      stayHotelId = input.value;
      syncStaySelection();
      showStayMap();
      updatePrice();
    });
  });
}

function syncStaySelection() {
  stayOptionsEl?.querySelectorAll(".stay-option").forEach((label) => {
    label.classList.toggle("is-selected", label.querySelector("input").checked);
  });
  stayHotelListEl?.querySelectorAll(".stay-hotel").forEach((label) => {
    label.classList.toggle("is-selected", label.querySelector("input").checked);
  });
}

function renderStayBasecamp() {
  const trail = getTrailById(trailSelect.value);
  if (!trail) return;
  stayBasecampEl.innerHTML = `
    <div class="stay-info-head">
      <span class="stay-info-title">${escapeHtml(BASECAMP.name)}</span>
      <span class="stay-info-where">${ICONS.pin}Near the ${escapeHtml(trail.name)} jump-off${
        trail.location ? `, ${escapeHtml(trail.location)}` : ""
      }</span>
    </div>
    <ul class="stay-info-list">
      ${(BASECAMP.includes || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
    <a class="stay-hotel-map" href="${escapeHtml(mapsSearchUrl(trailMapsQuery(trail)))}"
       target="_blank" rel="noopener">View the area on Google Maps ${ICONS.external}</a>`;
}

/* Embedded map of the picked hotel (or the trail area for basecamp) */
function showStayMap() {
  const trail = getTrailById(trailSelect.value);
  const hotel = getHotelById(stayHotelId);
  let query = null;
  if (stayType === "hotel" && hotel) query = hotelMapsQuery(hotel);
  if (stayType === "basecamp" && trail) query = trailMapsQuery(trail);

  if (!query) {
    stayMapEl.hidden = true;
    return;
  }
  stayMapEl.hidden = false;
  if (query === lastStayMapQuery) return; // don't reload the same map
  lastStayMapQuery = query;
  stayMapEl.innerHTML = `
    <iframe src="${escapeHtml(mapsEmbedUrl(query))}" loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
            title="Map of ${escapeHtml(query)}"></iframe>`;
}

function updateStayCheckin() {
  if (!stayCheckinEl) return;
  const dates = getStayDates(getStayNights());
  stayCheckinEl.textContent = dates ? dates.label : "Pick a hike date first";
}

function renderStayDetails() {
  if (!stayOptionsEl) return;
  syncStaySelection();

  stayBasecampEl.hidden = stayType !== "basecamp";
  if (stayType === "basecamp") renderStayBasecamp();

  stayHotelsEl.hidden = stayType !== "hotel";
  if (stayType === "hotel") renderHotelList();

  showStayMap();
  stayNightsRow.hidden = stayType === "none";
  updateStayCheckin();
}

function resetStay() {
  stayType = "none";
  stayHotelId = null;
  lastStayMapQuery = null;
  if (!stayOptionsEl) return;
  stayOptionsEl.innerHTML = `<span class="package-cards-placeholder">Select a trail to see places to stay.</span>`;
  stayGoogleEl.hidden = true;
  stayBasecampEl.hidden = true;
  stayHotelsEl.hidden = true;
  stayHotelListEl.innerHTML = "";
  stayMapEl.hidden = true;
  stayMapEl.innerHTML = "";
  stayNightsRow.hidden = true;
  stayNightsSelect.value = "1";
}

/* ---------- Trail change ---------- */

function handleTrailChange() {
  const trail = getTrailById(trailSelect.value);

  if (!trail) {
    trailInfo.hidden = true;
    resetPackageSelect();
    resetGuideSelect();
    resetStay();
    updatePrice();
    return;
  }

  trailInfo.hidden = false;

  // A missing image leaves the <img> out of the layout entirely rather
  // than showing a broken-image icon with the alt text next to it.
  const imgSrc = resolveImageSrc(trail.image);
  trailInfoImg.hidden = !imgSrc;
  if (imgSrc) {
    trailInfoImg.src = imgSrc;
    trailInfoImg.alt = trail.name || "";
  }

  trailInfoMeta.textContent = buildMetaLine(trail);
  trailInfoDesc.textContent = trail.description || "";

  packageSelect.disabled = false;
  packageSelect.innerHTML = packageSelect.dataset.optionsHtml;
  packageInfo.hidden = true;
  activityGroup.hidden = true;

  if (packageCardsEl) {
    packageCardsEl.classList.remove("package-cards--disabled");
    renderPackageCards();
  }

  // A trail document that's missing its guide list (or has it stored as
  // something other than an array) used to throw here, which killed the
  // rest of this function — including updatePrice() → updateSummaryPanel().
  // Guard it so one incomplete document can't take down the whole page.
  // Reads `guide_ids` (the name auditTrails() expects) and falls back to
  // `guide_id`, so trails saved under either name work.
  const guideIds = Array.isArray(trail.guide_ids)
    ? trail.guide_ids
    : Array.isArray(trail.guide_id)
      ? trail.guide_id
      : [];
  const availableGuides = guideIds
    .map(getGuideById)
    .filter(Boolean)
    .filter((g) => g.status === "Active");

  guideSelect.disabled = false;
  guideSelect.innerHTML =
    availableGuides.length > 0
      ? `<option value="" disabled selected>Select a guide...</option>` +
        availableGuides
          .map(
            (g) =>
              `<option value="${g.guide_id}">${g.full_name} — ${g.specialty} (★${g.rating})</option>`,
          )
          .join("")
      : `<option value="" disabled selected>No guides available for this trail</option>`;

  renderGuideCards(availableGuides);

  // Step 03: stay options depend on where the trail is
  renderStayOptions(trail);

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

  if (guideCardsEl) {
    guideCardsEl.classList.add("guide-cards--disabled");
    guideCardsEl.innerHTML = `<p class="guide-cards-placeholder">Select a trail to see available guides.</p>`;
  }
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
  packageInfoIncludes.textContent = `Includes: ${(pkg.includes || []).join(", ")}`;

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
  const packageTotal = pkg ? (Number(pkg.price_per_pax) || 0) * groupSize : 0;
  // Total = package for the group + accommodation (0 when none)
  const total = packageTotal + getStayQuote().cost;
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

  const imgSrc = resolveImageSrc(trail.image);
  summaryTrailImg.hidden = !imgSrc;
  if (imgSrc) {
    summaryTrailImg.src = imgSrc;
    summaryTrailImg.alt = trail.name || "";
  }

  summaryTrailName.textContent = trail.name || "";
  summaryTrailLocation.textContent = trail.location || "";
  summaryTrailDifficulty.textContent = trail.difficulty || "";
  summaryTrailDifficulty.hidden = !trail.difficulty;

  summaryDate.textContent = dateInput.value ? formatDateForDisplay(dateInput.value).dateLabel : "Not selected yet";
  summaryGroupSize.textContent = `${groupSize} ${groupSize === 1 ? "person" : "people"}`;
  summaryGuide.textContent = guide ? guide.full_name : "Not selected yet";
  summaryPackageName.textContent = pkg ? pkg.name : "Not selected yet";
  summaryIncluded.textContent = pkg ? (pkg.includes || []).join(", ") : "—";

  const perPerson = pkg ? Number(pkg.price_per_pax) || 0 : 0;
  const subtotal = perPerson * groupSize;
  summaryPricePerPerson.textContent = formatPrice(perPerson);
  summarySubtotalLabel.textContent = `Subtotal (${groupSize} × ${formatPrice(perPerson)})`;
  summarySubtotal.textContent = formatPrice(subtotal);

  // Accommodation line
  const stay = getStayQuote();
  if (summaryStay) {
    summaryStay.textContent =
      stay.type === "none"
        ? "No accommodation"
        : stay.incomplete
          ? "Choose a hotel"
          : [stay.name, plural(stay.nights, "night"), stay.rooms ? plural(stay.rooms, "room") : ""]
              .filter(Boolean)
              .join(" · ");
  }
  if (summaryStayLine) {
    summaryStayLine.hidden = stay.cost <= 0;
    summaryStayLabel.textContent = `Accommodation (${plural(stay.nights || 1, "night")})`;
    summaryStayCost.textContent = formatPrice(stay.cost);
  }
}

trailSelect.addEventListener("change", handleTrailChange);
packageSelect.addEventListener("change", handlePackageChange);
guideSelect.addEventListener("change", () => {
  syncGuideCardSelection();
  updateSummaryPanel();
});
// group-size is a <select> now (to match the redesigned UI) instead of a
// number input — "change" is the reliable event for <select> across
// browsers, "input" is kept too since modern browsers fire it as well.
groupSizeInput.addEventListener("input", updatePrice);
groupSizeInput.addEventListener("change", updatePrice);
dateInput.addEventListener("input", updateSummaryPanel);

// Accommodation: group size changes how many hotel rooms are needed,
// nights and the hike date change the check-in dates and the price
function refreshStayForGroup() {
  if (stayType === "hotel") renderHotelList();
  updatePrice();
}
groupSizeInput.addEventListener("change", refreshStayForGroup);
stayNightsSelect?.addEventListener("change", () => {
  updateStayCheckin();
  updatePrice();
});
dateInput.addEventListener("input", updateStayCheckin);
dateInput.addEventListener("change", updateStayCheckin);

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
          <span class="weather-hour-temp">${s.tempC ?? "—"}°C</span>
          <span class="weather-hour-label">${s.label}</span>
          <span class="weather-hour-precip">Precip ${s.precipProbability ?? "—"}%</span>
          <span class="weather-hour-wind">Wind ${s.windKph ?? "—"} km/h</span>
        </div>
      `,
    )
    .join("");
}

function setWeatherLoadingState(dateStr, trail) {
  const { dateLabel, weekdayLabel } = formatDateForDisplay(dateStr);
  weatherModalDate.textContent = dateLabel;
  weatherModalWeekday.textContent = weekdayLabel;
  weatherModalLocation.textContent = trail
    ? [trail.name, trail.location].filter(Boolean).join(" · ")
    : "";

  weatherModalTempBig.textContent = "—°C";
  weatherModalConditionBig.textContent = "Loading...";
  weatherModalIconBig.textContent = "";
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

  const locationForForecast = trail && trail.location ? trail.location : "Manila, Philippines";

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

  const stay = getStayQuote();
  if (stay.incomplete) {
    showFeedback("Please choose a hotel, or pick another accommodation option.", true);
    stayHotelsEl?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const stayDates = stay.type === "none" ? null : getStayDates(stay.nights);

  submitBtn.disabled = true;
  submitBtn.textContent = "Booking...";

  // The "Your details" step was removed from this page: name, phone and
  // emergency contact are collected in the payment section instead.
  // Name and email are pre-filled from the signed-in account so the
  // booking still shows who it belongs to; the other three stay empty
  // here and are filled in at checkout.
  const currentUser = auth.currentUser;

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
    full_name: currentUser?.displayName || "",
    email: currentUser?.email || "",
    contact_number: "",
    emergency_name: "",
    emergency_number: "",
    // Package for the whole group + accommodation (0 when none)
    total_price: (Number(pkg.price_per_pax) || 0) * groupSize + stay.cost,
    status: "Pending",
    payment_status: "Unpaid",
    created_at: new Date().toISOString(),
    // TODO: add `user_id: currentUser.uid` here once Auth is wired up
  };

  try {
    // CHANGED: was addDoc(collection(db, "bookings"), booking).
    // createBooking() writes the same fields plus uid, drops a
    // "Booking received" notification into the customer's account,
    // and logs the booking to the admin dashboard activity feed.
    const newBookingId = await createBooking({
      trailId:   booking.trail_id,
      trailName: booking.trail_name,
      packageId: booking.package_id,
      packageName: booking.package_name,
      activity:  booking.activity,
      guideId:   booking.guide_id,
      guideName: booking.guide_name,
      date:      booking.date,
      groupSize: booking.group_size,
      customerName:    booking.full_name,
      email:           booking.email,
      phone:           booking.contact_number,
      emergencyName:   booking.emergency_name,
      emergencyNumber: booking.emergency_number,
      amount:          booking.total_price
    });

    // ADDED: the accommodation choice, saved on the booking so Admin
    // (and the customer's My Bookings) can see where they're staying.
    // Saved separately so createBooking() itself doesn't need to change;
    // if this extra write is refused, the booking and its total
    // (which already includes the stay) are still fine.
    const accommodation =
      stay.type === "none"
        ? { type: "none" }
        : {
            type: stay.type,                 // "basecamp" | "hotel"
            name: stay.name,
            address: stay.address || null,
            nights: stay.nights,
            rooms: stay.rooms ?? null,
            check_in: stayDates?.checkIn ?? null,
            check_out: stayDates?.checkOut ?? null,
            price: stay.cost,
          };
    try {
      await updateDoc(doc(db, "bookings", newBookingId), { accommodation });
    } catch (stayErr) {
      console.warn("Could not save accommodation details on the booking:", stayErr);
    }

    // Stage this reservation in the cart so it can be paid for at
    // checkout, alongside anything the person adds from the shop.
    // The stay is added to the package name so it shows in the cart
    // and at checkout, e.g. "Basic Trek + Evercrest Golf Club Resort (1 night)".
    addBookingToCart({
      bookingId: newBookingId,
      trailName: trail.name,
      packageName:
        stay.type === "none"
          ? pkg.name
          : `${pkg.name} + ${stay.name} (${plural(stay.nights, "night")})`,
      date: booking.date,
      guideName: guide.full_name,
      groupSize,
      activity: booking.activity,
      price: booking.total_price,
      image: trail.image,
      accommodation,
    });

    form.reset();
    trailInfo.hidden = true;
    resetPackageSelect();
    resetGuideSelect();
    resetStay();
    updatePrice();
    openPostBookingModal(trail.name, booking.date);
  } catch (err) {
    console.error(err);
    showFeedback("Something went wrong saving your booking. Please try again.", true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Confirm booking";
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