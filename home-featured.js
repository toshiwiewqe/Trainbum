/* ==========================================================
   Homepage — Featured trails + Featured gear
   Reads the same Firestore collections as trail.html and
   products.html, so the homepage always matches what's live.

   WHICH ONES SHOW UP
     Trails: open trails that have a photo, up to 4.
     Gear:   products that have a photo, most popular first, up to 4.
   To hand-pick instead, add a boolean field  featured = true  to a
   trail or product in Firestore; featured ones always come first.

   If a collection can't be loaded (or has nothing to show), its
   section quietly hides instead of showing an empty block.
   ========================================================== */

import { db } from "./firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const MAX_TRAILS = 4;
const MAX_GEAR = 4;

const trailsSection = document.getElementById("featured-trails");
const trailsGrid = document.getElementById("featured-trails-grid");
const gearSection = document.getElementById("featured-gear");
const gearGrid = document.getElementById("featured-gear-grid");

const ARROW =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>';

/* ---------- helpers ---------- */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `₱${n.toLocaleString("en-PH")}` : "";
}

// Same idea as booking.js: some photo names have spaces in them
function resolveImageSrc(path) {
  if (!path) return "";
  return String(path).trim().replace(/ /g, "%20");
}

// Same rule as trail.js / booking.js: only an exact "closed" shuts a trail
function isTrailOpen(trail) {
  if (trail.isOpen !== undefined) return Boolean(trail.isOpen);
  const status = String(trail.status ?? "open").trim();
  return !/^closed$/i.test(status);
}

// Products: hide anything marked as not for sale
function isProductListed(product) {
  const status = String(product.status ?? "").trim().toLowerCase();
  return !["inactive", "archived", "hidden", "draft", "deleted"].includes(status);
}

function productImage(p) {
  return resolveImageSrc((Array.isArray(p.images) && p.images[0]) || p.image || "");
}

// A photo that fails to load is removed, and the card shows its
// built-in placeholder instead of a broken-image icon
function handleBrokenImages(container) {
  container.querySelectorAll("img").forEach((img) => {
    img.addEventListener("error", () => {
      img.closest("[data-photo]")?.classList.add("no-photo");
      img.remove();
    });
  });
}

function hide(section) {
  if (section) section.hidden = true;
}

/* ---------- trails ---------- */

function difficultyClass(difficulty) {
  const d = String(difficulty || "").toLowerCase();
  if (d.startsWith("easy")) return "easy";
  if (d.startsWith("mod")) return "moderate";
  if (d.startsWith("hard") || d.startsWith("diff")) return "hard";
  return "other";
}

function trailCard(t) {
  const id = encodeURIComponent(t.trail_id || "");
  const img = resolveImageSrc(t.image);
  const price = formatPrice(t.base_price ?? t.price);
  const meta = [
    t.duration ? escapeHtml(t.duration) : "",
    price ? `From <strong>${price}</strong>/pax` : "",
  ].filter(Boolean).join(" · ");

  return `
    <a class="home-trail-card" data-photo href="booking.html?trail=${id}">
      ${img ? `<img src="${escapeHtml(img)}" alt="" loading="lazy" />` : ""}
      ${t.difficulty
        ? `<span class="home-trail-badge home-trail-badge--${difficultyClass(t.difficulty)}">${escapeHtml(t.difficulty)}</span>`
        : ""}
      <span class="home-trail-go" aria-hidden="true">${ARROW}</span>
      <span class="home-trail-body">
        ${t.location ? `<span class="home-trail-location">${escapeHtml(t.location)}</span>` : ""}
        <h3 class="home-trail-name">${escapeHtml(t.name || "Trail")}</h3>
        ${meta ? `<span class="home-trail-meta">${meta}</span>` : ""}
      </span>
    </a>`;
}

async function loadTrails() {
  if (!trailsGrid) return;
  try {
    const snap = await getDocs(collection(db, "trails"));
    const trails = snap.docs
      .map((d) => ({ trail_id: d.id, ...d.data() }))
      .filter((t) => t.name && isTrailOpen(t) && String(t.image || "").trim())
      .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)))
      .slice(0, MAX_TRAILS);

    if (trails.length === 0) return hide(trailsSection);

    trailsGrid.style.setProperty("--cols", trails.length);
    trailsGrid.dataset.count = trails.length;
    trailsGrid.innerHTML = trails.map(trailCard).join("");
    trailsGrid.setAttribute("aria-busy", "false");
    handleBrokenImages(trailsGrid);
  } catch (err) {
    console.warn("Featured trails could not load:", err);
    hide(trailsSection);
  }
}

/* ---------- gear ---------- */

function gearCard(p) {
  const img = productImage(p);
  const soldOut = p.inStock === false;
  const category = p.subcategory || p.category || "";

  return `
    <a class="home-gear-card" href="products.html">
      <span class="home-gear-media" data-photo>
        ${img ? `<img src="${escapeHtml(img)}" alt="" loading="lazy" />` : ""}
        ${soldOut ? '<span class="home-gear-badge">Sold out</span>' : ""}
      </span>
      <span class="home-gear-body">
        ${category ? `<span class="home-gear-cat">${escapeHtml(category)}</span>` : ""}
        <h3 class="home-gear-name">${escapeHtml(p.name || "Gear")}</h3>
        <span class="home-gear-foot">
          <span class="home-gear-price">${formatPrice(p.price)}</span>
          <span class="home-gear-view">View ${ARROW}</span>
        </span>
      </span>
    </a>`;
}

async function loadGear() {
  if (!gearGrid) return;
  try {
    const snap = await getDocs(collection(db, "products"));
    const products = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.name && isProductListed(p) && productImage(p))
      .sort((a, b) => {
        const featured = Number(Boolean(b.featured)) - Number(Boolean(a.featured));
        if (featured) return featured;
        return (Number(b.popularity) || -1) - (Number(a.popularity) || -1);
      })
      .slice(0, MAX_GEAR);

    if (products.length === 0) return hide(gearSection);

    gearGrid.style.setProperty("--cols", products.length);
    gearGrid.innerHTML = products.map(gearCard).join("");
    gearGrid.setAttribute("aria-busy", "false");
    handleBrokenImages(gearGrid);
  } catch (err) {
    console.warn("Featured gear could not load:", err);
    hide(gearSection);
  }
}

loadTrails();
loadGear();
