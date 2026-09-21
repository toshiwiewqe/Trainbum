/* ==========================================================
   Admin — Booking catalog (trails / guides / packages)
   ----------------------------------------------------------
   The missing half of the admin panel. booking.js builds its three
   dropdowns from exactly these collections:

     trails    -> "Select trail"
     packages  -> the package cards
     guides    -> "Certified guide", filtered to the guides listed
                  on the chosen trail AND with status "Active"

   Nothing in the panel managed them, so the only way to add a trail
   was by hand in the Firebase console. Saving here changes what a
   customer can book, live.

   One detail worth knowing: booking.js reads these with
   `snap.docs.map(d => d.data())` — it discards the Firestore
   document id and keys everything off the business id INSIDE the
   document (trail_id, guide_id, package_id). Those fields are
   load-bearing, so this page always writes one, generating a slug
   from the name when the field is left blank.
   ========================================================== */

import {
  archiveGuide,
  archivePackage,
  archiveTrail,
  attachLogoutConfirm,
  collectUnsubscribers,
  deleteGuide,
  deletePackage,
  deleteTrail,
  restoreGuide,
  restorePackage,
  restoreTrail,
  escapeHtml,
  peso,
  renderAdminSidebarProfile,
  requireAdmin,
  saveGuide,
  savePackage,
  saveTrail,
  slugify,
  watchGuides,
  watchPackages,
  watchTrails
} from "./trailbound-data.js";

const track = collectUnsubscribers();

const el = {
  search: document.getElementById("catalog-search"),
  head: document.getElementById("catalog-head"),
  body: document.getElementById("catalog-body"),
  feedback: document.getElementById("catalog-feedback"),
  modal: document.getElementById("catalog-modal"),
  backdrop: document.getElementById("catalog-modal-backdrop"),
  form: document.getElementById("catalog-form"),
  fields: document.getElementById("catalog-form-fields"),
  title: document.getElementById("catalog-modal-title"),
  kicker: document.getElementById("catalog-modal-kicker"),
  addBtn: document.getElementById("catalog-add-btn"),
  avatarImg: document.getElementById("admin-avatar"),
  avatarFallback: document.getElementById("admin-avatar-fallback"),
  nameEl: document.getElementById("admin-name"),
  logoutBtn: document.getElementById("admin-logout-btn")
};

let trails = [];
let guides = [];
let packages = [];
let tab = "trails";
let editing = null;
/** Archived records are hidden by default; this toggles them back in. */
let showArchived = false;

attachLogoutConfirm(el.logoutBtn);

requireAdmin((user) => {
  renderAdminSidebarProfile(user, {
    avatarImg: el.avatarImg,
    avatarFallback: el.avatarFallback,
    nameEl: el.nameEl
  });

  track(
    watchTrails(
      (items) => {
        trails = items;
        renderStats();
        render();
      },
      {
        includeArchived: true,
        onError: () => showFeedback("Trails could not be loaded. Check your Firestore rules.")
      }
    )
  );
  track(
    watchGuides(
      (items) => {
        guides = items;
        renderStats();
        render();
      },
      { includeArchived: true }
    )
  );
  track(
    watchPackages(
      (items) => {
        packages = items;
        renderStats();
        render();
      },
      { includeArchived: true }
    )
  );
});

/* ---------- stats ---------- */

function renderStats() {
  // Archived records are still in `trails`/`guides` so the archived
  // view can show them, but they must never count towards "what a
  // customer can book right now".
  const liveTrails = trails.filter((t) => !t.archived);
  const openTrails = liveTrails.filter((t) => t.isOpen);
  const activeGuides = guides.filter((g) => g.isActive && !g.archived);
  const activeGuideIds = new Set(activeGuides.map((g) => g.id));

  // A trail is only really bookable if at least one of its listed
  // guides is active — otherwise the guide dropdown comes up empty
  // and the customer can't complete the form.
  const bookable = openTrails.filter((t) =>
    t.guideIds.some((id) => activeGuideIds.has(id))
  );

  setText("stat-trails", liveTrails.length);
  setText("stat-trails-delta", `${openTrails.length} open`);
  setText("stat-guides", guides.filter((g) => !g.archived).length);
  setText("stat-guides-delta", `${activeGuides.length} active`);
  setText("stat-packages", packages.filter((p) => !p.archived).length);
  setText(
    "stat-packages-delta",
    packages.filter((p) => !p.archived).length
      ? `from ${peso(Math.min(...packages.filter((p) => !p.archived).map((p) => p.pricePerPax)))}/pax`
      : ""
  );
  setText("stat-bookable", bookable.length);

  // FIXED: this only ever called showFeedback, never cleared it. The
  // trails stream arrives before the guides stream, so on first paint
  // there were 0 active guides, the warning fired, and nothing ever
  // took it down — even once every trail had a guide.
  if (openTrails.length && !bookable.length && activeGuides.length) {
    showFeedback(
      `None of your ${openTrails.length} open trails has an active guide assigned. ` +
        "The guide dropdown on the booking page will be empty, so customers can't complete a booking. " +
        "Open a trail and tick at least one guide."
    );
  } else {
    hideFeedback();
  }
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function showFeedback(message) {
  el.feedback.textContent = message;
  el.feedback.hidden = false;
}

function hideFeedback() {
  el.feedback.hidden = true;
}

/* ---------- tabs ---------- */

document.querySelectorAll(".admin-tab").forEach((button) =>
  button.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach((b) => b.classList.remove("is-active"));
    button.classList.add("is-active");
    tab = button.dataset.tab;
    render();
  })
);

/* ---------- rendering ---------- */

const HEADS = {
  trails: ["Preview", "Trail", "Location & difficulty", "From", "Guides", "Status", "Actions"],
  guides: ["Guide", "Specialty", "Rating", "ID", "Status", "Actions"],
  packages: ["Package", "Includes", "Price / pax", "Activity choice", "ID", "Actions"]
};

function matches(text) {
  const term = (el.search.value || "").trim().toLowerCase();
  return !term || String(text).toLowerCase().includes(term);
}

/** Archived rows only appear when the toggle is on. */
function inView(item) {
  return showArchived ? item.archived : !item.archived;
}

function renderArchiveToggle() {
  const archivedCount = [...trails, ...guides, ...packages].filter((i) => i.archived).length;
  let bar = document.getElementById("catalog-archive-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "catalog-archive-bar";
    bar.className = "admin-archive-bar";
    document.querySelector(".admin-tabs")?.after(bar);
    bar.addEventListener("click", (e) => {
      if (!e.target.closest("#catalog-archive-toggle")) return;
      showArchived = !showArchived;
      render();
    });
  }
  bar.innerHTML = `
    <button id="catalog-archive-toggle" type="button" class="admin-archive-toggle${
      showArchived ? " is-on" : ""
    }">${showArchived ? "← Back to active" : `Archived (${archivedCount})`}</button>
    ${
      showArchived
        ? '<span class="admin-archive-hint">Archived items are hidden from customers but nothing has been lost. Restore returns them; delete is permanent.</span>'
        : ""
    }`;
}

function render() {
  renderArchiveToggle();
  el.head.innerHTML = `<tr>${HEADS[tab].map((h) => `<th>${h}</th>`).join("")}</tr>`;
  el.addBtn.textContent = `+ Add ${{ trails: "Trail", guides: "Guide", packages: "Package" }[tab]}`;
  el.addBtn.hidden = showArchived;

  const rows =
    tab === "trails" ? trailRows() : tab === "guides" ? guideRows() : packageRows();

  if (!rows) {
    el.body.innerHTML = `<tr><td colspan="7" class="admin-empty">${
      showArchived
        ? "Nothing archived here."
        : "Nothing here yet. Add one to make it available on the booking page."
    }</td></tr>`;
    return;
  }
  el.body.innerHTML = rows;
}

function actions(docId) {
  // Archive is the default. Permanent delete only exists in the
  // archived view, so it takes two deliberate steps to lose data.
  return showArchived
    ? `<div class="admin-product-actions">
         <button type="button" data-action="restore" data-id="${docId}">Restore</button>
         <button type="button" data-action="delete" data-id="${docId}" class="is-danger">Delete forever</button>
       </div>`
    : `<div class="admin-product-actions">
         <button type="button" data-action="edit" data-id="${docId}">Edit</button>
         <button type="button" data-action="archive" data-id="${docId}">Archive</button>
       </div>`;
}

function trailRows() {
  const guideName = (id) => guides.find((g) => g.id === id);

  return trails
    .filter(inView)
    .filter((t) => matches(`${t.name} ${t.location} ${t.difficulty} ${t.trailId}`))
    .map((t) => {
      const assigned = t.guideIds.map(guideName).filter(Boolean);
      const active = assigned.filter((g) => g.isActive);
      const missing = t.guideIds.length - assigned.length;

      return `<tr>
        <td>${
          t.image
            ? `<img class="admin-product-thumb" src="${escapeHtml(t.image)}" alt="" loading="lazy">`
            : '<div class="admin-product-thumb"></div>'
        }</td>
        <td><strong>${escapeHtml(t.name)}</strong><small>${escapeHtml(
        t.trailId || "no trail_id — customers can't select this"
      )}</small></td>
        <td>${escapeHtml([t.difficulty, t.location, t.duration].filter(Boolean).join(" · ") || "—")}</td>
        <td>${
          t.basePrice
            ? peso(t.basePrice)
            : '<span class="admin-product-status admin-product-status--inactive">not set</span>'
        }</td>
        <td>${
          t.guideIds.length
            ? `${active.length}/${t.guideIds.length} active${
                missing ? `<div class="admin-table-subtext">${missing} unknown id</div>` : ""
              }`
            : '<span class="admin-product-status admin-product-status--inactive">none</span>'
        }</td>
        <td><span class="admin-product-status admin-product-status--${
          t.isOpen ? "active" : "inactive"
        }">${escapeHtml(t.status)}</span></td>
        <td>${actions(t.docId)}</td>
      </tr>`;
    })
    .join("");
}

function guideRows() {
  return guides
    .filter(inView)
    .filter((g) => matches(`${g.fullName} ${g.specialty} ${g.guideId}`))
    .map(
      (g) => `<tr>
      <td><strong>${escapeHtml(g.fullName)}</strong></td>
      <td>${escapeHtml(g.specialty || "—")}</td>
      <td>${g.rating ? `★ ${g.rating}` : "—"}</td>
      <td><small>${escapeHtml(g.guideId || "—")}</small></td>
      <td><span class="admin-product-status admin-product-status--${
        g.isActive ? "active" : "inactive"
      }">${escapeHtml(g.status)}</span></td>
      <td>${actions(g.docId)}</td>
    </tr>`
    )
    .join("");
}

function packageRows() {
  return packages
    .filter(inView)
    .filter((p) => matches(`${p.name} ${p.includes.join(" ")} ${p.packageId}`))
    .map(
      (p) => `<tr>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td><small>${escapeHtml(p.includes.join(", ") || "—")}</small></td>
      <td>${peso(p.pricePerPax)}</td>
      <td>${p.requiresActivityChoice ? "Required" : "—"}</td>
      <td><small>${escapeHtml(p.packageId || "—")}</small></td>
      <td>${actions(p.docId)}</td>
    </tr>`
    )
    .join("");
}

el.search?.addEventListener("input", render);

/* ---------- modal ---------- */

const field = (label, id, attrs = "", type = "input") =>
  type === "textarea"
    ? `<label>${label}<textarea id="${id}" ${attrs}></textarea></label>`
    : `<label>${label}<input id="${id}" ${attrs}></label>`;

const section = (title, inner) =>
  `<section class="admin-form-section">
     <h4 class="admin-form-section-title">${title}</h4>
     <div class="admin-form-section-body">${inner}</div>
   </section>`;

function formHtml(item) {
  if (tab === "trails") {
    const chosen = item?.guideIds || [];
    return (
      section(
        "Basics",
        `${field("Trail name", "f-name", 'required maxlength="80" placeholder="Mt. Pulag Traverse"')}
         <div class="admin-product-form-row">
           ${field("Location", "f-location", 'placeholder="Benguet"')}
           ${field("Difficulty", "f-difficulty", 'placeholder="Hard"')}
         </div>
         <div class="admin-product-form-row">
           ${field("Duration", "f-duration", 'placeholder="2 days"')}
           <label>Status<select id="f-status"><option value="Open">Open</option><option value="Closed">Closed</option></select></label>
         </div>`
      ) +
      section(
        "Listing",
        `${field(
          "Price shown on the trails page",
          "f-baseprice",
          'type="number" min="0" step="1" placeholder="1500"'
        )}
         ${field("Description", "f-description", 'rows="3" placeholder="What makes this trail worth booking?"', "textarea")}
         ${field("Image URL or path", "f-image", 'placeholder="public/trails/pulag.jpg"')}`
      ) +
      section(
        `Guides <span class="admin-form-count" id="f-guides-count">${chosen.length} selected</span>`,
        guides.length
          ? `<div class="admin-checkbox-list" id="f-guides">${guides
              .map(
                (g) => `<label class="admin-checkbox-row${g.isActive ? "" : " is-muted"}">
                  <input type="checkbox" value="${escapeHtml(g.id)}">
                  <span>${escapeHtml(g.fullName)}${g.isActive ? "" : " · inactive"}</span>
                </label>`
              )
              .join("")}</div>
             <p class="admin-form-hint">Only guides ticked here appear on this trail's booking form.</p>`
          : '<p class="admin-form-hint">No guides yet — add one on the Guides tab first.</p>'
      ) +
      section(
        "Advanced",
        `<div class="admin-product-form-row">
           ${field("Latitude", "f-lat", 'type="number" step="0.0001" placeholder="16.5960"')}
           ${field("Longitude", "f-lon", 'type="number" step="0.0001" placeholder="120.8990"')}
         </div>
         ${field("Trail ID", "f-id", 'placeholder="leave blank to generate from the name"')}
         <p class="admin-form-hint">Coordinates sharpen the weather forecast. The ID is what the booking page matches on.</p>`
      )
    );
  }

  if (tab === "guides") {
    return (
      section(
        "Guide",
        `${field("Full name", "f-name", 'required maxlength="80" placeholder="Juan Dela Cruz"')}
         ${field("Specialty", "f-specialty", 'placeholder="High-altitude traverses"')}
         <div class="admin-product-form-row">
           ${field("Rating", "f-rating", 'type="number" min="0" max="5" step="0.1" placeholder="4.8"')}
           <label>Status<select id="f-status"><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
         </div>`
      ) +
      section(
        "Advanced",
        `${field("Guide ID", "f-id", 'placeholder="leave blank to generate from the name"')}
         <p class="admin-form-hint">An inactive guide stays on file but is never offered to customers.</p>`
      )
    );
  }

  return (
    section(
      "Package",
      `${field("Package name", "f-name", 'required maxlength="80" placeholder="Summit Standard"')}
       ${field("Price per pax (PHP)", "f-price", 'type="number" min="0" step="1" required placeholder="2500"')}
       ${field("Includes", "f-includes", 'rows="3" placeholder="Guide fee, Permits, Transport"', "textarea")}
       <p class="admin-form-hint">Separate each inclusion with a comma.</p>`
    ) +
    section(
      "Options",
      `<label class="admin-checkbox-row admin-checkbox-row--boxed">
         <input type="checkbox" id="f-activity">
         <span>Customer must choose an activity</span>
       </label>
       ${field("Package ID", "f-id", 'placeholder="leave blank to generate from the name"')}`
    )
  );
}

function openModal(item = null) {
  editing = item;
  const noun = { trails: "Trail", guides: "Guide", packages: "Package" }[tab];
  el.title.textContent = `${item ? "Edit" : "Add"} ${noun}`;
  el.kicker.textContent = "Booking catalog";
  el.fields.innerHTML = formHtml(item);

  if (item) fillForm(item);

  // Keep the "n selected" counter honest as boxes are ticked.
  const counter = document.getElementById("f-guides-count");
  const boxes = [...document.querySelectorAll("#f-guides input")];
  if (counter && boxes.length) {
    const sync = () => {
      const n = boxes.filter((b) => b.checked).length;
      counter.textContent = `${n} selected`;
      counter.classList.toggle("is-empty", n === 0);
    };
    boxes.forEach((b) => b.addEventListener("change", sync));
    sync();
  }

  el.modal.hidden = false;
  el.backdrop.hidden = false;
}

function fillForm(item) {
  const set = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.value = value ?? "";
  };

  if (tab === "trails") {
    set("f-name", item.name);
    set("f-location", item.location);
    set("f-difficulty", item.difficulty);
    set("f-duration", item.duration);
    set("f-description", item.description);
    set("f-image", item.image);
    set("f-baseprice", item.basePrice || "");
    set("f-lat", item.lat ?? "");
    set("f-lon", item.lon ?? "");
    set("f-id", item.trailId);
    set("f-status", item.isOpen ? "Open" : "Closed");
    document.querySelectorAll("#f-guides input").forEach((input) => {
      input.checked = item.guideIds.includes(input.value);
    });
    return;
  }

  if (tab === "guides") {
    set("f-name", item.fullName);
    set("f-specialty", item.specialty);
    set("f-rating", item.rating || "");
    set("f-status", item.status);
    set("f-id", item.guideId);
    return;
  }

  set("f-name", item.name);
  set("f-price", item.pricePerPax);
  set("f-includes", item.includes.join(", "));
  set("f-id", item.packageId);
  const activity = document.getElementById("f-activity");
  if (activity) activity.checked = item.requiresActivityChoice;
}

function closeModal() {
  el.modal.hidden = true;
  el.backdrop.hidden = true;
  el.fields.innerHTML = "";
  editing = null;
}

el.addBtn?.addEventListener("click", () => openModal());
document.getElementById("catalog-modal-close")?.addEventListener("click", closeModal);
document.getElementById("catalog-modal-cancel")?.addEventListener("click", closeModal);
el.backdrop?.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.modal.hidden) closeModal();
});

/* ---------- save ---------- */

el.form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = el.form.querySelector('button[type="submit"]');
  submit.disabled = true;
  hideFeedback();

  const value = (id) => document.getElementById(id)?.value ?? "";

  try {
    if (tab === "trails") {
      await saveTrail(
        {
          name: value("f-name"),
          location: value("f-location"),
          difficulty: value("f-difficulty"),
          duration: value("f-duration"),
          description: value("f-description"),
          image: value("f-image"),
          basePrice: value("f-baseprice"),
          lat: value("f-lat"),
          lon: value("f-lon"),
          status: value("f-status"),
          trailId: value("f-id") || slugify(value("f-name")),
          guideIds: [...document.querySelectorAll("#f-guides input:checked")].map(
            (input) => input.value
          )
        },
        editing?.docId || null,
        editing
      );
    } else if (tab === "guides") {
      await saveGuide(
        {
          fullName: value("f-name"),
          specialty: value("f-specialty"),
          rating: value("f-rating"),
          status: value("f-status"),
          guideId: value("f-id") || slugify(value("f-name"))
        },
        editing?.docId || null,
        editing
      );
    } else {
      await savePackage(
        {
          name: value("f-name"),
          pricePerPax: value("f-price"),
          includes: value("f-includes"),
          requiresActivityChoice: document.getElementById("f-activity")?.checked,
          packageId: value("f-id") || slugify(value("f-name"))
        },
        editing?.docId || null,
        editing
      );
    }
    closeModal();
    // The live streams re-render the table on their own.
  } catch (err) {
    console.error("Catalog save failed:", err);
    showFeedback("That could not be saved. Check your Firestore rules.");
  } finally {
    submit.disabled = false;
  }
});

/* ---------- row actions ---------- */

el.body?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const list = tab === "trails" ? trails : tab === "guides" ? guides : packages;
  const item = list.find((entry) => entry.docId === button.dataset.id);
  if (!item) return;

  const label = item.name || item.fullName;
  const act = button.dataset.action;

  if (act === "edit") return openModal(item);

  try {
    if (act === "restore") {
      const restore = { trails: restoreTrail, guides: restoreGuide, packages: restorePackage }[tab];
      await restore(item.docId, label);
      return;
    }

    if (act === "archive") {
      // Warn about knock-on effects before hiding something other
      // records point at.
      let warning = "";
      if (tab === "guides") {
        const used = trails.filter((t) => !t.archived && t.guideIds.includes(item.id));
        if (used.length) {
          warning = `\n\n${used.length} trail(s) list this guide: ${used
            .map((t) => t.name)
            .join(", ")}. They'll lose them from their booking form.`;
        }
      }
      if (
        !window.confirm(
          `Archive "${label}"?${warning}\n\nIt disappears for customers but stays in Firestore, and you can restore it from the Archived view.`
        )
      ) {
        return;
      }
      const archive = { trails: archiveTrail, guides: archiveGuide, packages: archivePackage }[tab];
      await archive(item.docId, label);
      return;
    }

    if (act === "delete") {
      if (
        !window.confirm(
          `Permanently delete "${label}"?\n\nThis cannot be undone and the record leaves Firestore for good. Restore instead if you might want it back.`
        )
      ) {
        return;
      }
      if (window.prompt('Type DELETE to confirm.') !== "DELETE") return;
      const remove = { trails: deleteTrail, guides: deleteGuide, packages: deletePackage }[tab];
      await remove(item.docId, label);
    }
  } catch (err) {
    console.error("Catalog action failed:", err);
    showFeedback("That could not be saved. Check your Firestore rules.");
  }
});