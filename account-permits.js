/* ==========================================================
   Trailbound — permit tracker on My Bookings     (PASS 4, NEW FILE)
   ----------------------------------------------------------
   The customer's half of the permit desk: where their climbing
   permit has got to, the reminder that the medical certificate is
   theirs to arrange, and the nearest hospital to the trailhead.

   WHY THIS FILE EXISTS AT ALL. account.js builds its bookings list
   from watchBookings(), whose normaliser maps a fixed set of fields
   to camelCase — `permit`, `climbers` and `medical_cert_confirmed`
   are new and would never arrive. Rather than change
   trailbound-data.js, which every page on the site depends on, this
   reads the raw booking documents alongside it and merges by id.

   TWO LISTENERS, deliberately. A rule can't scan a collection, so
   the query has to be one Firestore can satisfy up front. Bookings
   made after sign-in carry `uid`; older ones only carry `email`,
   which is exactly why watchBookings takes both. Same here.
   ========================================================== */

import { escapeHtml } from "./trailbound-data.js";
import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  PERMIT_CUSTOMER_COPY,
  PERMIT_FLOW,
  PERMIT_LABELS,
  hospitalMapLink,
  nearestHospital,
  permitLabel,
  permitStepIndex,
  readPermit,
} from "./trail-safety.js";

/** Raw booking documents by id, filled by the two streams below. */
const raw = new Map();

export function getRawBooking(id) {
  return raw.get(id) || null;
}

/**
 * Streams the caller's own raw booking documents.
 * Returns one unsubscribe that stops both listeners.
 */
export function watchMyBookingExtras(user, onChange) {
  const stops = [];

  const attach = (field, value) => {
    if (!value) return;
    const q = query(collection(db, "bookings"), where(field, "==", value));
    stops.push(
      onSnapshot(
        q,
        (snap) => {
          snap.docs.forEach((d) => raw.set(d.id, { id: d.id, ...d.data() }));
          onChange?.();
        },
        (err) => {
          // Not fatal: the bookings list itself still renders, just
          // without the permit panel. Most likely cause is rules.
          console.warn(`Could not stream bookings by ${field}:`, err);
        },
      ),
    );
  };

  attach("uid", user?.uid);
  attach("email", user?.email);

  return () => {
    stops.forEach((stop) => {
      try {
        stop();
      } catch {
        /* already detached */
      }
    });
  };
}

/* ---------- the panel ---------- */

/**
 * The permit block for one booking. Returns "" when the raw document
 * hasn't arrived yet, so the bookings list never waits on it.
 */
export function permitPanelHtml(bookingId) {
  const booking = raw.get(bookingId);
  if (!booking) return "";

  const permit = readPermit(booking);
  const hospital = nearestHospital({
    trailId: booking.trail_id,
    trailName: booking.trail_name,
  });
  const confirmed = booking.medical_cert_confirmed === true;
  const attention = permit.status === "attention";
  const active = permitStepIndex(permit.status);

  const steps = PERMIT_FLOW.map((step, i) => {
    const state = attention ? "" : i < active ? " is-done" : i === active ? " is-now" : "";
    return `<li class="permit-step${state}">
      <span class="permit-step-dot" aria-hidden="true"></span>
      <span class="permit-step-label">${escapeHtml(PERMIT_LABELS[step])}</span>
    </li>`;
  }).join("");

  return `<div class="permit-track${attention ? " permit-track--attention" : ""}">
    <p class="permit-track-head">
      <span class="permit-track-kicker">Climbing permit</span>
      <strong>${escapeHtml(permitLabel(permit.status))}</strong>
    </p>

    ${attention ? "" : `<ol class="permit-steps">${steps}</ol>`}

    <p class="permit-track-copy">${escapeHtml(
      PERMIT_CUSTOMER_COPY[permit.status] || PERMIT_CUSTOMER_COPY.not_started,
    )}</p>

    ${
      permit.note
        ? `<p class="permit-track-note">${escapeHtml(permit.note)}</p>`
        : ""
    }
    ${
      permit.reference
        ? `<p class="permit-track-ref">Reference: ${escapeHtml(permit.reference)}</p>`
        : ""
    }

    <label class="permit-medical-check${confirmed ? " is-done" : ""}">
      <input type="checkbox" data-medical-for="${escapeHtml(bookingId)}"${
        confirmed ? " checked" : ""
      }>
      <span>I have my own medical certificate for this climb</span>
    </label>
    <p class="permit-medical-hint">
      We file your climbing permit. The medical certificate is the one thing
      you arrange yourself — any licensed clinic or hospital can issue it.
    </p>

    <p class="permit-hospital-line">
      <span>Nearest hospital to the jump-off</span>
      <a href="${escapeHtml(hospitalMapLink(hospital))}" target="_blank" rel="noopener">
        ${escapeHtml(hospital.name)}${hospital.town ? `, ${escapeHtml(hospital.town)}` : ""}
      </a>
      ${hospital.phone ? `<em>${escapeHtml(hospital.phone)}</em>` : ""}
    </p>
  </div>`;
}

/* ---------- the medical certificate tick ---------- */

/**
 * One delegated listener for the whole bookings list. `host` is the
 * element the list is rendered into.
 *
 * NOTE ON WHAT IS STORED: a true/false and a timestamp. No document,
 * no clinic, no condition — nothing about the person's health is
 * written anywhere. The tick is a reminder that has been acted on,
 * and that is all it needs to be.
 */
export function bindMedicalToggle(host) {
  if (!host) return;

  host.addEventListener("change", async (event) => {
    const box = event.target.closest("[data-medical-for]");
    if (!box) return;

    const id = box.dataset.medicalFor;
    const next = box.checked;
    const wrap = box.closest(".permit-medical-check");

    box.disabled = true;
    try {
      await updateDoc(doc(db, "bookings", id), {
        medical_cert_confirmed: next,
        medical_cert_confirmed_at: next ? new Date().toISOString() : null,
      });
      wrap?.classList.toggle("is-done", next);
    } catch (err) {
      console.error("Could not save the medical certificate tick:", err);
      // Put the box back where it was, so the page never shows a
      // state that Firestore doesn't actually hold.
      box.checked = !next;
      wrap?.classList.toggle("is-done", !next);
    } finally {
      box.disabled = false;
    }
  });
}
