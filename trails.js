/* ==========================================================
   Trail Discovery Module (Home Page)
   Fetches trails from Firestore and renders them as
   searchable, filterable cards. Each card links to
   booking.html with the trail pre-selected.
   ========================================================== */

import { db } from "./firebase-config.js";
import { collection, getDocs } from "firebase/firestore";

const grid = document.getElementById("trails-grid");
const searchInput = document.getElementById("trail-search");
const difficultyFilter = document.getElementById("trail-difficulty-filter");
const sortSelect = document.getElementById("trail-sort");

let allTrails = [];

async function loadTrails() {
  try {
    const snapshot = await getDocs(collection(db, "trails"));
    allTrails = snapshot.docs.map((doc) => doc.data());
    renderTrails();
  } catch (err) {
    grid.innerHTML = `<p class="trails-status">Couldn't load trails right now. Please refresh.</p>`;
    console.error(err);
  }
}

function formatPrice(value) {
  return `₱${value.toLocaleString("en-PH")}`;
}

function getFilteredSortedTrails() {
  const query = searchInput.value.trim().toLowerCase();
  const difficulty = difficultyFilter.value;
  const sortBy = sortSelect.value;

  let result = allTrails.filter((trail) => {
    const matchesQuery =
      !query ||
      trail.name.toLowerCase().includes(query) ||
      trail.location.toLowerCase().includes(query);
    const matchesDifficulty = !difficulty || trail.difficulty === difficulty;
    return matchesQuery && matchesDifficulty;
  });

  if (sortBy === "price-asc") {
    result = result.sort((a, b) => a.base_price - b.base_price);
  } else if (sortBy === "price-desc") {
    result = result.sort((a, b) => b.base_price - a.base_price);
  } else {
    result = result.sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}

function renderTrails() {
  const trails = getFilteredSortedTrails();

  if (trails.length === 0) {
    grid.innerHTML = `<p class="trails-status">No trails match your search.</p>`;
    return;
  }

  grid.innerHTML = trails
    .map((trail) => {
      const isClosed = trail.status !== "Open";
      return `
        <article class="trail-card ${isClosed ? "trail-card--closed" : ""}">
          <div class="trail-card-img">
            <img src="${trail.image}" alt="${trail.name}" />
            <span class="trail-badge trail-badge--${trail.difficulty.toLowerCase()}">${trail.difficulty}</span>
            ${!isClosed ? "" : `<span class="trail-badge trail-badge--closed">${trail.status}</span>`}
          </div>
          <div class="trail-card-body">
            <h4>${trail.name}</h4>
            <p class="trail-card-location">${trail.location} · ${trail.duration}</p>
            <p class="trail-card-desc">${trail.description}</p>
            <div class="trail-card-footer">
              <span class="trail-card-price">${formatPrice(trail.base_price)}<small>/pax</small></span>
              ${
                isClosed
                  ? `<span class="trail-card-btn trail-card-btn--disabled">Unavailable</span>`
                  : `<a class="trail-card-btn" href="booking.html?trail=${trail.trail_id}">Book This Trail</a>`
              }
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

searchInput.addEventListener("input", renderTrails);
difficultyFilter.addEventListener("change", renderTrails);
sortSelect.addEventListener("change", renderTrails);

loadTrails();