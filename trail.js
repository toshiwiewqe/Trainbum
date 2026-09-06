/* ==========================================================
   TRAIL DISCOVERY
   Loads the trail list, then filters / sorts / renders it into
   #trails-grid on trail.html.

   Reads the "trails" collection from Firestore via the shared
   connection in firebase-config.js. If that read fails (offline,
   rules, empty collection) it falls back to TRAIL_SEED below so
   the page still renders something.
   ========================================================== */

import { db } from "./firebase-config.js";
import { collection, getDocs } from "firebase/firestore";

/* ---------- fallback data ----------
   Only used when the Firestore read fails. Delete once the
   collection is populated and rules allow reads. */
const TRAIL_SEED = [
  {
    id: "pulag",
    name: "Mt. Pulag",
    location: "Kabayan, Benguet",
    difficulty: "Hard",
    price: 2800,
    description:
      "Luzon's highest peak, famous for the sea of clouds at sunrise over the Ambangeg trail.",
    image: "/trails/pulag.jpg",
    status: "open",
  },
  {
    id: "batulao",
    name: "Mt. Batulao",
    location: "Nasugbu, Batangas",
    difficulty: "Moderate",
    price: 900,
    description:
      "Rolling open ridges and a steady scramble to the summit. A classic first overnight or long day hike.",
    image: "/trails/batulao.jpg",
    status: "open",
  },
  {
    id: "ulap",
    name: "Mt. Ulap",
    location: "Itogon, Benguet",
    difficulty: "Easy",
    price: 750,
    description:
      "Grassland ridges, pine forest and the Gungal rock viewpoint on a well-marked eco-trail.",
    image: "/trails/ulap.jpg",
    status: "open",
  },
];

/* ---------- config ---------- */
const BOOKING_URL = (id) => `booking.html?trail=${encodeURIComponent(id)}`;
const IMAGE_BASE = "/trails/"; // where bare filenames resolve from
const PLACEHOLDER_IMG = "/trails/placeholder.jpg";
const DIFFICULTIES = ["Easy", "Moderate", "Hard"];

/* ---------- elements ---------- */
const grid = document.getElementById("trails-grid");
const searchInput = document.getElementById("trail-search");
const difficultySelect = document.getElementById("trail-difficulty-filter");
const sortSelect = document.getElementById("trail-sort");

/* ---------- state ---------- */
let allTrails = [];
const filters = { query: "", difficulty: "", sort: "name" };

/* ---------- helpers ---------- */
const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

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

function titleCase(s) {
  const v = String(s || "").trim();
  return v ? v[0].toUpperCase() + v.slice(1).toLowerCase() : "";
}

// A bare "pulag.jpg" or "images/pulag.jpg" would resolve against
// whatever page is open, which breaks now that the grid isn't on
// the homepage. Force everything to an absolute path.
function imageURL(raw) {
  const src = String(raw || "").trim();
  if (!src) return PLACEHOLDER_IMG;
  if (/^(https?:)?\/\//.test(src) || src.startsWith("/")) return src;
  return IMAGE_BASE + src.replace(/^\.?\/*/, "").replace(/^images\//, "");
}

// Firestore docs and seed objects converge on one shape here, so
// nothing downstream cares where a trail came from.
function normalizeTrail(raw, id) {
  const difficulty = titleCase(raw.difficulty);
  const status = String(raw.status ?? "open").trim();

  return {
    id: raw.id || id || "",
    name: raw.name || "Untitled trail",
    location: raw.location || "",
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : "Moderate",
    price: Number(raw.price) || 0,
    description: raw.description || raw.desc || "",
    image: imageURL(raw.image || raw.photo),
    // Only an exact "closed" shuts a trail down — a status like
    // "open (monolith closed)" is still bookable.
    isOpen:
      raw.isOpen !== undefined ? Boolean(raw.isOpen) : !/^closed$/i.test(status),
  };
}

function setStatus(message, isError = false) {
  grid.innerHTML = `<p class="trails-status${
    isError ? " trails-status--error" : ""
  }">${esc(message)}</p>`;
}

/* ---------- loading ---------- */
async function loadTrails() {
  try {
    const snap = await getDocs(collection(db, "trails"));
    if (snap.empty) throw new Error("no trail documents");
    return snap.docs.map((doc) => normalizeTrail(doc.data(), doc.id));
  } catch (err) {
    console.warn("[trail] Firestore read failed, using seed data:", err);
    return TRAIL_SEED.map((t) => normalizeTrail(t, t.id));
  }
}

/* ---------- filtering + sorting ---------- */
function visibleTrails() {
  const q = filters.query.trim().toLowerCase();

  const matched = allTrails.filter((t) => {
    if (filters.difficulty && t.difficulty !== filters.difficulty) return false;
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      t.location.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q)
    );
  });

  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name),
    "price-asc": (a, b) => a.price - b.price || a.name.localeCompare(b.name),
    "price-desc": (a, b) => b.price - a.price || a.name.localeCompare(b.name),
  };

  return matched.sort(sorters[filters.sort] || sorters.name);
}

/* ---------- rendering ---------- */
function cardHTML(t) {
  const closed = !t.isOpen;

  const action = closed
    ? `<span class="trail-card-btn trail-card-btn--disabled">Closed</span>`
    : `<a class="trail-card-btn" href="${esc(BOOKING_URL(t.id))}">Book</a>`;

  return `
    <article class="trail-card${closed ? " trail-card--closed" : ""}">
      <div class="trail-card-img">
        <img src="${esc(t.image)}" alt="${esc(t.name)}" loading="lazy"
             onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" />
        <span class="trail-badge">${esc(t.difficulty)}</span>
        ${closed ? `<span class="trail-badge trail-badge--closed">Closed</span>` : ""}
      </div>
      <div class="trail-card-body">
        <h4>${esc(t.name)}</h4>
        ${t.location ? `<p class="trail-card-location">${esc(t.location)}</p>` : ""}
        ${t.description ? `<p class="trail-card-desc">${esc(t.description)}</p>` : ""}
        <div class="trail-card-footer">
          <span class="trail-card-price">
            ${peso.format(t.price)}<small>/person</small>
          </span>
          ${action}
        </div>
      </div>
    </article>
  `;
}

function render() {
  const trails = visibleTrails();

  if (!trails.length) {
    setStatus("No trails match those filters. Try a different search.");
    return;
  }

  grid.innerHTML = trails.map(cardHTML).join("");
}

/* ---------- wire it up ---------- */
async function init() {
  if (!grid) return; // not on trail.html

  setStatus("Loading trails...");

  searchInput?.addEventListener(
    "input",
    debounce((e) => {
      filters.query = e.target.value;
      render();
    }),
  );

  difficultySelect?.addEventListener("change", (e) => {
    filters.difficulty = e.target.value;
    render();
  });

  sortSelect?.addEventListener("change", (e) => {
    filters.sort = e.target.value;
    render();
  });

  allTrails = await loadTrails();
  render();
}

init();