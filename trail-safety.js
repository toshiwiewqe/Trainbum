/* ==========================================================
   Trailbound — nearest hospital per trail        (PASS 4, NEW FILE)
   ----------------------------------------------------------
   Trailbound files the climbing permits. The hiker arranges their
   own medical certificate. This file is the "and here's where the
   nearest hospital is" half of that — shown on the booking tracker
   so nobody has to look it up on the mountain.

   WHY A CODE FILE AND NOT A FIRESTORE FIELD: a trail's nearest
   hospital doesn't change, there are only a handful of trails, and
   a Firestore field would mean another seeding run and another
   rules block. The trade-off is real though — the admin can't edit
   this from the panel. If you ever want them to, move it to a
   `nearest_hospital` map on the trail document and read it there.

   >>> READ THIS BEFORE YOUR DEMO <<<
   The hospital NAMES and TOWNS below are the nearest level-2 or
   provincial facility to each jump-off as far as I know them, but I
   have NOT verified any of them against a current source, and every
   `phone` is deliberately blank rather than invented. Check each
   entry and fill in the numbers. A wrong hospital number printed on
   a safety page is worse than no number at all — the page shows
   "add a number in trail-safety.js" until you do, which is honest.
   ========================================================== */

/** Shown when a trail has no entry below. Never leaves the page blank. */
const FALLBACK = {
  name: "Nearest district or provincial hospital",
  town: "Ask your guide at the registration desk",
  phone: "",
  unverified: true,
};

/* Keys are matched loosely — trail_id first, then the trail name,
   lowercased with spaces and punctuation stripped. So "Mt. Pulag",
   "Mount Pulag" and "mt pulag" all land on the same entry. */
const HOSPITALS = {
  pulag: {
    name: "Benguet General Hospital",
    town: "La Trinidad, Benguet",
    phone: "",
  },
  ulap: {
    name: "Benguet General Hospital",
    town: "La Trinidad, Benguet",
    phone: "",
  },
  pinatubo: {
    name: "Tarlac Provincial Hospital",
    town: "Tarlac City, Tarlac",
    phone: "",
  },
  tapulao: {
    name: "President Ramon Magsaysay Memorial Hospital",
    town: "Iba, Zambales",
    phone: "",
  },
  batulao: {
    name: "Batangas Medical Center",
    town: "Batangas City, Batangas",
    phone: "",
  },
  talamitam: {
    name: "Batangas Medical Center",
    town: "Batangas City, Batangas",
    phone: "",
  },
  maculot: {
    name: "Batangas Medical Center",
    town: "Batangas City, Batangas",
    phone: "",
  },
  daraitan: {
    name: "Rizal Provincial Hospital",
    town: "Tanay, Rizal",
    phone: "",
  },
  makiling: {
    name: "Los Baños Doctors Hospital and Medical Center",
    town: "Los Baños, Laguna",
    phone: "",
  },
  picodeloro: {
    name: "General Emilio Aguinaldo Memorial Hospital",
    town: "Trece Martires, Cavite",
    phone: "",
  },
  apo: {
    name: "Southern Philippines Medical Center",
    town: "Davao City, Davao del Sur",
    phone: "",
  },
};

/** "Mt. Pico de Loro" -> "mtpicodeloro" */
function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The nearest hospital for a trail.
 * Pass whatever you have — an id, a name, or both.
 */
export function nearestHospital({ trailId, trailName } = {}) {
  const candidates = [slug(trailId), slug(trailName)].filter(Boolean);

  for (const key of Object.keys(HOSPITALS)) {
    if (candidates.some((c) => c.includes(key))) {
      return { ...HOSPITALS[key], unverified: !HOSPITALS[key].phone };
    }
  }
  return { ...FALLBACK };
}

/** A Google Maps search link, so the hiker can get directions. */
export function hospitalMapLink(hospital) {
  const query = [hospital?.name, hospital?.town].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/* ==========================================================
   PERMIT STATUS — the labels and order used on both sides
   ----------------------------------------------------------
   Kept here so the admin page and the customer's tracker can
   never drift apart. Changing a label changes it in both places.

   `attention` is deliberately outside the normal run: it is not a
   step forward, it is "the LGU sent this back".
   ========================================================== */

export const PERMIT_FLOW = ["not_started", "preparing", "submitted", "approved", "released"];

export const PERMIT_LABELS = {
  not_started: "Not started",
  preparing: "Preparing your papers",
  submitted: "Submitted to the LGU",
  approved: "Approved",
  released: "Permit released",
  attention: "Needs attention",
};

/** What the hiker reads — plainer than the admin's wording. */
export const PERMIT_CUSTOMER_COPY = {
  not_started: "We haven't started on this yet. Nothing for you to do.",
  preparing: "We're preparing your climbing permit from the details you gave us.",
  submitted: "Your permit is with the local government unit, awaiting approval.",
  approved: "Approved. We're collecting the paperwork now.",
  released: "Your permit is ready and will be waiting at the registration desk.",
  attention: "We need something from you — check your email or message us.",
};

export function permitStepIndex(status) {
  const i = PERMIT_FLOW.indexOf(status);
  return i === -1 ? 0 : i;
}

export function permitLabel(status) {
  return PERMIT_LABELS[status] || PERMIT_LABELS.not_started;
}

/** Reads the permit off a raw booking document, with safe defaults. */
export function readPermit(booking) {
  const permit = booking?.permit || {};
  const status = PERMIT_LABELS[permit.status] ? permit.status : "not_started";
  return {
    status,
    reference: permit.reference || "",
    note: permit.note || "",
    updated_at: permit.updated_at || null,
  };
}
