/* ==========================================================
   Admin — Activity Log
   ----------------------------------------------------------
   The accountability view. Every mutation the panel makes is
   written to `activity` by logAudit() in trailbound-data.js, with
   the actor's name and — for edits — the exact fields that changed
   and what they were before.

   So "who dropped the price on Mt. Pulag?" and "who deleted that
   guide last Tuesday?" are both answerable here, by anyone on the
   team, without opening Firestore.

   The log is append-only. firestore.rules permits create and read
   but denies update and delete to everyone, admins included — an
   audit trail an admin can quietly edit is not an audit trail.
   ========================================================== */

import {
  attachLogoutConfirm,
  collectUnsubscribers,
  describeError,
  escapeHtml,
  peso,
  renderAdminSidebarProfile,
  requireAdmin,
  timeAgo,
  toDate,
  watchActivity
} from "./trailbound-data.js";

const track = collectUnsubscribers();

const el = {
  search: document.getElementById("log-search"),
  actor: document.getElementById("log-actor"),
  entity: document.getElementById("log-entity"),
  action: document.getElementById("log-action"),
  list: document.getElementById("log-list"),
  feedback: document.getElementById("log-feedback"),
  exportBtn: document.getElementById("log-export-btn"),
  avatarImg: document.getElementById("admin-avatar"),
  avatarFallback: document.getElementById("admin-avatar-fallback"),
  nameEl: document.getElementById("admin-name"),
  logoutBtn: document.getElementById("admin-logout-btn")
};

let entries = [];

/* What each action looks like at a glance. Colour carries meaning
   here — destructive actions are the ones you scan for. */
const ACTION = {
  create:  { label: "Created",  tone: "ok" },
  update:  { label: "Edited",   tone: "info" },
  status:  { label: "Status",   tone: "info" },
  archive: { label: "Archived", tone: "warn" },
  restore: { label: "Restored", tone: "ok" },
  delete:  { label: "Deleted",  tone: "bad" },
  activity:{ label: "Activity", tone: "info" }
};

const ENTITY = {
  trail: "Trail", guide: "Guide", package: "Package", product: "Gear",
  booking: "Booking", order: "Order", user: "User", settings: "Settings",
  message: "Support", system: "System"
};

attachLogoutConfirm(el.logoutBtn);

requireAdmin((user) => {
  renderAdminSidebarProfile(user, {
    avatarImg: el.avatarImg,
    avatarFallback: el.avatarFallback,
    nameEl: el.nameEl
  });

  track(
    watchActivity(
      (items) => {
        entries = items;
        buildActorFilter();
        renderStats();
        render();
      },
      {
        // Far more than the dashboard's 10 — this is the page you come
        // to when you need to find something specific.
        max: 300,
        // Without this the page would render "No activity recorded yet"
        // when Firestore actually refused the read — the opposite of
        // the truth, on the one page that must not mislead.
        onError: (err) => {
          entries = [];
          renderStats();
          render();
          if (el.feedback) {
            el.feedback.textContent = describeError(err);
            el.feedback.hidden = false;
          }
        }
      }
    )
  );
});

/* ---------- stats ---------- */

function renderStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const today = entries.filter((e) => {
    const when = toDate(e.createdAt);
    return when && when >= startOfDay;
  });

  const people = new Set(entries.map((e) => e.actorName || e.userName).filter(Boolean));
  const destructive = entries.filter((e) => ["delete", "archive"].includes(e.action));

  setText("log-total", entries.length.toLocaleString());
  setText("log-today", today.length.toLocaleString());
  setText("log-people", people.size.toLocaleString());
  setText("log-destructive", destructive.length.toLocaleString());

  const oldest = toDate(entries[entries.length - 1]?.createdAt);
  setText("log-range", oldest ? `since ${oldest.toLocaleDateString("en-PH")}` : "");
  setText(
    "log-people-delta",
    people.size ? [...people].slice(0, 2).join(", ") + (people.size > 2 ? "…" : "") : ""
  );
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

/* ---------- filters ---------- */

function buildActorFilter() {
  const current = el.actor.value;
  const people = [...new Set(entries.map((e) => e.actorName || e.userName).filter(Boolean))].sort();

  el.actor.innerHTML =
    '<option value="all">Everyone</option>' +
    people.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");

  if (people.includes(current)) el.actor.value = current;
}

function visible() {
  const term = (el.search?.value || "").trim().toLowerCase();
  const actor = el.actor?.value || "all";
  const entity = el.entity?.value || "all";
  const action = el.action?.value || "all";

  return entries.filter((e) => {
    const who = e.actorName || e.userName || "";
    if (actor !== "all" && who !== actor) return false;
    if (entity !== "all" && e.entity !== entity) return false;
    if (action !== "all" && e.action !== action) return false;
    if (!term) return true;
    return [who, e.summary, e.activity, e.entityLabel, e.entity]
      .some((v) => String(v || "").toLowerCase().includes(term));
  });
}

[el.search, el.actor, el.entity, el.action].forEach((control) =>
  control?.addEventListener(control.tagName === "SELECT" ? "change" : "input", render)
);

/* ---------- rendering ---------- */

function initials(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

function changeRows(changes) {
  if (!Array.isArray(changes) || !changes.length) return "";
  return `<div class="admin-log-changes">${changes
    .map(
      (c) => `<div class="admin-log-change">
        <span class="admin-log-change-field">${escapeHtml(c.field)}</span>
        <span class="admin-log-change-from">${escapeHtml(c.from)}</span>
        <span class="admin-log-change-arrow" aria-hidden="true">→</span>
        <span class="admin-log-change-to">${escapeHtml(c.to)}</span>
      </div>`
    )
    .join("")}</div>`;
}

function render() {
  const rows = visible();

  if (!rows.length) {
    el.list.innerHTML = entries.length
      ? '<p class="admin-empty">Nothing matches these filters.</p>'
      : '<p class="admin-empty">No activity recorded yet. Changes you make in the panel will appear here.</p>';
    return;
  }

  // Group by day, so scanning "what happened Tuesday" is one glance.
  const groups = new Map();
  rows.forEach((e) => {
    const when = toDate(e.createdAt);
    const key = when ? when.toDateString() : "Pending";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });

  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  el.list.innerHTML = [...groups.entries()]
    .map(([day, items]) => {
      const heading =
        day === today ? "Today" : day === yesterday ? "Yesterday" : day === "Pending" ? "Just now" : day;

      return `<div class="admin-log-day">
        <p class="admin-log-day-label">${escapeHtml(heading)} <span>${items.length}</span></p>
        ${items.map(entryHtml).join("")}
      </div>`;
    })
    .join("");
}

function entryHtml(e) {
  const meta = ACTION[e.action] || ACTION.activity;
  const who = e.actorName || e.userName || "Unknown";
  const when = toDate(e.createdAt);
  const photo = e.actorPhoto || e.userPhoto;

  return `<article class="admin-log-entry admin-log-entry--${meta.tone}">
    <div class="admin-log-who">
      ${
        photo
          ? `<img src="${escapeHtml(photo)}" alt="" class="admin-log-avatar" referrerpolicy="no-referrer">`
          : `<div class="admin-log-avatar admin-log-avatar--fallback">${escapeHtml(initials(who))}</div>`
      }
    </div>
    <div class="admin-log-body">
      <p class="admin-log-summary">${escapeHtml(e.summary || e.activity || "Change recorded")}</p>
      <p class="admin-log-meta">
        <strong>${escapeHtml(who)}</strong>
        ${e.actorEmail ? `<span class="admin-log-email">${escapeHtml(e.actorEmail)}</span>` : ""}
      </p>
      ${changeRows(e.changes)}
    </div>
    <div class="admin-log-side">
      <span class="admin-log-tag admin-log-tag--${meta.tone}">${meta.label}</span>
      <span class="admin-log-entity">${escapeHtml(ENTITY[e.entity] || e.entity || "")}</span>
      ${e.amount ? `<span class="admin-log-amount">${peso(e.amount)}</span>` : ""}
      <time class="admin-log-time" title="${escapeHtml(
        when ? when.toLocaleString("en-PH") : ""
      )}">${escapeHtml(timeAgo(e.createdAt) || "just now")}</time>
    </div>
  </article>`;
}

/* ---------- export ---------- */

const csvCell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;

el.exportBtn?.addEventListener("click", () => {
  const rows = [
    ["When", "Person", "Email", "Action", "Area", "Item", "Summary", "Changes"],
    ...visible().map((e) => [
      toDate(e.createdAt)?.toISOString() || "",
      e.actorName || e.userName || "",
      e.actorEmail || "",
      e.action || "",
      e.entity || "",
      e.entityLabel || "",
      e.summary || e.activity || "",
      (e.changes || []).map((c) => `${c.field}: ${c.from} -> ${c.to}`).join(" | ")
    ])
  ];

  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const link = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })),
    download: `trailbound-activity-${new Date().toISOString().slice(0, 10)}.csv`
  });
  link.click();
  URL.revokeObjectURL(link.href);
});