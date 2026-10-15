/* ==========================================================
   Trail map — Leaflet + OpenStreetMap
   Draws a real interactive map with a pin for one trail.

   WHY LEAFLET
   Leaflet is an open-source JavaScript mapping library. It gives
   you the same kind of code as the Google Maps JavaScript API —
   a map object, markers, zoom, popups — but it is free forever
   with no API key, no billing account and no card.

   It is also what the TrailTalk mobile app already uses for its
   Explore map, so the website and the app now share one mapping
   library.

   THE THREE MOVING PARTS
   1. Leaflet          the library — draws the map and handles
                       panning, zooming and markers
   2. Tiles            the actual map images, served by
                       OpenStreetMap. Leaflet does not supply
                       map pictures; you pick a tile provider
   3. Nominatim        OpenStreetMap's free search service, used
                       to turn "Benguet" into coordinates for
                       trails that have no lat/lon stored

   All three are free and keyless. The only obligation is the
   attribution line in the corner of the map — that is required
   by OpenStreetMap's licence, so don't remove it.

   NOTHING TO INSTALL. Leaflet is pulled from a CDN the first time
   a map is opened. If you'd rather bundle it with Vite, run
   `npm install leaflet` and replace loadLeaflet() with:
       import L from "leaflet";
       import "leaflet/dist/leaflet.css";
   ========================================================== */

const LEAFLET_VERSION = "1.9.4";
const LEAFLET_CSS = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}/leaflet.css`;
const LEAFLET_JS = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}/leaflet.js`;

/* Tile provider. This is the plain OpenStreetMap map.
   Want the topographic style instead? It shows ridges, contour
   lines and elevation, which suits a hiking site — swap the two
   constants below for:
     TILE_URL = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
     TILE_ATTRIBUTION = '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> | &copy; OpenStreetMap'
   OpenTopoMap is also free but asks for lighter use, so stick
   with standard OSM unless you want the terrain look. */
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

let leafletPromise = null; // the library is fetched once per page, not per map
let currentMap = null; // so a second map can replace the first cleanly
const geocodeCache = new Map(); // Nominatim asks for at most 1 search/second

/* ---------- coordinates ----------
   Stored as `lat` + `lon` on the trail documents, but `lng` is the
   other common spelling — accept either. Both have to be real
   numbers; a blank, an "N/A" or 0,0 falls back to the location
   text rather than pinning the map in the Atlantic Ocean. */
export function getCoords(trail) {
  const lat = Number(trail.lat);
  const lng = Number(trail.lon ?? trail.lng);
  const valid =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);
  return valid ? { lat, lng } : null;
}

function locationQuery(trail) {
  return [trail.location, "Philippines"].filter(Boolean).join(", ");
}

/* ---------- 1. load the library ----------
   Adds Leaflet's stylesheet and script to the page the first time
   a map is needed, then remembers the promise so opening a second
   trail doesn't download it again. */
function loadLeaflet() {
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L); // already on the page

    // Leaflet's own CSS positions the tiles, controls and markers.
    // Without it the map renders as a pile of stacked images.
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
    }

    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Leaflet failed to load."));
    document.head.appendChild(script);
  });

  return leafletPromise;
}

/* ---------- 2. find the place ----------
   Only used for trails with no lat/lon. Nominatim is the same free
   search service address-check.js already uses on the checkout
   page. Results are cached so re-opening a trail doesn't re-query. */
async function geocode(query) {
  if (geocodeCache.has(query)) return geocodeCache.get(query);

  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    countrycodes: "ph",
  });

  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { "Accept-Language": "en" },
  });
  if (!res.ok) throw new Error("Place search is unavailable.");

  const data = await res.json();
  const hit = data[0]
    ? { lat: Number(data[0].lat), lng: Number(data[0].lon) }
    : null;

  geocodeCache.set(query, hit);
  return hit;
}

/* ---------- 3. draw it ---------- */

/**
 * Draws the map for one trail into an element.
 * @param {string} elementId  id of the <div> the map goes in
 * @param {object} trail      the Firestore trail document
 * @returns {Promise<"exact"|"geocoded"|"failed">}
 *          how the pin was placed, so the caller can caption it
 */
export async function showTrailMap(elementId, trail) {
  const box = document.getElementById(elementId);
  if (!box || !trail) return "failed";

  try {
    const L = await loadLeaflet();

    // Where to put the pin
    let position = getCoords(trail);
    let how = "exact";

    if (!position) {
      position = await geocode(locationQuery(trail));
      how = "geocoded";
    }

    if (!position) {
      box.innerHTML = `<p class="trail-map-loading">We couldn't find this trail on the map.</p>`;
      return "failed";
    }

    // Leaflet refuses to build a second map inside a container it
    // already owns, so tear the old one down first. This matters
    // because trail.js redraws the panel when Firestore pushes an
    // edit while the panel is open.
    if (currentMap) {
      currentMap.remove();
      currentMap = null;
    }
    box.innerHTML = "";

    // A province name lands on the province centre, so a geocoded
    // pin starts zoomed out — zoomed in would imply a precision
    // we don't have.
    const map = L.map(box, {
      center: [position.lat, position.lng],
      zoom: how === "exact" ? 13 : 10,
      scrollWheelZoom: false, // so scrolling the panel doesn't zoom the map
    });
    currentMap = map;

    // The tiles are the map pictures. The attribution is required
    // by OpenStreetMap's licence — leave it in.
    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    // Click the map once to re-enable wheel zoom, so the panel
    // scrolls past the map normally until you actually want to zoom.
    map.on("click", () => map.scrollWheelZoom.enable());
    map.on("mouseout", () => map.scrollWheelZoom.disable());

    L.marker([position.lat, position.lng])
      .addTo(map)
      .bindPopup(
        `<strong>${String(trail.name || "Trail").replace(/[<>]/g, "")}</strong>` +
          (trail.location ? `<br>${String(trail.location).replace(/[<>]/g, "")}` : ""),
      );

    // The panel slides in from the right, so the container's final
    // size isn't known when the map is built. Leaflet measures once
    // at creation and would otherwise render grey gaps where tiles
    // were never requested.
    setTimeout(() => map.invalidateSize(), 350);

    return how;
  } catch (err) {
    console.error("[trail-map] Could not draw the map:", err);
    box.innerHTML = `<p class="trail-map-loading">The map couldn't load right now.</p>`;
    return "failed";
  }
}
