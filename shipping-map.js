/* ==========================================================
   Trailbound — Shipping map (free Google Maps embed)
   Shows the customer's shipping address on an interactive
   Google Map with a pin.

   FREE: no API key, no card, no Google Cloud setup.
   Uses Google's normal embedded map (an <iframe>).

   If we have exact coordinates (from address-check.js), the pin
   goes on those. Otherwise Google searches the address text.

   Want to switch to the full Google Maps JavaScript API later?
   Only this file needs to change.
   ========================================================== */

/**
 * Shows an address on a Google Map.
 * @param {string} elementId  id of the <div> where the map goes
 * @param {string} address    full address text
 * @param {{lat:number,lng:number}|null} location  optional exact spot
 * @param {number} zoom       optional zoom level (default 16)
 */
export function showAddressOnMap(elementId, address, location = null, zoom = 16) {
  const box = document.getElementById(elementId);
  if (!box || (!address && !location)) return;

  const query = location ? `${location.lat},${location.lng}` : address;
  const src =
    "https://maps.google.com/maps?q=" +
    encodeURIComponent(query) +
    `&z=${zoom}&output=embed`;

  let frame = box.querySelector("iframe");
  if (!frame) {
    frame = document.createElement("iframe");
    frame.title = "Shipping address map";
    frame.loading = "lazy";
    frame.referrerPolicy = "no-referrer-when-downgrade";
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.border = "0";
    box.innerHTML = "";
    box.appendChild(frame);
  }

  if (frame.src !== src) frame.src = src;
  box.hidden = false;
}
