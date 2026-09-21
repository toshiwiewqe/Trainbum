/* ==========================================================
   Trail Discovery Module
   Fetches trails from Firestore and renders them as
   searchable, filterable cards into #trails-grid.

   Each card links to booking.html?trail=<trail_id>, which
   booking.js reads in preselectTrailFromURL() to pre-select
   the trail — so the trail_id here must match the trail_id
   field booking.js looks up. Same collection, same field
   names, one source of truth.

   Safe to load on any page: if #trails-grid isn't present
   the module exits quietly.
   ========================================================== */

// CHANGED: was a one-shot getDocs read. watchTrails() is a live
// Firestore listener, so a trail added, edited, closed or re-opened in
// Admin -> Catalog appears on this page within about a second, with no
// refresh. Everything below still works on the raw document shape
// (trail_id, base_price, guide_id...), so none of the rendering changed.
import { watchTrails } from "./trailbound-data.js";

/* ---------- elements ---------- */
const grid = document.getElementById("trails-grid");
const searchInput = document.getElementById("trail-search");
const difficultyFilter = document.getElementById("trail-difficulty-filter");
const sortSelect = document.getElementById("trail-sort");

/* ---------- state ---------- */
let allTrails = [];

/* ---------- helpers ---------- */

function formatPrice(value) {
  const n = Number(value) || 0;
  return `₱${n.toLocaleString("en-PH")}`;
}

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

/* ---------- loading ---------- */

function loadTrails() {
  watchTrails(
    (items) => {
      // `_raw` is the untouched Firestore document, so the filter and
      // card code below keeps reading the same field names it always did.
      allTrails = items.map((t) => t._raw);
      renderTrails();
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

  const priceOf = (t) => Number(t.base_price ?? t.price) || 0;
  const nameOf = (t) => String(t.name || "");

  if (sortBy === "price-asc") {
    return result.sort(
      (a, b) => priceOf(a) - priceOf(b) || nameOf(a).localeCompare(nameOf(b)),
    );
  }
  if (sortBy === "price-desc") {
    return result.sort(
      (a, b) => priceOf(b) - priceOf(a) || nameOf(a).localeCompare(nameOf(b)),
    );
  }
  return result.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

/* ---------- rendering ---------- */

function cardHTML(trail) {
  const open = isTrailOpen(trail);
  const difficulty = String(trail.difficulty || "");
  const difficultyClass = difficulty
    ? ` trail-badge--${esc(difficulty.toLowerCase())}`
    : "";

  // Location and duration are joined only when both exist, so a
  // missing field doesn't leave a stray separator on the card.
  const metaLine = [trail.location, trail.duration].filter(Boolean).join(" · ");

  const action = open
    ? `<a class="trail-card-btn" href="booking.html?trail=${encodeURIComponent(
        trail.trail_id || "",
      )}">Book</a>`
    : `<span class="trail-card-btn trail-card-btn--disabled">Closed</span>`;

  return `
    <article class="trail-card${open ? "" : " trail-card--closed"}">
      <div class="trail-card-img">
        <img src="${esc(imageSrc(trail.image))}" alt="${esc(trail.name)}" loading="lazy" />
        ${difficulty ? `<span class="trail-badge${difficultyClass}">${esc(difficulty)}</span>` : ""}
        ${open ? "" : `<span class="trail-badge trail-badge--closed">Closed</span>`}
      </div>
      <div class="trail-card-body">
        <h4>${esc(trail.name)}</h4>
        ${metaLine ? `<p class="trail-card-location">${esc(metaLine)}</p>` : ""}
        ${trail.description ? `<p class="trail-card-desc">${esc(trail.description)}</p>` : ""}
        <div class="trail-card-footer">
          <span class="trail-card-price">${formatPrice(trail.base_price ?? trail.price)}<small>/person</small></span>
          ${action}
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

/* ---------- wire it up ---------- */

function init() {
  if (!grid) return; // page doesn't have the trail grid

  grid.innerHTML = `<p class="trails-status">Loading trails...</p>`;

  searchInput?.addEventListener("input", debounce(renderTrails));
  difficultyFilter?.addEventListener("change", renderTrails);
  sortSelect?.addEventListener("change", renderTrails);

  loadTrails();
}

init();