/* ==========================================================
   Start times for a trail

   Each trail stores its own list, because mountains don't share a
   schedule — Pulag's sunrise climbs start at 2 AM, a Batulao day
   hike at 6 is fine, and some parks have a cut-off after which the
   ranger won't let anyone up.

   TWO LISTS, because a day hike and an overnight don't start at the
   same hour. On the trail document:

     time_slots:           ["04:00", "05:00", "06:00"]   // day hikes
     time_slots_overnight: ["13:00", "14:00", "15:00"]   // overnight

   24-hour "HH:MM" strings, as many as you like. Which list is used
   is decided by the PACKAGE: booking.js already knows whether a
   package covers a night (that's what gives the free basecamp
   night in Step 03), and the same test picks the list here.

   A trail with neither field falls back to the defaults below, so
   every trail works today and you can fill them in one at a time.
   ========================================================== */

/* Fallbacks only — used until a trail has its own lists.
   Day hikes start before dawn so you're off the summit before the
   afternoon rain; an overnight starts after lunch, so you reach the
   campsite with light to spare and summit at sunrise the next day. */
export const DEFAULT_SLOTS = ["04:00", "05:00", "06:00", "07:00"];
export const DEFAULT_OVERNIGHT_SLOTS = ["12:00", "13:00", "14:00", "15:00"];

/* Accepts "4:00", "04:00", "0400" and " 06:30 " — anything that
   resolves to a real time of day. Anything else is dropped rather
   than rendered as a broken button. */
function normalizeSlot(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const m = raw.match(/^(\d{1,2})\s*:?\s*(\d{2})$/);
  if (!m) return null;

  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isInteger(min) || min < 0 || min > 59) return null;

  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function firstArray(...candidates) {
  for (const c of candidates) if (Array.isArray(c)) return c;
  return [];
}

/**
 * The start times offered for one trail, cleaned, de-duplicated and
 * in order.
 *
 * @param {object} trail
 * @param {{ overnight?: boolean }} options
 *        overnight: true -> the trail's time_slots_overnight list
 *        (falling back to DEFAULT_OVERNIGHT_SLOTS)
 *
 * An overnight trail that has only the day-hike list still gets the
 * overnight defaults rather than 4 AM starts, because a 4 AM start
 * for a trip that camps that night is simply wrong.
 */
export function getTimeSlots(trail, { overnight = false } = {}) {
  const stored = overnight
    ? firstArray(trail?.time_slots_overnight, trail?.timeSlotsOvernight)
    : firstArray(trail?.time_slots, trail?.timeSlots);

  const cleaned = [...new Set(stored.map(normalizeSlot).filter(Boolean))].sort();
  if (cleaned.length) return cleaned;

  return overnight ? [...DEFAULT_OVERNIGHT_SLOTS] : [...DEFAULT_SLOTS];
}

/** "04:00" -> "4:00 AM". What the button says. */
export function formatSlot(slot) {
  const value = normalizeSlot(slot);
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** A short note under the time, so an unusual hour reads as deliberate. */
export function slotNote(slot, { overnight = false } = {}) {
  const value = normalizeSlot(slot);
  if (!value) return "";

  // On an overnight the hour means something different — a 1 PM start
  // isn't "midday", it's the trek in before you make camp.
  if (overnight) return "Camp overnight";

  const h = Number(value.split(":")[0]);
  if (h < 4) return "Night trek";
  if (h < 7) return "For sunrise";
  if (h < 11) return "Morning start";
  if (h < 15) return "Midday start";
  return "Afternoon start";
}
