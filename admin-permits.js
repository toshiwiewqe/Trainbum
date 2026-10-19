/* ==========================================================
   Trailbound Admin — Permit desk                (PASS 4, NEW FILE)
   ----------------------------------------------------------
   Trailbound files the climbing permits on the hiker's behalf. This
   is the desk where that happens: every booking, what stage its
   permit is at, and the manifest to print for the barangay.

   WHY IT READS FIRESTORE DIRECTLY instead of using watchBookings()
   from trailbound-data.js: normalizeBooking() maps a fixed set of
   fields to camelCase, and `climbers` and `permit` are new — they
   would be dropped on the way through. Reading the raw documents
   here means NOTHING in trailbound-data.js has to change, so no
   other admin page is put at risk by this feature.

   Only the admin gate and the chrome come from the shared module.
   ========================================================== */

import {
  attachLogoutConfirm,
  collectUnsubscribers,
  escapeHtml,
  renderAdminSidebarProfile,
  requireAdmin,
} from "./trailbound-data.js";
import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  PERMIT_FLOW,
  PERMIT_LABELS,
  nearestHospital,
  permitLabel,
  readPermit,
} from "./trail-safety.js";

const track = collectUnsubscribers();

const el = {
  avatarImg: document.getElementById("admin-avatar"),
  avatarFallback: document.getElementById("admin-avatar-fallback"),
  nameEl: document.getElementById("admin-name"),
  logoutBtn: document.getElementById("admin-logout-btn"),
  search: document.getElementById("permit-search"),
  statusFilter: document.getElementById("permit-status-filter"),
  upcomingOnly: document.getElementById("permit-upcoming-only"),
  list: document.getElementById("permit-list"),
};

/** Raw booking documents, newest hike date first. */
let bookings = [];

attachLogoutConfirm(el.logoutBtn);

requireAdmin((user) => {
  renderAdminSidebarProfile(user, {
    avatarImg: el.avatarImg,
    avatarFallback: el.avatarFallback,
    nameEl: el.nameEl,
  });

  track(
    onSnapshot(
      collection(db, "bookings"),
      (snap) => {
        bookings = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          // A cancelled booking needs no permit.
          .filter((b) => String(b.status || "").toLowerCase() !== "cancelled")
          .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
        renderStats();
        renderList();
      },
      (err) => {
        console.error("Could not read bookings:", err);
        el.list.innerHTML =
          '<p class="admin-empty">Could not load bookings. Check that you are signed in as an admin and that firestore.rules is deployed.</p>';
      },
    ),
  );
});

/* ---------- helpers ---------- */

function todayISO() {
  // Local date, not UTC — a climb on the 20th should stop counting as
  // "upcoming" at midnight in Manila, not at 8am.
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function isUpcoming(booking) {
  return String(booking.date || "") >= todayISO();
}

function prettyDate(iso) {
  if (!iso) return "Date to be confirmed";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function prettyTime(value) {
  if (!value) return "";
  const [h, m] = String(value).split(":");
  const hour = Number(h);
  if (!Number.isFinite(hour)) return String(value);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${m || "00"} ${suffix}`;
}

/** The climber list, tolerating bookings made before Pass 3 shipped. */
function climbersOf(booking) {
  return Array.isArray(booking.climbers) ? booking.climbers : [];
}

function leadName(booking) {
  return climbersOf(booking)[0]?.name || booking.full_name || "Unnamed booking";
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

/* ---------- stats ---------- */

function renderStats() {
  const upcoming = bookings.filter(isUpcoming);

  setText("stat-upcoming", String(upcoming.length));

  const waiting = upcoming.filter((b) =>
    ["not_started", "preparing"].includes(readPermit(b).status),
  ).length;
  setText("stat-waiting", String(waiting));

  const withLgu = upcoming.filter((b) => readPermit(b).status === "submitted").length;
  setText("stat-with-lgu", String(withLgu));

  // The number that matters most: climbs happening soon whose permit
  // is not released yet.
  const soon = upcoming.filter((b) => {
    const days = daysUntil(b.date);
    return days !== null && days <= 7 && readPermit(b).status !== "released";
  }).length;
  setText("stat-soon", String(soon));

  const missing = upcoming.filter((b) => climbersOf(b).length === 0).length;
  const note = document.getElementById("stat-missing-note");
  if (note) {
    note.textContent = missing
      ? `${missing} booking${missing === 1 ? "" : "s"} with no climber list`
      : "All have climber lists";
    note.classList.toggle("admin-stat-delta--negative", missing > 0);
  }
}

function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

/* ---------- the list ---------- */

function filtered() {
  const status = el.statusFilter?.value || "all";
  const term = (el.search?.value || "").trim().toLowerCase();
  const upcomingOnly = el.upcomingOnly?.checked !== false;

  return bookings.filter((b) => {
    if (upcomingOnly && !isUpcoming(b)) return false;
    if (status !== "all" && readPermit(b).status !== status) return false;
    if (!term) return true;

    const haystack = [
      b.trail_name,
      b.date,
      b.guide_name,
      b.full_name,
      b.email,
      readPermit(b).reference,
      ...climbersOf(b).map((c) => c.name),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
}

function urgencyClass(booking) {
  const days = daysUntil(booking.date);
  if (days === null) return "";
  if (readPermit(booking).status === "released") return "";
  if (days <= 2) return " permit-card--urgent";
  if (days <= 7) return " permit-card--soon";
  return "";
}

function countdownText(booking) {
  const days = daysUntil(booking.date);
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}

function climberRows(booking) {
  const climbers = climbersOf(booking);

  if (!climbers.length) {
    return `<p class="permit-no-climbers">
      No climber list on this booking. It was made before climber
      details were added, so only the party size (${escapeHtml(
        String(booking.group_size ?? "—"),
      )}) is known. Ask the booker for the names before the climb.
    </p>`;
  }

  return `<table class="permit-climbers">
    <thead>
      <tr><th>#</th><th>Name</th><th>Age</th><th>Sex</th><th>Mobile</th><th>Emergency contact</th></tr>
    </thead>
    <tbody>
      ${climbers
        .map(
          (c, i) => `<tr>
        <td>${i + 1}</td>
        <td><strong>${escapeHtml(c.name || "—")}</strong>${
          c.notes
            ? `<span class="permit-climber-note">${escapeHtml(c.notes)}</span>`
            : ""
        }</td>
        <td>${escapeHtml(String(c.age ?? "—"))}</td>
        <td>${escapeHtml(c.sex || "—")}</td>
        <td>${escapeHtml(c.phone || "—")}</td>
        <td>${escapeHtml(c.emergency_name || "—")}<span class="permit-climber-note">${escapeHtml(
          c.emergency_phone || "no number",
        )}</span></td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
}

function renderList() {
  const rows = filtered();

  if (!rows.length) {
    el.list.innerHTML = bookings.length
      ? '<p class="admin-empty">No bookings match these filters.</p>'
      : '<p class="admin-empty">No bookings yet. They appear here as soon as someone books a climb.</p>';
    return;
  }

  el.list.innerHTML = rows
    .map((b) => {
      const permit = readPermit(b);
      const hospital = nearestHospital({ trailId: b.trail_id, trailName: b.trail_name });
      const medical = b.medical_cert_confirmed === true;

      return `<section class="permit-card${urgencyClass(b)}" data-booking="${escapeHtml(b.id)}">
        <header class="permit-card-head">
          <div class="permit-card-title">
            <h3>${escapeHtml(b.trail_name || "Unnamed trail")}</h3>
            <p class="permit-card-when">
              ${escapeHtml(prettyDate(b.date))}
              ${b.departure_time ? ` · ${escapeHtml(prettyTime(b.departure_time))}` : ""}
              <span class="permit-countdown">${escapeHtml(countdownText(b))}</span>
            </p>
          </div>
          <span class="permit-badge permit-badge--${escapeHtml(permit.status)}">${escapeHtml(
            permitLabel(permit.status),
          )}</span>
        </header>

        <div class="permit-facts">
          <div><dt>Lead booker</dt><dd>${escapeHtml(leadName(b))}</dd></div>
          <div><dt>Party</dt><dd>${escapeHtml(
            String(climbersOf(b).length || b.group_size || "—"),
          )}</dd></div>
          <div><dt>Guide</dt><dd>${escapeHtml(b.guide_name || "—")}</dd></div>
          <div><dt>Contact</dt><dd>${escapeHtml(b.email || "—")}</dd></div>
        </div>

        <div class="permit-medical${medical ? " is-ok" : ""}">
          <!-- The sentence is wrapped in its own <span>. .permit-medical is
               a column flexbox, so a bare text node and the <strong> inside
               it become SEPARATE flex items and the line breaks into
               "Hiker has" / "not" / "confirmed a medical…". One wrapper
               keeps it a sentence. -->
          <span>${
            medical
              ? "Medical certificate confirmed by the hiker."
              : "Hiker has <strong>not</strong> confirmed a medical certificate yet. They arrange this themselves — we only remind them."
          }</span>
          <span class="permit-hospital">Nearest hospital: ${escapeHtml(hospital.name)}${
            hospital.town ? `, ${escapeHtml(hospital.town)}` : ""
          }${hospital.phone ? ` · ${escapeHtml(hospital.phone)}` : " · add a number in trail-safety.js"}</span>
        </div>

        <details class="permit-climbers-wrap">
          <summary>Climber list (${climbersOf(b).length})</summary>
          ${climberRows(b)}
        </details>

        <div class="permit-controls">
          <label class="permit-control">
            <span>Permit stage</span>
            <select data-permit-status>
              ${[...PERMIT_FLOW, "attention"]
                .map(
                  (s) =>
                    `<option value="${s}"${s === permit.status ? " selected" : ""}>${escapeHtml(
                      PERMIT_LABELS[s],
                    )}</option>`,
                )
                .join("")}
            </select>
          </label>
          <label class="permit-control">
            <span>LGU reference no.</span>
            <input type="text" data-permit-reference value="${escapeHtml(
              permit.reference,
            )}" placeholder="e.g. DENR-CAR-2026-0417" maxlength="60">
          </label>
          <label class="permit-control permit-control--wide">
            <span>Note (the hiker sees this)</span>
            <input type="text" data-permit-note value="${escapeHtml(
              permit.note,
            )}" placeholder="e.g. Waiting on the barangay clearance" maxlength="160">
          </label>
        </div>

        <footer class="permit-card-foot">
          <span class="permit-saved" data-permit-saved>${
            permit.updated_at
              ? `Last updated ${escapeHtml(new Date(permit.updated_at).toLocaleString("en-PH"))}`
              : "Never updated"
          }</span>
          <button type="button" class="permit-btn permit-btn--ghost" data-print>Print manifest</button>
          <button type="button" class="permit-btn" data-save>Save</button>
        </footer>
      </section>`;
    })
    .join("");
}

/* ---------- saving ---------- */

el.list?.addEventListener("click", async (event) => {
  const card = event.target.closest(".permit-card");
  if (!card) return;

  if (event.target.closest("[data-print]")) {
    printManifest(card.dataset.booking);
    return;
  }

  const saveBtn = event.target.closest("[data-save]");
  if (!saveBtn) return;

  const id = card.dataset.booking;
  const status = card.querySelector("[data-permit-status]").value;
  const reference = card.querySelector("[data-permit-reference]").value.trim();
  const note = card.querySelector("[data-permit-note]").value.trim();
  const savedEl = card.querySelector("[data-permit-saved]");

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    // One nested object, so this write can never disturb the trail,
    // date, price or climber list on the booking.
    await updateDoc(doc(db, "bookings", id), {
      permit: { status, reference, note, updated_at: new Date().toISOString() },
    });
    savedEl.textContent = `Saved ${new Date().toLocaleString("en-PH")}`;
    savedEl.classList.remove("is-error");
  } catch (err) {
    console.error("Could not save the permit:", err);
    savedEl.textContent = "Could not save — check firestore.rules is deployed.";
    savedEl.classList.add("is-error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
});

el.search?.addEventListener("input", renderList);
el.statusFilter?.addEventListener("change", renderList);
el.upcomingOnly?.addEventListener("change", () => {
  renderList();
});

/* ==========================================================
   PRINT MANIFEST
   ----------------------------------------------------------
   The sheet handed to the barangay at the registration desk.

   Written into a new window with its own stylesheet rather than
   printed from this page. admin.css is a dark theme with its own
   @media print block built around the order-detail layout; reusing
   it here would mean fighting it, and a manifest that prints white
   text on white paper is a manifest nobody can read.
   ========================================================== */

function printManifest(bookingId) {
  const b = bookings.find((item) => item.id === bookingId);
  if (!b) return;

  const climbers = climbersOf(b);
  const hospital = nearestHospital({ trailId: b.trail_id, trailName: b.trail_name });
  const permit = readPermit(b);

  const rows = climbers.length
    ? climbers
        .map(
          (c, i) => `<tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(c.name || "")}</td>
            <td>${escapeHtml(String(c.age ?? ""))}</td>
            <td>${escapeHtml(c.sex || "")}</td>
            <td>${escapeHtml(c.phone || "")}</td>
            <td>${escapeHtml(c.emergency_name || "")}<br><small>${escapeHtml(
              c.emergency_phone || "",
            )}</small></td>
            <td>${escapeHtml(c.notes || "")}</td>
            <td class="sign"></td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="8" class="empty">No climber list on this booking —
         party size ${escapeHtml(String(b.group_size ?? "?"))}. Names must be
         collected at the desk.</td></tr>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Climb manifest — ${escapeHtml(b.trail_name || "")} ${escapeHtml(b.date || "")}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.4 "Helvetica Neue", Arial, sans-serif; color: #000; margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  .sub { font-size: 9pt; color: #444; margin: 0 0 5mm; }
  .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm;
           border: 1px solid #000; padding: 3mm; margin-bottom: 4mm; }
  .facts dt { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .06em; color: #444; }
  .facts dd { margin: 1mm 0 0; font-size: 10.5pt; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 2mm; text-align: left; font-size: 9.5pt;
           vertical-align: top; }
  th { background: #eee; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; }
  td small { color: #444; }
  .sign { width: 28mm; }
  .empty { text-align: center; padding: 6mm 2mm; }
  .safety { margin-top: 4mm; border: 1px solid #000; padding: 3mm; font-size: 9.5pt; }
  .safety strong { display: block; font-size: 8pt; text-transform: uppercase;
                   letter-spacing: .06em; margin-bottom: 1mm; }
  .foot { margin-top: 6mm; display: flex; justify-content: space-between;
          font-size: 8.5pt; color: #444; }
  .foot span { border-top: 1px solid #000; padding-top: 1.5mm; width: 58mm; text-align: center; }
</style></head><body>
  <h1>Climb manifest</h1>
  <p class="sub">Trailbound · generated ${escapeHtml(new Date().toLocaleString("en-PH"))}</p>

  <dl class="facts">
    <div><dt>Trail</dt><dd>${escapeHtml(b.trail_name || "—")}</dd></div>
    <div><dt>Date</dt><dd>${escapeHtml(prettyDate(b.date))}</dd></div>
    <div><dt>Start time</dt><dd>${escapeHtml(prettyTime(b.departure_time) || "—")}</dd></div>
    <div><dt>Party size</dt><dd>${escapeHtml(String(climbers.length || b.group_size || "—"))}</dd></div>
    <div><dt>Guide</dt><dd>${escapeHtml(b.guide_name || "—")}</dd></div>
    <div><dt>Package</dt><dd>${escapeHtml(b.package_name || "—")}</dd></div>
    <div><dt>Permit</dt><dd>${escapeHtml(permitLabel(permit.status))}</dd></div>
    <div><dt>Reference</dt><dd>${escapeHtml(permit.reference || "—")}</dd></div>
  </dl>

  <table>
    <thead><tr>
      <th>#</th><th>Name</th><th>Age</th><th>Sex</th><th>Mobile</th>
      <th>Emergency contact</th><th>Notes</th><th>Signature</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="safety">
    <strong>Nearest hospital</strong>
    ${escapeHtml(hospital.name)}${hospital.town ? `, ${escapeHtml(hospital.town)}` : ""}${
      hospital.phone ? ` — ${escapeHtml(hospital.phone)}` : ""
    }
  </div>

  <div class="foot">
    <span>Guide signature</span>
    <span>Barangay / LGU officer</span>
    <span>Date and time out</span>
  </div>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) {
    window.alert("Your browser blocked the print window. Allow pop-ups for this page and try again.");
    return;
  }
  win.document.write(html);
  win.document.close();
  // Let the new document lay out before the print dialog measures it.
  win.addEventListener("load", () => win.print());
}
