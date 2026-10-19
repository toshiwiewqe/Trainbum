/* ==========================================================
   Admin — Guide Schedules
   ----------------------------------------------------------
   Who is guiding what, for one week, with a button that emails
   each guide their own list.

   WHY THIS EXISTS INSTEAD OF TWENTY GUIDE LOGINS
   Asking twenty guides to create accounts to read one list a
   week is a lot of friction for very little. This keeps the
   schedule where the admin already works and pushes it out to
   the guides where they already read things.

   ON "WEEKLY"
   The send is a button, not a timer. EmailJS runs in this
   browser, so something has to be open and clicked — there is
   no server here to wake up on a Monday. A genuinely scheduled
   send needs Firebase Cloud Functions, which needs the Blaze
   plan. Call this a weekly routine, not an automatic one.

   SETUP — ONE NEW EMAILJS TEMPLATE
   The template in login.html is the OTP one; its variables are
   to_email / to_name / code, which can't carry a schedule. Make
   a second template with these variables:

       {{to_name}}      the guide's name
       {{to_email}}     their address  (set as the "To" field)
       {{subject}}      e.g. "Your climbs, Oct 20 - Oct 26"
       {{message}}      the schedule itself, already formatted

   then paste its id into EMAILJS_TEMPLATE_ID below.
   ========================================================== */

import {
  attachLogoutConfirm,
  escapeHtml,
  renderAdminSidebarProfile,
  requireAdmin,
  watchBookings,
  watchGuides,
} from "./trailbound-data.js";

/* ---------- EmailJS ----------
   Service and public key are the same ones login.html already
   uses. Only the template is new. */
const EMAILJS_PUBLIC_KEY = "sWgeXKnDZsScYJZ3z";
const EMAILJS_SERVICE_ID = "service_s7cro69";
const EMAILJS_TEMPLATE_ID = "template_fdflbq9";

const DAYS = 7;

let guides = [];
let bookings = [];
let weekStart = "";

/* ---------- dates ---------- */

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Parsed as local. `new Date("2026-10-20")` is midnight UTC, which
    is the previous evening here and shifts every weekday by one. */
function fromISO(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** The coming Monday, or today if today is Monday. */
function nextMonday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const shift = (8 - (now.getDay() || 7)) % 7; // Sunday = 7
  now.setDate(now.getDate() + shift);
  return toISO(now);
}

function weekEnd(startISO) {
  const start = fromISO(startISO);
  if (!start) return "";
  start.setDate(start.getDate() + DAYS - 1);
  return toISO(start);
}

function niceDate(iso, withYear = false) {
  const d = fromISO(iso);
  if (!d) return iso || "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function weekday(iso) {
  const d = fromISO(iso);
  return d ? d.toLocaleDateString("en-US", { weekday: "short" }) : "";
}

function niceTime(value) {
  const m = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/* ---------- grouping ---------- */

/** Every guide, each with the climbs assigned to them in the week.
    Cancelled bookings are left out — nobody should be planning
    around a climb that isn't happening. */
function buildWeek() {
  const start = weekStart;
  const end = weekEnd(start);

  const inWeek = bookings.filter(
    (b) => b.status !== "cancelled" && b.date >= start && b.date <= end,
  );

  return guides
    .filter((g) => g.isActive && !g.archived)
    .map((g) => ({
      guide: g,
      climbs: inWeek
        .filter((b) => b.guideId === g.id)
        .sort((a, b) =>
          a.date === b.date
            ? String(a.departureTime || "").localeCompare(String(b.departureTime || ""))
            : a.date.localeCompare(b.date),
        ),
    }))
    .sort((a, b) => b.climbs.length - a.climbs.length || a.guide.fullName.localeCompare(b.guide.fullName));
}

/* ---------- the email ---------- */

/** Plain text, because it has to be readable on a phone in a jeepney
    with one bar of signal. */
export function buildMessage(entry, startISO) {
  const { guide, climbs } = entry;
  const lines = [];

  lines.push(`Hi ${guide.fullName},`);
  lines.push("");
  lines.push(
    `Here are your climbs for ${niceDate(startISO)} – ${niceDate(weekEnd(startISO), true)}:`,
  );
  lines.push("");

  climbs.forEach((b) => {
    const time = niceTime(b.departureTime);
    lines.push(`${weekday(b.date)} ${niceDate(b.date)}${time ? ` · ${time}` : " · time TBC"}`);
    lines.push(`  ${b.trailName} — ${b.groupSize} ${b.groupSize === 1 ? "hiker" : "hikers"}`);
    lines.push(`  Booking #${b.orderId}${b.packageName ? ` · ${b.packageName}` : ""}`);
    lines.push(`  Hiker: ${b.customerName}${b.phone ? ` · ${b.phone}` : ""}`);
    lines.push(
      b.emergencyName || b.emergencyNumber
        ? `  Emergency: ${b.emergencyName || "—"}${b.emergencyNumber ? ` · ${b.emergencyNumber}` : ""}`
        : `  Emergency: NOT PROVIDED — please ask on the day`,
    );
    lines.push("");
  });

  lines.push("Reply to this email if anything looks wrong.");
  lines.push("");
  lines.push("— Trailbound");

  return lines.join("\n");
}

function buildSubject(startISO) {
  return `Your climbs, ${niceDate(startISO)} – ${niceDate(weekEnd(startISO), true)}`;
}

/* ---------- rendering ---------- */

function climbRowHTML(b) {
  const time = niceTime(b.departureTime);
  const emergency =
    b.emergencyName || b.emergencyNumber
      ? `${escapeHtml(b.emergencyName || "—")}${b.emergencyNumber ? ` · ${escapeHtml(b.emergencyNumber)}` : ""}`
      : `<span class="sched-missing">Not provided</span>`;

  return `
    <tr>
      <td class="sched-when">
        ${escapeHtml(weekday(b.date))} ${escapeHtml(niceDate(b.date))}
        ${
          time
            ? `<span class="sched-time">${escapeHtml(time)}</span>`
            : `<span class="sched-time sched-time--none">No time</span>`
        }
      </td>
      <td>${escapeHtml(b.trailName)}<br><span class="sched-guide-mail">${b.groupSize} ${
        b.groupSize === 1 ? "hiker" : "hikers"
      } · #${escapeHtml(b.orderId)}</span></td>
      <td>${escapeHtml(b.customerName)}${b.phone ? `<br><span class="sched-guide-mail">${escapeHtml(b.phone)}</span>` : ""}</td>
      <td>${emergency}</td>
    </tr>`;
}

function guideHTML(entry) {
  const { guide, climbs } = entry;
  const hasMail = Boolean(String(guide.contact || "").trim());

  return `
    <section class="sched-guide" data-guide="${escapeHtml(guide.id)}">
      <header class="sched-guide-head">
        <span class="sched-guide-name">${escapeHtml(guide.fullName)}</span>
        <span class="sched-guide-mail${hasMail ? "" : " sched-guide-mail--missing"}">
          ${hasMail ? escapeHtml(guide.contact) : "No contact email on this guide"}
        </span>
        <span class="sched-count">${climbs.length} climb${climbs.length === 1 ? "" : "s"}</span>
        <span class="sched-spacer"></span>
        <button type="button" class="sched-btn sched-btn--ghost" data-preview="${escapeHtml(guide.id)}">Preview</button>
        <button type="button" class="sched-btn" data-send="${escapeHtml(guide.id)}" ${hasMail ? "" : "disabled"}>Email</button>
      </header>
      <table class="sched-climbs">
        <thead>
          <tr><th>When</th><th>Trail</th><th>Hiker</th><th>Emergency contact</th></tr>
        </thead>
        <tbody>${climbs.map(climbRowHTML).join("")}</tbody>
      </table>
    </section>`;
}

function render() {
  const week = buildWeek();
  const busy = week.filter((e) => e.climbs.length > 0);
  const quiet = week.filter((e) => e.climbs.length === 0);

  const climbs = busy.reduce((sum, e) => sum + e.climbs.length, 0);
  const hikers = busy.reduce(
    (sum, e) => sum + e.climbs.reduce((n, b) => n + (Number(b.groupSize) || 0), 0),
    0,
  );

  setText("stat-climbs", climbs);
  setText("stat-guides", busy.length);
  setText("stat-hikers", hikers);
  setText(
    "sched-range",
    `${niceDate(weekStart)} – ${niceDate(weekEnd(weekStart), true)}`,
  );

  const host = document.getElementById("sched-list");
  host.innerHTML = busy.length
    ? busy.map(guideHTML).join("")
    : `<p class="admin-empty">No climbs booked that week.</p>`;

  const quietHost = document.getElementById("sched-quiet");
  quietHost.innerHTML = quiet.length
    ? `<div class="sched-quiet"><strong>${quiet.length} guide${
        quiet.length === 1 ? " has" : "s have"
      } nothing that week:</strong> ${quiet.map((e) => escapeHtml(e.guide.fullName)).join(", ")}. They won't be emailed.</div>`
    : "";

  // Nothing to send is not the same as a broken button — say which.
  const sendAll = document.getElementById("send-all");
  sendAll.disabled = busy.filter((e) => String(e.guide.contact || "").trim()).length === 0;
}

function setText(id, value) {
  const n = document.getElementById(id);
  if (n) n.textContent = value;
}

function log(message, cls = "") {
  const host = document.getElementById("sched-log");
  if (host.dataset.empty === "true") {
    host.textContent = "";
    host.dataset.empty = "false";
  }
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = message;
  host.appendChild(line);
  host.scrollTop = host.scrollHeight;
}

/* ---------- sending ---------- */

function emailReady() {
  if (typeof window.emailjs === "undefined") {
    log("EmailJS didn't load. Check the script tag at the bottom of the page.", "bad");
    return false;
  }
  if (EMAILJS_TEMPLATE_ID.startsWith("REPLACE_")) {
    log(
      "No schedule template set yet. Make one in EmailJS and paste its id into\n" +
        "EMAILJS_TEMPLATE_ID at the top of admin-schedules.js. See the notes there.",
      "bad",
    );
    return false;
  }
  return true;
}

async function sendTo(entry) {
  const address = String(entry.guide.contact || "").trim();
  if (!address) {
    log(`skip  ${entry.guide.fullName} — no contact email`, "bad");
    return false;
  }

  try {
    await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: address,
      to_name: entry.guide.fullName,
      subject: buildSubject(weekStart),
      message: buildMessage(entry, weekStart),
    });
    log(`sent  ${entry.guide.fullName} → ${address} (${entry.climbs.length} climbs)`, "ok");
    return true;
  } catch (err) {
    log(`FAIL  ${entry.guide.fullName} → ${address}\n      ${err?.text || err?.message || err}`, "bad");
    return false;
  }
}

/* ---------- wiring ---------- */

requireAdmin((user) => {
  renderAdminSidebarProfile(user, {
    avatarImg: document.getElementById("admin-avatar"),
    avatarFallback: document.getElementById("admin-avatar-fallback"),
    nameEl: document.getElementById("admin-name"),
  });

  attachLogoutConfirm(document.getElementById("admin-logout-btn"));

  weekStart = nextMonday();
  const picker = document.getElementById("week-start");
  picker.value = weekStart;
  picker.addEventListener("change", () => {
    weekStart = picker.value || nextMonday();
    render();
  });

  if (typeof window.emailjs !== "undefined") {
    window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
  }

  watchGuides(
    (items) => {
      guides = items;
      render();
    },
    { activeOnly: true },
  );

  watchBookings((items) => {
    bookings = items;
    render();
  });
});

/* One listener on the list — the cards are rebuilt on every date
   change, and per-card listeners would be rebound each time. */
document.getElementById("sched-list").addEventListener("click", async (e) => {
  const previewBtn = e.target.closest("[data-preview]");
  const sendBtn = e.target.closest("[data-send]");
  if (!previewBtn && !sendBtn) return;

  const id = (previewBtn || sendBtn).dataset.preview || sendBtn.dataset.send;
  const entry = buildWeek().find((x) => x.guide.id === id);
  if (!entry) return;

  if (previewBtn) {
    document.getElementById("preview-to").textContent =
      `${entry.guide.fullName} · ${entry.guide.contact || "no email"}`;
    document.getElementById("preview-body").textContent = buildMessage(entry, weekStart);
    document.getElementById("preview-dialog").showModal();
    return;
  }

  sendBtn.disabled = true;
  if (emailReady()) await sendTo(entry);
  sendBtn.disabled = false;
});

document.getElementById("send-all").addEventListener("click", async () => {
  const btn = document.getElementById("send-all");
  const targets = buildWeek().filter(
    (e) => e.climbs.length > 0 && String(e.guide.contact || "").trim(),
  );

  if (!targets.length) return;
  if (!window.confirm(`Email ${targets.length} guide(s) their schedule for this week?`)) return;
  if (!emailReady()) return;

  btn.disabled = true;
  let ok = 0;
  // One at a time: EmailJS rate-limits bursts, and a failure should
  // name the guide it belongs to rather than the whole batch.
  for (const entry of targets) {
    if (await sendTo(entry)) ok += 1;
  }
  log(`\nDone. ${ok} of ${targets.length} sent.`, ok === targets.length ? "ok" : "bad");
  btn.disabled = false;
});

document.getElementById("preview-close").addEventListener("click", () => {
  document.getElementById("preview-dialog").close();
});
