/* ==========================================================
   Booking & Scheduling Module
   Loads trails, guides, and packages from Firestore.
   Saves each booking as a document in Firestore's "bookings"
   collection, so it's visible to Admin regardless of who's
   browsing.

   Once a booking is saved (status: "Pending" = slot reserved,
   not yet paid), it's added to the shared cart as a line item
   via cart-store.js, and a modal offers the person a choice:
   add Products from the shop, or go straight to checkout. Checkout
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
// ADDED: start times per trail, and the "is this guide packed?" check.
// Both live in their own files so this one only has to render them.
import { getTimeSlots, formatSlot, slotNote } from "./trail-time-slots.js";
import {
  loadGuideDayCounts,
  isGuideFree,
  slotsLeftLabel,
  bumpGuideDay,
} from "./guide-availability.js";
// ADDED (Pass 3): Step 04, the per-climber cards. All the DOM work
// lives in that file; this one calls five functions.
import {
  initClimbers,
  syncClimberCards,
  filledCardsBeyond,
  validateClimbers,
  readClimbers,
  resetClimbers,
  fillFirstFromUser,
} from "./booking-climbers.js";
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

/* ---------- Start time (Step 02) DOM refs ---------- */
const timeSelect = document.getElementById("departure-time");
const timeSlotsEl = document.getElementById("time-slots");
const priceTotalEl = document.getElementById("price-total");
const form = document.getElementById("booking-form");
const feedbackEl = document.getElementById("booking-feedback");
const submitBtn = document.getElementById("booking-submit-btn");

const postBookingBackdrop = document.getElementById("post-booking-modal-backdrop");
const postBookingModal = document.getElementById("post-booking-modal");
const postBookingCopy = document.getElementById("post-booking-modal-copy");
const postBookingAddProductsBtn = document.getElementById("post-booking-add-Products");
const postBookingCheckoutBtn = document.getElementById("post-booking-checkout");

/* ---------- Booking summary panel DOM refs ---------- */

const summaryEmptyState = document.getElementById("summary-empty-state");
const summaryContent = document.getElementById("summary-content");
const summaryTrailImg = document.getElementById("summary-trail-img");
const summaryTrailName = document.getElementById("summary-trail-name");
const summaryTrailLocation = document.getElementById("summary-trail-location");
const summaryTrailDifficulty = document.getElementById("summary-trail-difficulty");
const summaryDate = document.getElementById("summary-date");
const summaryTime = document.getElementById("summary-time");
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
const stayDetailEl = document.getElementById("stay-detail");
const stayMapEl = document.getElementById("stay-map");
const stayNightsRow = document.getElementById("stay-nights-row");
const stayNightsSelect = document.getElementById("stay-nights");
const stayDatesEl = document.getElementById("stay-dates");
const stayIncludedBanner = document.getElementById("stay-included-banner");

/* ---------- Trail search (Step 01) DOM refs ---------- */

const trailSearchWrap = document.getElementById("trail-search");
const trailSearchInput = document.getElementById("trail-search-input");
const trailSearchList = document.getElementById("trail-search-list");

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

// ADDED: how many groups each guide already has on the chosen date.
// Refilled by refreshGuideAvailability() whenever the date changes;
// empty means "nothing booked", which is also the fail-open state.
let guideDayCounts = new Map();
let availabilityToken = 0; // drops an out-of-order response if the date changes fast

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
  initTrailSearch();
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

/* ---------- Trail search (Step 01) ----------
   A type-to-search box in front of the real <select id="trail-select">,
   which stays in the page and is still what every other handler reads.
   Picking a result sets trailSelect.value and fires "change", so
   handleTrailChange() runs exactly as it did with the plain dropdown.

   Matching is on name AND location, because people look for "Benguet"
   as often as "Pulag". */

let searchResults = [];   // trails currently listed
let searchActive = -1;    // which one the arrow keys are on

function openTrails() {
  return trails.filter(isTrailOpen);
}

// Wraps the typed letters in <mark> so it's clear why a result matched
function highlight(text, query) {
  const safe = escapeHtml(text);
  if (!query) return safe;
  const i = safe.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return safe;
  return (
    safe.slice(0, i) + `<mark>` + safe.slice(i, i + query.length) + `</mark>` + safe.slice(i + query.length)
  );
}

function matchTrails(query) {
  const q = query.trim().toLowerCase();
  const list = openTrails();
  if (!q) return list;
  return list.filter((t) =>
    `${t.name || ""} ${t.location || ""} ${t.difficulty || ""}`.toLowerCase().includes(q),
  );
}

function renderSearchList(query) {
  if (!trailSearchList) return;
  searchResults = matchTrails(query);
  searchActive = -1;

  if (searchResults.length === 0) {
    trailSearchList.innerHTML = `<li class="trail-search-empty">No trails match “${escapeHtml(query)}”.</li>`;
  } else {
    trailSearchList.innerHTML = searchResults
      .map((t, i) => {
        const meta = [t.location, t.difficulty, t.duration].filter(Boolean).join(" · ");
        return `
          <li class="trail-search-option" role="option" id="trail-opt-${i}"
              aria-selected="${t.trail_id === trailSelect.value}" data-id="${escapeHtml(t.trail_id)}">
            <span class="trail-search-name">${highlight(t.name || "", query)}</span>
            ${meta ? `<span class="trail-search-meta">${highlight(meta, query)}</span>` : ""}
          </li>`;
      })
      .join("");
  }

  trailSearchList.querySelectorAll("[data-id]").forEach((li) => {
    // mousedown, not click: it fires before the input's blur, which
    // would otherwise close the list out from under the pointer
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      chooseTrail(li.dataset.id);
    });
  });
}

function openSearchList(query = "") {
  if (!trailSearchList) return;
  renderSearchList(query);
  trailSearchList.hidden = false;
  trailSearchInput.setAttribute("aria-expanded", "true");
}

function closeSearchList() {
  if (!trailSearchList) return;
  trailSearchList.hidden = true;
  trailSearchInput.setAttribute("aria-expanded", "false");
  trailSearchInput.removeAttribute("aria-activedescendant");
  searchActive = -1;
}

function setSearchActive(index) {
  const items = [...trailSearchList.querySelectorAll("[data-id]")];
  if (items.length === 0) return;
  searchActive = (index + items.length) % items.length;
  items.forEach((el, i) => el.classList.toggle("is-active", i === searchActive));
  items[searchActive].scrollIntoView({ block: "nearest" });
  trailSearchInput.setAttribute("aria-activedescendant", items[searchActive].id);
}

function chooseTrail(trailId) {
  const trail = getTrailById(trailId);
  if (!trail) return;
  trailSelect.value = trailId;
  trailSearchInput.value = trail.name || "";
  closeSearchList();
  trailSelect.dispatchEvent(new Event("change"));
}

function initTrailSearch() {
  if (!trailSearchInput) return;

  trailSearchInput.addEventListener("input", () => openSearchList(trailSearchInput.value));
  trailSearchInput.addEventListener("focus", () => {
    trailSearchInput.select(); // typing replaces the chosen trail
    openSearchList(trailSearchInput.value);
  });

  trailSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (trailSearchList.hidden) return openSearchList(trailSearchInput.value);
      setSearchActive(searchActive + (e.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (e.key === "Enter") {
      // Only swallow Enter when a result is highlighted, so Enter
      // can still submit the form the rest of the time
      if (!trailSearchList.hidden && searchActive >= 0) {
        e.preventDefault();
        chooseTrail(searchResults[searchActive]?.trail_id);
      }
      return;
    }
    if (e.key === "Escape") closeSearchList();
  });

  // Delay so a mousedown on a result still registers
  trailSearchInput.addEventListener("blur", () => setTimeout(closeSearchList, 120));

  document.addEventListener("click", (e) => {
    if (!trailSearchWrap.contains(e.target)) closeSearchList();
  });
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
    // Keep the search box showing the trail that arrived in the URL
    if (trailSearchInput) trailSearchInput.value = getTrailById(trailId).name || "";
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

  // ADDED: a guide who already has their maximum for the chosen date
  // is shown, but can't be picked. Hiding them instead would make the
  // list change length as the date moves, which reads like a bug.
  const dateChosen = Boolean(dateInput.value);

  guideCardsEl.innerHTML = availableGuides
    .map((g) => {
      const photo = getGuidePhotoSrc(g);
      const hasRating = g.rating !== undefined && g.rating !== null && g.rating !== "";
      const free = !dateChosen || isGuideFree(g, guideDayCounts);
      const availability = dateChosen ? slotsLeftLabel(g, guideDayCounts) : "";
      return `
        <button type="button" class="guide-card${free ? "" : " guide-card--full"}"
                data-id="${escapeHtml(g.guide_id)}" aria-pressed="false"
                ${free ? "" : "disabled aria-disabled=\"true\""}>
          <span class="guide-card-photo">
            <span class="guide-card-initials" aria-hidden="true">${escapeHtml(getInitials(g.full_name))}</span>
            ${photo ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" />` : ""}
            <span class="guide-card-check" aria-hidden="true"></span>
          </span>
          <span class="guide-card-name">${escapeHtml(g.full_name || "Guide")}</span>
          ${g.specialty ? `<span class="guide-card-specialty">${escapeHtml(g.specialty)}</span>` : ""}
          ${hasRating ? `<span class="guide-card-rating">★ ${escapeHtml(g.rating)}</span>` : ""}
          ${
            availability
              ? `<span class="guide-card-availability${free ? "" : " guide-card-availability--full"}">${escapeHtml(availability)}</span>`
              : ""
          }
        </button>
      `;
    })
    .join("");

  guideCardsEl.querySelectorAll(".guide-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
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

/* ---------- Guide availability ----------
   Which guides this trail offers, regardless of the date. Pulled out
   of handleTrailChange() so the date handler can rebuild the same
   list without repeating the field-name juggling. */
function guidesForCurrentTrail() {
  const trail = getTrailById(trailSelect.value);
  if (!trail) return [];

  // Reads `guide_ids` and falls back to `guide_id` — both spellings
  // exist in this database (see normalizeTrail in trailbound-data.js).
  const guideIds = Array.isArray(trail.guide_ids)
    ? trail.guide_ids
    : Array.isArray(trail.guide_id)
      ? trail.guide_id
      : [];

  return guideIds
    .map(getGuideById)
    .filter(Boolean)
    .filter((g) => g.status === "Active");
}

/* Reloads the day counts and repaints the guide cards. Called
   whenever the date changes — a guide who's free on the 20th may be
   packed on the 21st, so the cards can't be drawn once and left. */
async function refreshGuideAvailability() {
  const date = dateInput.value;
  const myToken = ++availabilityToken;

  guideDayCounts = date ? await loadGuideDayCounts(date) : new Map();

  // The date changed again while that read was in flight — this
  // result is already stale, so drop it rather than repaint with it.
  if (myToken !== availabilityToken) return;

  const availableGuides = guidesForCurrentTrail();
  if (availableGuides.length) renderGuideCards(availableGuides);

  // If the guide they'd already picked is now full, clear the choice
  // rather than letting them reach Confirm and be refused there.
  const chosen = getGuideById(guideSelect.value);
  if (date && chosen && !isGuideFree(chosen, guideDayCounts)) {
    guideSelect.value = "";
    syncGuideCardSelection();
    updateSummaryPanel();
    showFeedback(
      `${chosen.full_name} is fully booked on that date. Please pick another guide.`,
      true,
    );
  }
}

/* ---------- Start time (Step 02) ----------
   Same hidden-<select>-plus-buttons pattern as the package and guide
   cards: #departure-time stays in the DOM and is what the submit code
   reads, the buttons just set its value. */

function renderTimeSlots(trail) {
  if (!timeSlotsEl || !timeSelect) return;

  if (!trail) {
    resetTimeSlots();
    return;
  }

  /* Which list to show depends on the PACKAGE, not just the trail:
     an overnight hike doesn't leave at 4 AM, it treks in after lunch
     and summits at dawn the next day. packageIncludesStay() is the
     same test Step 03 already uses to give the free basecamp night,
     so the two steps can never disagree about what "overnight" means. */
  const overnight = packageIncludesStay(currentPackage());
  const slots = getTimeSlots(trail, { overnight });

  // Keep their choice when it's still on offer — switching package
  // shouldn't silently wipe a time that's still valid.
  const previous = timeSelect.value;
  const keep = slots.includes(previous) ? previous : "";

  timeSelect.disabled = false;
  timeSelect.innerHTML =
    `<option value="" disabled ${keep ? "" : "selected"}>Select a start time...</option>` +
    slots.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(formatSlot(s))}</option>`).join("");
  timeSelect.value = keep;

  timeSlotsEl.classList.remove("time-slots--disabled");
  timeSlotsEl.innerHTML = slots
    .map(
      (s) => `
        <button type="button" class="time-slot" role="radio" aria-checked="false" data-time="${escapeHtml(s)}">
          <span class="time-slot-time">${escapeHtml(formatSlot(s))}</span>
          <span class="time-slot-note">${escapeHtml(slotNote(s, { overnight }))}</span>
        </button>`,
    )
    .join("");

  timeSlotsEl.querySelectorAll("[data-time]").forEach((btn) => {
    btn.addEventListener("click", () => {
      timeSelect.value = btn.dataset.time;
      syncTimeSlotSelection();
      updateSummaryPanel();
    });
  });

  syncTimeSlotSelection();
}

function syncTimeSlotSelection() {
  if (!timeSlotsEl) return;
  timeSlotsEl.querySelectorAll("[data-time]").forEach((btn) => {
    const selected = btn.dataset.time === timeSelect.value;
    btn.classList.toggle("time-slot--selected", selected);
    btn.setAttribute("aria-checked", String(selected));
  });
}

function resetTimeSlots() {
  if (!timeSelect || !timeSlotsEl) return;
  timeSelect.disabled = true;
  timeSelect.innerHTML = `<option value="" disabled selected>Select a trail first...</option>`;
  timeSlotsEl.classList.add("time-slots--disabled");
  timeSlotsEl.innerHTML = `<p class="time-slots-placeholder">Select a trail to see start times.</p>`;
}

/* ---------- Accommodation (Step 03) ----------
   Three choices, shown as one stacked list so the prices line up
   and can actually be compared: Trailbound's own basecamp (priced
   per person, per night), a partner hotel near the trail (per room,
   per night), or nothing at all.

   WHAT EACH ROW SHOWS: the big number is what this booking would
   cost at the current group size and nights — not the unit rate.
   Comparing "₱650 / person" against "₱1,500 / room" is what made
   this step hard to read; the unit rate is still there, small,
   underneath.

   FREE NIGHT: a package that covers accommodation (Overnight Hike)
   preselects the basecamp at ₱0 and marks it "Included". Extra
   nights beyond the first are charged normally. Switching to a
   hotel charges that hotel's usual rate — the included night isn't
   refunded or credited.

   Hotels come from accommodations.js and are matched to a trail by
   area or by an explicit trail_ids list. The picked place is shown
   on an embedded Google map (free embed, no API key).
   ========================================================== */

const ICONS = {
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

/* Does the chosen package already cover a night?
   A boolean `includes_accommodation` on the package document wins.
   Without one, the package's own name and `includes` text is read —
   so "Overnight Hike" with "1-Night Accommodation" works today with
   nothing added in Firestore. */
function packageIncludesStay(pkg) {
  if (!pkg) return false;
  if (typeof pkg.includes_accommodation === "boolean") return pkg.includes_accommodation;
  const text = `${pkg.name || ""} ${(pkg.includes || []).join(" ")}`.toLowerCase();
  return /overnight|accommodation|\bnight\b/.test(text);
}

function currentPackage() {
  return getPackageById(packageSelect.value);
}

// Nights the package covers for free (currently always 1 when it covers any)
function freeNights() {
  return packageIncludesStay(currentPackage()) ? 1 : 0;
}

function trailMapsQuery(trail) {
  return [trail.name, trail.location, "Philippines"].filter(Boolean).join(", ");
}

function hotelMapsQuery(hotel) {
  return `${hotel.name}, ${hotel.address}`;
}

function mapsSearchUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function mapsEmbedUrl(query) {
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=14&output=embed`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/* Cost of a basecamp stay, with any package-included nights free */
function basecampCost(groupSize, nights) {
  const billable = Math.max(0, nights - freeNights());
  return (Number(BASECAMP.price_per_person) || 0) * groupSize * billable;
}

function hotelCost(hotel, groupSize, nights) {
  return (Number(hotel.price_per_room) || 0) * roomsNeeded(hotel, groupSize) * nights;
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
      included: freeNights() > 0,
      cost: basecampCost(groupSize, nights),
    };
  }

  if (stayType === "hotel") {
    const hotel = getHotelById(stayHotelId);
    if (!hotel) return { type: "hotel", name: null, nights, cost: 0, incomplete: true };
    return {
      type: "hotel",
      id: hotel.id,
      name: hotel.name,
      address: hotel.address,
      nights,
      rooms: roomsNeeded(hotel, groupSize),
      included: false,
      cost: hotelCost(hotel, groupSize, nights),
    };
  }

  return { type: "none", name: null, nights: 0, rooms: null, included: false, cost: 0 };
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

/* One option row: dot | title + note | total + unit rate */
function stayOptionHTML({ type, title, sub, total, rate, tag, disabled }) {
  const free = total === 0;
  return `
    <button type="button" class="stay-option" role="radio"
            aria-checked="${type === stayType}" data-stay="${type}" ${disabled ? "disabled" : ""}>
      <span class="stay-option-dot" aria-hidden="true"></span>
      <span class="stay-option-title">
        ${escapeHtml(title)}
        ${tag ? `<span class="stay-tag">${escapeHtml(tag)}</span>` : ""}
      </span>
      <span class="stay-option-sub">${escapeHtml(sub)}</span>
      <span class="stay-option-cost">
        <span class="stay-option-total${free ? " stay-option-total--free" : ""}">${free ? "Free" : formatPrice(total)}</span>
        ${rate ? `<span class="stay-option-rate">${escapeHtml(rate)}</span>` : ""}
      </span>
    </button>`;
}

function renderStayOptions(trail) {
  if (!stayOptionsEl) return;
  const hotels = hotelsForTrail(trail);
  const groupSize = getGroupSize();
  const nights = getStayNights();

  // Switching to a trail with no partner hotels drops a hotel choice
  if (stayType === "hotel" && hotels.length === 0) stayType = "none";
  if (stayHotelId && !hotels.some((h) => h.id === stayHotelId)) stayHotelId = null;

  const includedNights = freeNights();
  const campTotal = basecampCost(groupSize, nights);
  const campRate = `${formatPrice(BASECAMP.price_per_person)} per person, per night`;

  // The hotel row shows the chosen hotel once there is one, otherwise
  // the cheapest, so the number always means something concrete.
  const chosenHotel = getHotelById(stayHotelId);
  const cheapest = hotels.length
    ? hotels.reduce((a, b) => (hotelCost(a, groupSize, nights) <= hotelCost(b, groupSize, nights) ? a : b))
    : null;
  const shownHotel = chosenHotel || cheapest;
  const hotelTotal = shownHotel ? hotelCost(shownHotel, groupSize, nights) : 0;
  const hotelRooms = shownHotel ? roomsNeeded(shownHotel, groupSize) : 0;

  stayOptionsEl.innerHTML = [
    stayOptionHTML({
      type: "basecamp",
      title: BASECAMP.name,
      sub: BASECAMP.tagline || "Our own camp near the trail",
      total: campTotal,
      rate:
        includedNights > 0 && nights <= includedNights
          ? `${plural(includedNights, "night")} covered by your package`
          : `${campRate} · ${plural(groupSize, "person").replace("persons", "people")}, ${plural(nights, "night")}`,
      tag: includedNights > 0 ? "Included" : "",
    }),
    stayOptionHTML({
      type: "hotel",
      title: "Nearby hotel",
      sub: hotels.length
        ? `${plural(hotels.length, "partner hotel")} near this trail`
        : "No partner hotels near this trail yet",
      total: hotelTotal,
      rate: shownHotel
        ? `${chosenHotel ? "" : "from "}${formatPrice(shownHotel.price_per_room)} per room, per night · ${plural(hotelRooms, "room")}, ${plural(nights, "night")}`
        : "",
      disabled: hotels.length === 0,
    }),
    stayOptionHTML({
      type: "none",
      title: "No accommodation",
      sub: "I'll arrange my own stay",
      total: 0,
      rate: "",
    }),
  ].join("");

  stayOptionsEl.querySelectorAll("[data-stay]").forEach((btn) => {
    btn.addEventListener("click", () => {
      stayType = btn.dataset.stay;
      // Jumping to hotels with only one nearby saves a pointless click
      if (stayType === "hotel" && !stayHotelId && hotels.length === 1) {
        stayHotelId = hotels[0].id;
      }
      renderStayOptions(getTrailById(trailSelect.value));
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
}

/* The basecamp's inclusions, or the list of hotels — never both */
function renderStayDetails() {
  if (!stayDetailEl) return;

  const trail = getTrailById(trailSelect.value);
  const groupSize = getGroupSize();
  const nights = getStayNights();

  if (stayType === "basecamp" && trail) {
    stayDetailEl.hidden = false;
    stayDetailEl.innerHTML = `
      <span class="stay-detail-title">What's at ${escapeHtml(BASECAMP.name)}</span>
      <span class="stay-detail-where">${ICONS.pin}Near the ${escapeHtml(trail.name)} jump-off${
        trail.location ? `, ${escapeHtml(trail.location)}` : ""
      }</span>
      <ul class="stay-info-list">
        ${(BASECAMP.includes || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      <a class="stay-map-link" href="${escapeHtml(mapsSearchUrl(trailMapsQuery(trail)))}"
         target="_blank" rel="noopener">View the area on Google Maps ${ICONS.external}</a>`;
  } else if (stayType === "hotel") {
    const hotels = hotelsForTrail(trail);
    stayDetailEl.hidden = false;
    stayDetailEl.innerHTML = `
      <span class="stay-detail-title">Choose a hotel near the trail</span>
      <div class="stay-hotel-list" role="radiogroup" aria-label="Partner hotels">
        ${hotels
          .map((h) => {
            const rooms = roomsNeeded(h, groupSize);
            return `
              <button type="button" class="stay-hotel" role="radio"
                      aria-checked="${h.id === stayHotelId}" data-hotel="${escapeHtml(h.id)}">
                <span class="stay-hotel-dot" aria-hidden="true"></span>
                <span class="stay-hotel-name">${escapeHtml(h.name)}</span>
                <span class="stay-hotel-address">${ICONS.pin}${escapeHtml(h.address)}</span>
                <span class="stay-hotel-meta">${[h.distance, h.sleeps ? `Sleeps ${h.sleeps} per room` : ""]
                  .filter(Boolean)
                  .map(escapeHtml)
                  .join(" · ")}</span>
                <span class="stay-hotel-cost">
                  <span class="stay-option-total">${formatPrice(hotelCost(h, groupSize, nights))}</span>
                  <span class="stay-option-rate">${formatPrice(h.price_per_room)} per room · ${plural(rooms, "room")}, ${plural(nights, "night")}</span>
                </span>
              </button>`;
          })
          .join("")}
      </div>
      ${
        getHotelById(stayHotelId)
          ? `<a class="stay-map-link" href="${escapeHtml(mapsSearchUrl(hotelMapsQuery(getHotelById(stayHotelId))))}"
                target="_blank" rel="noopener">View ${escapeHtml(getHotelById(stayHotelId).name)} on Google Maps ${ICONS.external}</a>`
          : ""
      }`;

    stayDetailEl.querySelectorAll("[data-hotel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        stayHotelId = btn.dataset.hotel;
        renderStayOptions(getTrailById(trailSelect.value));
        renderStayDetails();
        showStayMap();
        updatePrice();
      });
    });
  } else {
    stayDetailEl.hidden = true;
    stayDetailEl.innerHTML = "";
  }

  showStayMap();
  stayNightsRow.hidden = stayType === "none";
  updateStayDates();
  updateIncludedBanner();
}

/* Banner above the options when the package already covers a night */
function updateIncludedBanner() {
  if (!stayIncludedBanner) return;
  const pkg = currentPackage();
  if (!packageIncludesStay(pkg)) {
    stayIncludedBanner.hidden = true;
    return;
  }
  stayIncludedBanner.hidden = false;
  stayIncludedBanner.innerHTML =
    `<span aria-hidden="true">🏕️</span><span>Your <strong>${escapeHtml(pkg.name)}</strong> package covers ` +
    `${plural(freeNights(), "night")} at ${escapeHtml(BASECAMP.name)}. Pick a hotel instead and it's charged at the hotel's own rate.</span>`;
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

function updateStayDates() {
  if (!stayDatesEl) return;
  const dates = getStayDates(getStayNights());
  stayDatesEl.innerHTML = dates
    ? `Check in <strong>${escapeHtml(dates.label.split(" → ")[0])}</strong>, check out <strong>${escapeHtml(dates.label.split(" → ")[1])}</strong> — the night before your hike`
    : "Pick a hike date to see your check-in";
}

/* Called when the package changes: an overnight package preselects
   the basecamp, since that's the night they've already paid for. */
function syncStayWithPackage() {
  const includesStay = packageIncludesStay(currentPackage());
  if (includesStay && stayType === "none") stayType = "basecamp";
  renderStayOptions(getTrailById(trailSelect.value));
  renderStayDetails();
}

function resetStay() {
  stayType = "none";
  stayHotelId = null;
  lastStayMapQuery = null;
  if (!stayOptionsEl) return;
  stayOptionsEl.innerHTML = `<span class="package-cards-placeholder">Select a trail to see places to stay.</span>`;
  stayGoogleEl.hidden = true;
  stayDetailEl.hidden = true;
  stayDetailEl.innerHTML = "";
  stayMapEl.hidden = true;
  stayMapEl.innerHTML = "";
  stayNightsRow.hidden = true;
  stayNightsSelect.value = "1";
  if (stayIncludedBanner) stayIncludedBanner.hidden = true;
}

/* ---------- Trail change ---------- */

function handleTrailChange() {
  const trail = getTrailById(trailSelect.value);

  if (!trail) {
    trailInfo.hidden = true;
    resetPackageSelect();
    resetGuideSelect();
    resetTimeSlots();
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
  // Same list as before, moved into guidesForCurrentTrail() so the
  // date handler can rebuild it without duplicating this.
  const availableGuides = guidesForCurrentTrail();

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

  // ADDED: start times belong to the trail, so they're rebuilt here.
  renderTimeSlots(trail);

  // Step 03: stay options depend on where the trail is
  renderStayOptions(trail);
  renderStayDetails();

  updatePrice();

  // Trail (and therefore location) changed — if a date is already picked,
  // refresh the forecast so it still matches the current trail.
  if (dateInput.value) {
    openWeatherModalForCurrentSelection();
    // ADDED: this trail's guides may already be busy on that date
    refreshGuideAvailability();
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

  // An overnight package covers a night at the basecamp, so Step 03
  // preselects it and prices it at ₱0 — see syncStayWithPackage().
  syncStayWithPackage();

  // ADDED: the start times change with the package too — an overnight
  // uses the trail's afternoon list instead of its dawn one.
  renderTimeSlots(getTrailById(trailSelect.value));
  updateSummaryPanel();

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
  // ADDED
  if (summaryTime) {
    summaryTime.textContent = timeSelect?.value ? formatSlot(timeSelect.value) : "Not selected yet";
  }
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
  // Group size changes how many hotel rooms are needed, so every
  // price on the step moves — redraw the options and the hotel list.
  if (stayType !== "none") {
    renderStayOptions(getTrailById(trailSelect.value));
    renderStayDetails();
  }
  updatePrice();
}
groupSizeInput.addEventListener("change", refreshStayForGroup);

/* ADDED (Pass 3): keep Step 04's cards in step with the group size.

   The awkward case is shrinking. Someone fills in six climbers, then
   changes the party to four — two filled-in cards would vanish
   silently. This asks first, and puts the <select> back if they say
   no. `lastGroupSize` is tracked here rather than read from the
   element, because by the time "change" fires the element already
   holds the NEW value. */
let lastGroupSize = Math.max(1, parseInt(groupSizeInput.value, 10) || 1);

groupSizeInput.addEventListener("change", () => {
  const next = Math.max(1, parseInt(groupSizeInput.value, 10) || 1);

  if (next < lastGroupSize) {
    const losing = filledCardsBeyond(next);
    if (losing > 0) {
      const ok = window.confirm(
        `Reducing the group to ${next} will remove ${losing} climber ` +
          `${losing === 1 ? "card that has" : "cards that have"} details filled in.\n\n` +
          "Remove them?",
      );
      if (!ok) {
        groupSizeInput.value = String(lastGroupSize);
        return;
      }
    }
  }

  lastGroupSize = next;
  syncClimberCards(next);
});

// One delegated listener for the whole card list, plus the first card.
initClimbers({
  onSameAsMe: () => fillFirstFromUser(auth.currentUser),
});
syncClimberCards(lastGroupSize);

stayNightsSelect?.addEventListener("change", () => {
  renderStayOptions(getTrailById(trailSelect.value));
  renderStayDetails();
  updatePrice();
});
dateInput.addEventListener("input", updateStayDates);
dateInput.addEventListener("change", updateStayDates);

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
  // ADDED: a guide free on the 20th may be packed on the 21st, so the
  // cards are reloaded on every date change — including a cleared one,
  // which puts every guide back to "available".
  refreshGuideAvailability();
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
  // ADDED
  if (!timeSelect?.value) {
    showFeedback("Please choose a start time.", true);
    timeSlotsEl?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (pkg.requires_activity_choice && !activitySelect.value) {
    showFeedback("Please choose an activity for this package.", true);
    return;
  }

  const stay = getStayQuote();
  if (stay.incomplete) {
    showFeedback("Please choose a hotel, or pick another accommodation option.", true);
    stayDetailEl?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const stayDates = stay.type === "none" ? null : getStayDates(stay.nights);

  /* ADDED (Pass 3): Step 04 must be complete before anything is
     written. Checked here, after the cheap checks above and before
     the network call below, so a half-filled manifest never reaches
     Firestore — a manifest missing one of six people is worse than
     no manifest, because it looks complete. */
  const climberCheck = validateClimbers();
  if (!climberCheck.ok) {
    showFeedback(climberCheck.message, true);
    climberCheck.card?.scrollIntoView({ behavior: "smooth", block: "center" });
    climberCheck.card?.querySelector("input, select")?.focus({ preventScroll: true });
    return;
  }
  const climbers = readClimbers();

  submitBtn.disabled = true;
  submitBtn.textContent = "Booking...";

  /* ADDED: one last availability check, right before writing.
     The cards were drawn when the date was picked — someone else may
     have taken the last slot in the minutes since. This closes most
     of that window; it does NOT close all of it, because two people
     can still pass this check at the same instant. See the note in
     guide-availability.js. */
  try {
    guideDayCounts = await loadGuideDayCounts(dateInput.value);
    if (!isGuideFree(guide, guideDayCounts)) {
      renderGuideCards(guidesForCurrentTrail());
      guideSelect.value = "";
      syncGuideCardSelection();
      updateSummaryPanel();
      showFeedback(
        `${guide.full_name} was just booked for that date. Please pick another guide.`,
        true,
      );
      submitBtn.disabled = false;
      submitBtn.textContent = "Confirm booking";
      return;
    }
  } catch (err) {
    // Fails open — a counter we can't read shouldn't block a booking.
    console.warn("Couldn't re-check guide availability before saving:", err);
  }

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
    // ADDED. `departure_time` is the name normalizeBooking() in
    // trailbound-data.js already reads (as `departureTime`), so the
    // admin dashboard picks this up with no change on that side.
    departure_time: timeSelect.value,
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
    // ADDED to this same write: the start time. createBooking() builds
    // a fixed payload and doesn't pass extra fields through, and this
    // follow-up updateDoc already existed for the accommodation — so
    // the time rides along with it rather than needing a change to
    // trailbound-data.js, which every other page depends on.
    // ADDED to this same write again (Pass 3): the climber list.
    // Same reasoning as departure_time — createBooking() takes a fixed
    // set of fields, and this follow-up updateDoc already exists. One
    // write, three fields, and firestore.rules allows exactly those
    // three on a booking that has no accommodation yet.
    try {
      await updateDoc(doc(db, "bookings", newBookingId), {
        accommodation,
        departure_time: booking.departure_time,
        climbers,
      });
    } catch (stayErr) {
      console.warn(
        "Could not save the start time / accommodation / climbers on the booking:",
        stayErr,
      );
    }

    // ADDED: the guide now has one more group that day. Done after the
    // booking is saved, so a failed booking never burns a slot.
    await bumpGuideDay(booking.guide_id, booking.date);

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
    resetTimeSlots();
    // ADDED (Pass 3). form.reset() puts the group-size <select> back to
    // 1 but leaves the cards standing, so they are cleared here and the
    // tracked size goes back with them.
    resetClimbers();
    lastGroupSize = 1;
    guideDayCounts = new Map();
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

/* ---------- Post-booking modal: add Products or check out ---------- */

function openPostBookingModal(trailName, date) {
  postBookingCopy.textContent =
    `Your spot on ${trailName} for ${date} is reserved and waiting in your cart. ` +
    `Add trail Products now, or head straight to checkout to confirm it with payment.`;
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
if (postBookingAddProductsBtn) {
  postBookingAddProductsBtn.addEventListener("click", () => {
    window.location.href = "products.html";
  });
}
if (postBookingCheckoutBtn) {
  postBookingCheckoutBtn.addEventListener("click", () => {
    window.location.href = "checkout.html";
  });
}

loadData();