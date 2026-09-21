/* ==========================================================
   Trailbound — Contact, emergency contact & address checks
   Makes sure the customer typed REAL details before they can pay.

   Four checks:
     1. checkContact()   — their name, email, PH mobile
     2. checkEmergency() — emergency contact name + number
                           (any country code; can't be their own)
     3. checkAddress()   — street, city, 4-digit ZIP, region
     4. findAddress()    — does this place actually exist in the
                           Philippines? Uses OpenStreetMap's free
                           search (Nominatim). No key, no card.

   Nominatim rule: at most 1 search per second. We only search
   when the customer clicks "Check address", so that's fine.
   ========================================================== */

const SEARCH_URL = "https://nominatim.openstreetmap.org/search";

const PH_MOBILE = /^(09\d{9}|\+639\d{9})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const digits = (s) => (s || "").replace(/[\s()+-]/g, "");

/**
 * Cleans up a typed number so 0917…, +63 917… and 917… all come out the same.
 * Returns { national: "9171234567", e164: "639171234567" }.
 */
export function normalizePhone(code, number) {
  const cc = digits(code);
  const raw = (number || "").trim();
  let n = digits(raw);

  // The box may already carry the country code ("+63 917…" or "0063 917…")
  if (raw.startsWith("+") && n.startsWith(cc)) n = n.slice(cc.length);
  else if (n.startsWith("00" + cc)) n = n.slice(2 + cc.length);

  n = n.replace(/^0+/, ""); // 0917… -> 917…
  return { national: n, e164: cc + n };
}

/** One comparable form for a number, e.g. "639171234567". */
export function toE164(code, number) {
  return normalizePhone(code, number).e164;
}

/* ---------- 1. Their own contact details ---------- */

// Returns an object like { "ship-phone": "Error message", ... }
// Empty object = everything is OK.
export function checkContact(values) {
  const errors = {};

  const name = (values.name || "").trim();
  if (name.split(/\s+/).length < 2 || !/[a-zA-Z]/.test(name)) {
    errors["ship-name"] = "Please enter your first and last name.";
  }

  if (!EMAIL.test((values.email || "").trim())) {
    errors["ship-email"] = "Please enter a valid email, like juan@email.com.";
  }

  if (!PH_MOBILE.test((values.phone || "").replace(/[\s()-]/g, ""))) {
    errors["ship-phone"] = "Use a PH mobile number, like 0917 123 4567.";
  }

  return errors;
}

/* ---------- 2. Emergency contact ---------- */

/**
 * @param {{name, code, number, relation}} values
 * @param {string} ownPhone  the customer's own number, so we can
 *                           reject it being used as the emergency one
 */
export function checkEmergency(values, ownPhone) {
  const errors = {};

  const name = (values.name || "").trim();
  if (name.split(/\s+/).length < 2 || !/[a-zA-Z]/.test(name)) {
    errors["emg-name"] = "Please enter their first and last name.";
  }

  const cc = digits(values.code);
  const { national, e164 } = normalizePhone(cc, values.number);

  if (!national) {
    errors["emg-number"] = "Please enter their contact number.";
  } else if (cc === "63") {
    // Philippine mobile numbers are 10 digits and start with 9
    if (!/^9\d{9}$/.test(national)) {
      errors["emg-number"] = "PH mobile numbers look like 917 123 4567.";
    }
  } else if (!/^\d{6,14}$/.test(national)) {
    errors["emg-number"] = "Please enter a valid contact number.";
  }

  if (!errors["emg-number"] && ownPhone && e164 === toE164("63", ownPhone)) {
    errors["emg-number"] = "This must be someone else's number, not your own.";
  }

  return errors;
}

/* ---------- 3. Shipping address ---------- */

export function checkAddress(values) {
  const errors = {};

  const address = (values.address || "").trim();
  if (address.length < 8 || !/[a-zA-Z]{3,}/.test(address)) {
    errors["ship-address"] = "Please enter your house/unit no., street, and barangay.";
  }

  const city = (values.city || "").trim();
  if (city.length < 3 || !/[a-zA-Z]{3,}/.test(city)) {
    errors["ship-city"] = "Please enter your city or municipality.";
  }

  if (!/^\d{4}$/.test((values.zip || "").trim())) {
    errors["ship-zip"] = "PH ZIP codes have 4 digits, like 1800.";
  }

  if (!values.region) {
    errors["ship-region"] = "Please select a region.";
  }

  return errors;
}

/* ---------- 4. Does the place exist? ---------- */

async function search(query) {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    countrycodes: "ph", // Philippines only
  });
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { "Accept-Language": "en" },
  });
  if (!res.ok) throw new Error("Address search is not available right now.");
  const data = await res.json();
  return data[0] || null;
}

/**
 * Looks up the address in the Philippines.
 * Returns one of:
 *   { status: "exact",  location: {lat, lng}, label }  -> street found
 *   { status: "city",   location: {lat, lng}, label }  -> only the city found
 *   { status: "notFound" }                              -> city doesn't exist
 *   { status: "offline" }                               -> search service is down
 */
export async function findAddress({ address, city }) {
  try {
    // Try the full address first
    const exact = await search(`${address}, ${city}, Philippines`);
    if (exact) {
      return {
        status: "exact",
        location: { lat: Number(exact.lat), lng: Number(exact.lon) },
        label: exact.display_name,
      };
    }

    // Wait 1 second (Nominatim's rule), then try just the city
    await new Promise((r) => setTimeout(r, 1000));
    const cityOnly = await search(`${city}, Philippines`);
    if (cityOnly) {
      return {
        status: "city",
        location: { lat: Number(cityOnly.lat), lng: Number(cityOnly.lon) },
        label: cityOnly.display_name,
      };
    }

    return { status: "notFound" };
  } catch (err) {
    console.warn("Address search failed:", err);
    return { status: "offline" };
  }
}
