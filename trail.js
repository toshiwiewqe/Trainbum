/* ==========================================================
   Trail Discovery Module
   Fetches trails from Firestore and renders them as
   searchable, filterable cards into #trails-grid.

   CHANGED: price is gone from the cards, and so is the Book
   button — the whole card now opens a detail panel showing the
   full description, the trail details, a map of where it is, and
   the Book Now button.

   The map is the Google Maps JavaScript API (see trail-map.js).
   It pins to the document's `lat`/`lon` when those exist and
   geocodes the `location` text when they don't, so trails that
   haven't had coordinates added yet still show something useful.

   The panel's "Book Now" links to booking.html?trail=<trail_id>,
   which booking.js reads in preselectTrailFromURL() to pre-select
   the trail — so the trail_id here must match the trail_id field
   booking.js looks up. Same collection, same field names, one
   source of truth.

   Safe to load on any page: if #trails-grid isn't present
   the module exits quietly.
   ========================================================== */

// watchTrails() is a live Firestore listener, so a trail added,
// edited, closed or re-opened in Admin -> Catalog appears on this
// page within about a second, with no refresh.
import { watchTrails } from "./trailbound-data.js";
import { showTrailMap, getCoords } from "./trail-map.js";
import { directionsUrl, getDirectionSteps } from "./trail-info.js";
// The heart next to Book Now. trail-wishlist.js owns where a saved
// trail is kept; this file only draws the button and the little
// message that confirms the tap.
import {
  isTrailSaved,
  toggleTrailSaved,
  isSignedIn,
  onSavedTrailsChange,
} from "./trail-wishlist.js";

/* ---------- elements ---------- */
const grid = document.getElementById("trails-grid");
const searchInput = document.getElementById("trail-search");
const difficultyFilter = document.getElementById("trail-difficulty-filter");
const sortSelect = document.getElementById("trail-sort");

const panel = document.getElementById("trail-panel");
const panelBackdrop = document.getElementById("trail-panel-backdrop");
const panelClose = document.getElementById("trail-panel-close");
const panelBody = document.getElementById("trail-panel-body");

/* ---------- state ---------- */
let allTrails = [];
let lastFocused = null; // so focus returns to the card after closing
let deepLinkHandled = false; // trail.html?trail=<id> opens that panel once

/* ---------- the little "Added to your wishlist" message ----------
   One element, made the first time it's needed and reused after
   that, so tapping the heart ten times doesn't leave ten toasts
   stacked up in the page. */

let toastEl = null;
let toastTimer = null;

function showToast(message) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "trail-toast";
    // role="status" means a screen reader announces it without
    // stealing focus away from the heart button.
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    document.body.appendChild(toastEl);
  }

  toastEl.textContent = message;
  toastEl.classList.add("is-visible");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl?.classList.remove("is-visible"), 2400);
}

/* ---------- helpers ---------- */

// Cards are built with innerHTML, so anything coming out of the
// database gets escaped on the way in.
function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function debounce(fn, wait = 150) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* Only an exact "closed" shuts a trail down. Real statuses in this
   collection include things like "Open (monolith closed)" and
   "Restricted / intermittent (requires LGU/military permits)" —
   those trails are still bookable, so a plain `status !== "Open"`
   test wrongly greys them out. An explicit isOpen field wins if
   a document has one. */
function isTrailOpen(trail) {
  if (trail.isOpen !== undefined) return Boolean(trail.isOpen);
  const status = String(trail.status ?? "open").trim();
  return !/^closed$/i.test(status);
}

// The image path is used exactly as stored in Firestore — no base
// path is prepended, no folder is assumed. The only change is
// escaping literal spaces (e.g. "galugod baboy.jpg"), which aren't
// valid in a URL.
function imageSrc(raw) {
  const src = String(raw || "").trim();
  return src.includes(" ") ? src.replace(/ /g, "%20") : src;
}

function getTrailById(id) {
  const key = String(id ?? "").trim();
  return allTrails.find((t) => String(t.trail_id ?? "").trim() === key);
}

/* ---------- loading ---------- */

function loadTrails() {
  watchTrails(
    (items) => {
      // `_raw` is the untouched Firestore document, so the filter and
      // card code below keeps reading the same field names it always did.
      allTrails = items.map((t) => t._raw);
      renderTrails();

      /* Opens one trail straight away when the address names it —
         trail.html?trail=T001 — which is what the saved-trails list
         on the account page links to. Runs once, on the first load,
         so a later live update doesn't re-open it after someone has
         closed it. Delete these five lines if you'd rather the link
         just landed on the grid. */
      if (!deepLinkHandled) {
        deepLinkHandled = true;
        const wanted = new URLSearchParams(window.location.search).get("trail");
        if (wanted && getTrailById(wanted)) openPanel(wanted, null);
      }

      // A trail open in the panel may have just been edited in Admin —
      // repaint it so the panel never shows stale details.
      if (panel && panel.classList.contains("is-open")) {
        const openId = panel.dataset.trailId;
        const fresh = getTrailById(openId);
        if (fresh) {
          panelBody.innerHTML = panelHTML(fresh);
          showTrailMap("trail-map", fresh); // the markup was just replaced
        }
      }
    },
    {
      onError: (err) => {
        console.error("[trail] Firestore read failed:", err);
        grid.innerHTML = `<p class="trails-status trails-status--error">Couldn't load trails right now. Please refresh.</p>`;
      },
    },
  );
}

/* ---------- filtering + sorting ---------- */

// Easy -> Moderate -> Hard. Anything unrecognised sorts last rather
// than silently landing in the "Easy" bucket.
const DIFFICULTY_ORDER = { easy: 1, moderate: 2, hard: 3 };

function difficultyRank(trail) {
  return DIFFICULTY_ORDER[String(trail.difficulty || "").trim().toLowerCase()] ?? 99;
}

function getFilteredSortedTrails() {
  const query = (searchInput?.value || "").trim().toLowerCase();
  const difficulty = difficultyFilter?.value || "";
  const sortBy = sortSelect?.value || "name";

  const result = allTrails.filter((trail) => {
    const name = String(trail.name || "").toLowerCase();
    const location = String(trail.location || "").toLowerCase();
    const description = String(trail.description || "").toLowerCase();

    const matchesQuery =
      !query ||
      name.includes(query) ||
      location.includes(query) ||
      description.includes(query);

    const matchesDifficulty = !difficulty || trail.difficulty === difficulty;
    return matchesQuery && matchesDifficulty;
  });

  const nameOf = (t) => String(t.name || "");

  // Price sorting is gone with the price. Difficulty replaces it;
  // ties fall back to name so the order is stable.
  if (sortBy === "difficulty-asc") {
    return result.sort(
      (a, b) => difficultyRank(a) - difficultyRank(b) || nameOf(a).localeCompare(nameOf(b)),
    );
  }
  if (sortBy === "difficulty-desc") {
    return result.sort(
      (a, b) => difficultyRank(b) - difficultyRank(a) || nameOf(a).localeCompare(nameOf(b)),
    );
  }
  return result.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

/* ---------- card ---------- */

function cardHTML(trail) {
  const open = isTrailOpen(trail);
  const difficulty = String(trail.difficulty || "");
  const difficultyClass = difficulty
    ? ` trail-badge--${esc(difficulty.toLowerCase())}`
    : "";

  // Fields are joined only when they exist, so a missing one doesn't
  // leave a stray separator on the card.
  const metaLine = [trail.location, trail.duration].filter(Boolean).join(" · ");

  // No Book button on the card any more — booking happens from the
  // detail panel, so there's one obvious way in.
  return `
    <article class="trail-card${open ? "" : " trail-card--closed"}"
             data-trail-id="${esc(trail.trail_id)}"
             tabindex="0"
             role="button"
             aria-label="View details for ${esc(trail.name)}">
      <div class="trail-card-img">
        <img src="${esc(imageSrc(trail.image))}" alt="${esc(trail.name)}" loading="lazy" />
        ${difficulty ? `<span class="trail-badge${difficultyClass}">${esc(difficulty)}</span>` : ""}
        ${open ? "" : `<span class="trail-badge trail-badge--closed">Closed</span>`}
      </div>
      <div class="trail-card-body">
        <h4>${esc(trail.name)}</h4>
        ${metaLine ? `<p class="trail-card-location">${esc(metaLine)}</p>` : ""}
        ${trail.description ? `<p class="trail-card-desc">${esc(trail.description)}</p>` : ""}
        ${
          trail.jumpoff
            ? `<p class="trail-card-jumpoff"><span>Jump-off</span>${esc(trail.jumpoff)}</p>`
            : ""
        }
        <div class="trail-card-footer">
          <span class="trail-card-details-hint">View details</span>
          ${open ? "" : `<span class="trail-card-status">Closed</span>`}
        </div>
      </div>
    </article>
  `;
}

function renderTrails() {
  const trails = getFilteredSortedTrails();

  if (trails.length === 0) {
    grid.innerHTML = `<p class="trails-status">No trails match your search.</p>`;
    return;
  }

  grid.innerHTML = trails.map(cardHTML).join("");
}

/* ---------- detail panel ---------- */

/* A fact chip. Returns "" for a missing field, so the row only
   ever contains chips that have something to say. */
function chip(label, value, extraClass = "") {
  if (!value) return "";
  return `
    <span class="trail-chip${extraClass}">
      <span class="trail-chip-label">${esc(label)}</span>
      <span class="trail-chip-value">${esc(value)}</span>
    </span>`;
}

function section(title, body) {
  if (!body) return "";
  return `
    <section class="trail-section">
      <h4 class="trail-section-title">${esc(title)}</h4>
      ${body}
    </section>`;
}

/* ---------- Getting there ---------- */

function gettingThereHTML(trail) {
  const steps = getDirectionSteps(trail);

  const jumpoff = trail.jumpoff
    ? `<div class="trail-jumpoff">
         <span class="trail-jumpoff-label">Jump-off point</span>
         <span class="trail-jumpoff-value">${esc(trail.jumpoff)}</span>
       </div>`
    : "";

  const stepList = steps.length
    ? `<ol class="trail-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`
    : `<p class="trail-section-empty">
         Directions for this trail haven't been written up yet — open it in
         Google Maps for turn-by-turn from where you are.
       </p>`;

  // Works for every trail, with or without stored coordinates.
  const button = `
    <a class="trail-directions-btn" href="${esc(directionsUrl(trail))}"
       target="_blank" rel="noopener noreferrer">
      Get directions
    </a>`;

  return jumpoff + stepList + button;
}

/* ---------- the heart ----------
   Same heart path as the Wishlist icon on the account page, so the
   two obviously mean the same thing. */

function saveBtnHTML(trail) {
  const id = String(trail.trail_id || "");
  const on = isTrailSaved(id);
  const label = on ? "Remove from wishlist" : "Add to wishlist";

  return `
    <button type="button"
            class="trail-save-btn${on ? " is-saved" : ""}"
            data-trail-id="${esc(id)}"
            aria-pressed="${on}"
            aria-label="${label}"
            title="${label}">
      <!-- width/height are set here as well as in the CSS: an inline
           <svg> with only a viewBox collapses to 0x0, so without these
           the heart is invisible if trail-wishlist.css hasn't been
           pasted into trail.css yet. -->
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        <path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.2 5 5.7 5c2 0 3.4 1.1 4.3 2.4C10.9 6.1 12.3 5 14.3 5c3.5 0 5.3 3.4 3.7 6.7C19.5 16.4 12 21 12 21z"/>
      </svg>
    </button>`;
}

/* Repaints one heart in place — after a tap, and also when the same
   trail is removed somewhere else (the account page in another tab). */
function syncSaveBtn(btn, on) {
  const label = on ? "Remove from wishlist" : "Add to wishlist";
  btn.classList.toggle("is-saved", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", label);
  btn.setAttribute("title", label);
}

function panelHTML(trail) {
  const open = isTrailOpen(trail);
  const coords = getCoords(trail);
  const difficulty = String(trail.difficulty || "");
  const img = imageSrc(trail.image);

  const bookBtn = open
    ? `<a class="trail-panel-book" href="booking.html?trail=${encodeURIComponent(
        trail.trail_id || "",
      )}">Book Now</a>`
    : `<span class="trail-panel-book trail-panel-book--disabled">Currently closed</span>`;

  // Without coordinates the pin is only as accurate as the place name,
  // so say so rather than letting someone trust a vague pin.
  const mapNote = coords
    ? ""
    : `<p class="trail-map-note">Approximate — pinned to ${esc(trail.location || "the area")}.</p>`;

  return `
    <!-- Hero: the name and location sit ON the photo, so the panel
         doesn't spend three separate rows saying where this is. -->
    <div class="trail-panel-hero">
      ${img ? `<img src="${esc(img)}" alt="${esc(trail.name)}" />` : ""}
      <div class="trail-panel-hero-scrim"></div>
      <div class="trail-panel-hero-text">
        <h3 class="trail-panel-title">${esc(trail.name)}</h3>
        ${trail.location ? `<p class="trail-panel-location">${esc(trail.location)}</p>` : ""}
      </div>
    </div>

    <!-- Fact chips: the scannable version of the old detail table.
         Location isn't repeated here — it's on the photo above. -->
    <div class="trail-chips">
      ${chip("Difficulty", trail.difficulty)}
      ${chip("Duration", trail.duration)}
      ${chip("Elevation", trail.elevation)}
      ${chip("Status", trail.status, open ? " trail-chip--open" : " trail-chip--closed")}
    </div>

    <div class="trail-panel-main">
      ${section("About this trail", trail.description ? `<p class="trail-prose">${esc(trail.description)}</p>` : "")}
      ${section("Getting there", gettingThereHTML(trail))}
      ${section(
        "Where it is",
        `<div class="trail-map" id="trail-map">
           <p class="trail-map-loading">Loading map…</p>
         </div>
         ${mapNote}`,
      )}
    </div>

    <!-- Sticky so Book Now is reachable from anywhere in the panel.
         The heart sits beside it and saves the trail to the Wishlist
         section of the account page. A closed trail can still be
         saved for later — that's rather the point. -->
    <div class="trail-panel-foot">
      <div class="trail-panel-actions">
        ${bookBtn}
        ${saveBtnHTML(trail)}
      </div>
    </div>
  `;
}

function openPanel(trailId, trigger) {
  const trail = getTrailById(trailId);
  if (!trail || !panel) return;

  lastFocused = trigger || null;
  panel.dataset.trailId = trail.trail_id || "";
  panelBody.innerHTML = panelHTML(trail);
  panelBody.scrollTop = 0;

  panel.classList.add("is-open");
  panelBackdrop.classList.add("is-open");
  panel.setAttribute("aria-hidden", "false");

  // The map is drawn after the markup is in the DOM. If they close
  // the panel before it finishes loading, don't paint into it.
  showTrailMap("trail-map", trail).then(() => {
    if (panel.dataset.trailId !== String(trail.trail_id || "")) {
      const stale = document.getElementById("trail-map");
      if (stale) stale.innerHTML = "";
    }
  });

  // Takes the fixed site header off the page while the panel is up,
  // so its logo and hamburger can't sit on top of the panel or cover
  // the ✕. Same approach as the products page.
  document.body.classList.add("trail-panel-open");

  panelClose?.focus();
}

function closePanel() {
  if (!panel) return;
  panel.classList.remove("is-open");
  panelBackdrop.classList.remove("is-open");
  panel.setAttribute("aria-hidden", "true");
  document.body.classList.remove("trail-panel-open");

  // Stop the map loading/animating behind a closed panel
  panelBody.innerHTML = "";
  panel.dataset.trailId = "";

  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  lastFocused = null;
}

/* ---------- wire it up ---------- */

function init() {
  if (!grid) return; // page doesn't have the trail grid

  grid.innerHTML = `<p class="trails-status">Loading trails...</p>`;

  searchInput?.addEventListener("input", debounce(renderTrails));
  difficultyFilter?.addEventListener("change", renderTrails);
  sortSelect?.addEventListener("change", renderTrails);

  // One listener on the grid instead of one per card — the cards are
  // replaced on every filter keystroke, and per-card listeners would
  // be rebound (and leak) each time.
  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".trail-card");
    if (card) openPanel(card.dataset.trailId, card);
  });

  // Keyboard: the cards are focusable, so Enter/Space should open them
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".trail-card");
    if (!card) return;
    e.preventDefault();
    openPanel(card.dataset.trailId, card);
  });

  panelClose?.addEventListener("click", closePanel);
  panelBackdrop?.addEventListener("click", closePanel);

  /* ---------- the heart ----------
     Delegated, because panelBody's contents are replaced every time
     a different trail is opened — a listener bound to the button
     itself would be thrown away with it. */
  panelBody?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".trail-save-btn");
    if (!btn) return;

    e.preventDefault();

    // Guards against a double-tap firing two writes and landing on
    // the wrong state.
    if (btn.disabled) return;
    btn.disabled = true;
    const nowSaved = await toggleTrailSaved(btn.dataset.trailId);
    btn.disabled = false;

    syncSaveBtn(btn, nowSaved);

    // Restart the little pop even if it's mid-animation
    btn.classList.remove("is-pop");
    void btn.offsetWidth;
    btn.classList.add("is-pop");

    if (!nowSaved) {
      showToast("Removed from your wishlist");
    } else if (isSignedIn()) {
      showToast("Added to your wishlist");
    } else {
      // Saying so beats quietly losing it when they switch devices
      showToast("Added to your wishlist — log in to keep it");
    }
  });

  // Kept in step if the same trail is removed from the account page
  // in another tab while this panel is open.
  onSavedTrailsChange(() => {
    const btn = panelBody?.querySelector(".trail-save-btn");
    if (btn) syncSaveBtn(btn, isTrailSaved(btn.dataset.trailId));
  });

  /* ---------- making the panel actually scroll ----------
     script.js drives the GSAP hero and installs a page-wide wheel
     listener. That listener calls preventDefault() on every wheel
     event, which also kills scrolling INSIDE this panel — the panel
     is a perfectly normal scroll container, it just never receives
     a usable wheel event.

     So we scroll it ourselves. This listener sits on `window` in the
     capture phase, which runs before anything bound to an element
     deeper in the page, and it moves panel.scrollTop by hand — so it
     works whether or not the other listener runs, and whether or not
     that listener prevents the default scroll.

     Only swallows the event when the panel actually moved, so
     reaching the top or bottom of the panel doesn't trap the wheel. */
  window.addEventListener(
    "wheel",
    (e) => {
      if (!panel?.classList.contains("is-open")) return;
      if (!panel.contains(e.target)) return;

      const before = panel.scrollTop;
      panel.scrollTop += e.deltaY;

      if (panel.scrollTop !== before) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    { passive: false, capture: true },
  );

  // Touch devices: the same page-wide listener can swallow touchmove.
  // Letting the browser handle touch scrolling inside the panel keeps
  // the native momentum, which a manual handler would lose.
  panel?.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: true });

  loadTrails();
}

init();
