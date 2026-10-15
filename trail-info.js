/* ==========================================================
   Trail info — getting there
   The directions helpers used by the detail panel's
   "Getting there" section.

   OPTIONAL FIRESTORE FIELDS (a trail without them still renders):

     how_to_get_there    string, or array of strings for steps
     jumpoff             string — where the hike actually starts

   The directions link works for every trail with nothing added,
   built from `lat`/`lon` when stored and the `location` text
   when not.
   ========================================================== */

/* ---------- getting there ----------
   The directions link is a plain Google Maps URL — no API key,
   no billing. It opens the Maps app on a phone and the website on
   a desktop, with the trail already set as the destination. */

export function directionsUrl(trail) {
  const lat = Number(trail.lat);
  const lng = Number(trail.lon ?? trail.lng);
  const hasCoords =
    Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

  const destination = hasCoords
    ? `${lat},${lng}`
    : [trail.jumpoff, trail.location, "Philippines"].filter(Boolean).join(", ");

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/**
 * The "how to get there" text as a list of steps.
 * Accepts a plain string, a string with line breaks, or an array.
 * Returns [] when the trail has nothing written yet — the panel
 * then shows just the jump-off and the directions button.
 */
export function getDirectionSteps(trail) {
  const raw = trail.how_to_get_there ?? trail.howToGetThere ?? trail.directions;
  if (!raw) return [];

  const list = Array.isArray(raw) ? raw : String(raw).split(/\r?\n+/);
  return list.map((s) => String(s).trim()).filter(Boolean);
}
