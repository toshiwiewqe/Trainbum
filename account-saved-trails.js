/* ==========================================================
   Saved trails on the account page

   An add-on, not a rewrite: account.js keeps doing exactly what it
   does with the gear wishlist (#wishlist-list), and this file adds
   a "Saved trails" block underneath it. Nothing in account.js or
   account.css is touched — the cards reuse the .wishlist-* classes
   that are already there, so the two lists look like one thing.

   Add one line to account.html, after account.js:
     <script type="module" src="account-saved-trails.js"></script>
   ========================================================== */

import { watchTrails } from "./trailbound-data.js";
import {
  getSavedTrailIds,
  onSavedTrailsChange,
  removeSavedTrail,
} from "./trail-wishlist.js";

const PANEL_ID = "panel-wishlist";
const GEAR_LIST_ID = "wishlist-list";

let allTrails = [];
let listEl = null;

/* ---------- helpers ---------- */

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// Same rule as trail.js: use the stored path as-is, only escaping
// literal spaces, which aren't valid in a URL.
function imageSrc(raw) {
  const src = String(raw || "").trim();
  return src.includes(" ") ? src.replace(/ /g, "%20") : src;
}

/* ---------- the block we add ---------- */

/* A handful of rules, injected here so account.css stays untouched.
   Everything else borrows classes account.css already defines. */
function injectStyles() {
  if (document.getElementById("saved-trails-style")) return;
  const style = document.createElement("style");
  style.id = "saved-trails-style";
  style.textContent = `
    .saved-trails-head { margin-top: 2rem; }
    .saved-trail-link { display: block; text-decoration: none; color: inherit; }
    .saved-trail-link:hover .wishlist-item-name { text-decoration: underline; }
    /* a broken photo leaves its alt text floating over the card */
    .saved-trail-link .wishlist-item-img { color: transparent; }
    .saved-trail-where { font-family: "Inter", sans-serif; font-size: 0.8rem;
      text-transform: none; color: var(--acct-ink-soft); }
  `;
  document.head.appendChild(style);
}

function build() {
  const panel = document.getElementById(PANEL_ID);
  const gearList = document.getElementById(GEAR_LIST_ID);
  if (!panel || !gearList || document.getElementById("saved-trails-list")) return false;

  injectStyles();

  // A heading over the gear list too, so "Saved trails" below it
  // doesn't look like a label that arrived out of nowhere.
  const gearHead = document.createElement("h4");
  gearHead.className = "account-subheading";
  gearHead.textContent = "Gear";
  gearList.parentNode.insertBefore(gearHead, gearList);

  const head = document.createElement("h4");
  head.className = "account-subheading saved-trails-head";
  head.textContent = "Saved trails";

  listEl = document.createElement("div");
  listEl.className = "wishlist-list";
  listEl.id = "saved-trails-list";
  listEl.innerHTML = `<p class="account-empty">Loading saved trails...</p>`;

  gearList.insertAdjacentElement("afterend", head);
  head.insertAdjacentElement("afterend", listEl);
  return true;
}

/* ---------- rendering ---------- */

function cardHTML(trail) {
  const id = String(trail.trail_id || "");
  const img = imageSrc(trail.image);

  return `
    <article class="wishlist-item">
      <a class="saved-trail-link" href="trail.html?trail=${encodeURIComponent(id)}">
        ${
          img
            ? `<img class="wishlist-item-img" src="${esc(img)}" alt="${esc(trail.name)}" loading="lazy">`
            : `<div class="wishlist-item-img"></div>`
        }
        <div class="wishlist-item-info">
          <div class="wishlist-item-name">${esc(trail.name || "Trail")}</div>
          ${trail.location ? `<div class="saved-trail-where">${esc(trail.location)}</div>` : ""}
        </div>
      </a>
      <button type="button" class="wishlist-remove-btn" data-trail-id="${esc(id)}">Remove</button>
    </article>`;
}

function render() {
  if (!listEl) return;

  const ids = getSavedTrailIds();

  if (!ids.length) {
    listEl.innerHTML = `<p class="account-empty">
      No saved trails yet. Tap the heart on any trail to keep it here.
    </p>`;
    return;
  }

  // A trail that was saved and later deleted from the catalogue just
  // drops out of the list rather than rendering as a blank card.
  const found = ids
    .map((id) => allTrails.find((t) => String(t.trail_id ?? "").trim() === id))
    .filter(Boolean);

  if (!found.length) {
    listEl.innerHTML = `<p class="account-empty">
      Your saved trails aren't available right now.
    </p>`;
    return;
  }

  listEl.innerHTML = found.map(cardHTML).join("");
}

/* ---------- wire it up ---------- */

function init() {
  if (!build()) return; // not the account page, or no wishlist panel

  // One listener on the list, not one per card — the cards are
  // replaced whenever the saved set changes.
  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest(".wishlist-remove-btn");
    if (!btn) return;
    btn.disabled = true;
    await removeSavedTrail(btn.dataset.trailId);
  });

  onSavedTrailsChange(render);

  watchTrails(
    (items) => {
      allTrails = items.map((t) => t._raw);
      render();
    },
    {
      onError: (err) => {
        console.error("[saved trails] couldn't load the trails:", err);
        if (listEl) {
          listEl.innerHTML = `<p class="account-empty">Couldn't load your saved trails. Please refresh.</p>`;
        }
      },
    },
  );
}

// account.js builds the panel's contents; wait for the document so
// #wishlist-list is definitely there to insert after.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
