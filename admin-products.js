/* ==========================================================
   Admin — Products
   ----------------------------------------------------------
   This page is the publisher. A product saved here with status
   "active" appears on the customer-facing shop live, via the same
   watchProducts() stream (with activeOnly: true).

   Setting one to "inactive" pulls it from the storefront just as
   fast, without deleting the record.

   Two-stage removal, same as the catalog:

     Archive  -> hidden everywhere (including this list), status
                 forced to "inactive", record untouched in Firestore.
     Delete   -> only offered from the Archived view, needs a typed
                 confirmation, and is irreversible.

   Every save, toggle, archive and delete is written to the activity
   log with the actor's name and — for edits — the exact fields that
   changed. See admin-activity.html.
   ========================================================== */

import {
  archiveProduct,
  attachLogoutConfirm,
  collectUnsubscribers,
  deleteProduct,
  describeError,
  escapeHtml,
  peso,
  renderAdminSidebarProfile,
  requireAdmin,
  restoreProduct,
  saveProduct,
  setProductStatus,
  watchProducts
} from "./trailbound-data.js";

const track = collectUnsubscribers();

const el = {
  list: document.getElementById("product-list"),
  search: document.getElementById("product-search"),
  statusFilter: document.getElementById("product-status-filter"),
  feedback: document.getElementById("product-feedback"),
  modal: document.getElementById("product-modal"),
  backdrop: document.getElementById("product-modal-backdrop"),
  form: document.getElementById("product-form"),
  modalTitle: document.getElementById("product-modal-title"),
  panelHeader: document.querySelector(".admin-products-panel .admin-panel-header"),
  avatarImg: document.getElementById("admin-avatar"),
  avatarFallback: document.getElementById("admin-avatar-fallback"),
  nameEl: document.getElementById("admin-name"),
  logoutBtn: document.getElementById("admin-logout-btn")
};

let products = [];
let editing = null;
let showArchived = false;

attachLogoutConfirm(el.logoutBtn);

requireAdmin((user) => {
  renderAdminSidebarProfile(user, {
    avatarImg: el.avatarImg,
    avatarFallback: el.avatarFallback,
    nameEl: el.nameEl
  });

  // Live stream — no reload needed after any save, toggle or archive.
  // includeArchived: true because this page owns the archived view;
  // the filtering happens below in inView().
  track(
    watchProducts(
      (items) => {
        products = items;
        hideFeedback();
        render();
      },
      {
        activeOnly: false,
        includeArchived: true,
        onError: (err) => showFeedback(describeError(err))
      }
    )
  );
});

/* ---------- rendering ---------- */

/** Archived rows live in their own view, never mixed with active ones. */
const inView = (p) => (showArchived ? !!p.archived : !p.archived);

function visibleProducts() {
  const term = (el.search?.value || "").trim().toLowerCase();
  const status = el.statusFilter?.value || "all";

  return products.filter((product) => {
    if (!inView(product)) return false;
    const matchesText =
      !term ||
      [product.name, product.description, product.category].some((value) =>
        String(value || "").toLowerCase().includes(term)
      );
    // The status filter is meaningless in the archived view — every
    // archived product is forced to "inactive" on the way in.
    return matchesText && (showArchived || status === "all" || product.status === status);
  });
}

function renderArchiveToggle(archivedCount) {
  let bar = document.getElementById("product-archive-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "product-archive-bar";
    bar.className = "admin-archive-bar";
    el.panelHeader?.after(bar);
    bar.addEventListener("click", (e) => {
      if (!e.target.closest("#product-archive-toggle")) return;
      showArchived = !showArchived;
      render();
    });
  }

  bar.innerHTML = `
    <button id="product-archive-toggle" type="button" class="admin-archive-toggle${
      showArchived ? " is-on" : ""
    }">${showArchived ? "← Back to active gear" : `Archived (${archivedCount})`}</button>
    ${
      showArchived
        ? '<span class="admin-archive-hint">Archived gear is hidden from the shop but nothing has been lost. Restore puts it back; delete is permanent.</span>'
        : ""
    }`;
}

function render() {
  // Stats describe the live catalogue only — archived gear is not
  // inventory you can sell, so counting it inflates every card.
  const live = products.filter((p) => !p.archived);
  const archivedCount = products.length - live.length;
  const active = live.filter((p) => p.status === "active");
  const categories = new Set(live.map((p) => p.category).filter(Boolean));

  setText("product-total", live.length.toLocaleString());
  setText("product-active", active.length.toLocaleString());
  setText("product-value", peso(live.reduce((sum, p) => sum + p.price, 0)));
  setText("product-categories", categories.size.toLocaleString());

  renderArchiveToggle(archivedCount);

  const rows = visibleProducts();
  if (!rows.length) {
    const message = showArchived
      ? "Nothing archived. Archived gear is kept here so it can be restored."
      : products.length
      ? "No products match this filter."
      : "No products yet. Add one to publish it to the shop.";
    el.list.innerHTML = `<tr><td colspan="6" class="admin-empty">${message}</td></tr>`;
    return;
  }

  el.list.innerHTML = rows.map(rowHtml).join("");
}

function rowHtml(product) {
  const actions = showArchived
    ? `<button type="button" data-action="restore" data-id="${product.id}">Restore</button>
       <button type="button" class="is-danger" data-action="delete" data-id="${product.id}">Delete forever</button>`
    : `<button type="button" data-action="edit" data-id="${product.id}">Edit</button>
       <button type="button" data-action="toggle" data-id="${product.id}">${
        product.status === "active" ? "Disable" : "Enable"
      }</button>
       <button type="button" data-action="archive" data-id="${product.id}">Archive</button>`;

  const archivedNote =
    product.archived && product.archivedBy
      ? `<small>Archived by ${escapeHtml(product.archivedBy)}</small>`
      : "";

  return `<tr${product.archived ? ' class="is-archived"' : ""}>
      <td>${
        product.image
          ? `<img class="admin-product-thumb" src="${escapeHtml(product.image)}" alt="" loading="lazy">`
          : '<div class="admin-product-thumb"></div>'
      }</td>
      <td><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(
    product.description || "No description"
  )}</small>${archivedNote}</td>
      <td>${escapeHtml(product.category)}</td>
      <td>${peso(product.price)}</td>
      <td><span class="admin-product-status admin-product-status--${
        product.archived ? "inactive" : product.status
      }">${product.archived ? "archived" : product.status}</span></td>
      <td><div class="admin-product-actions">${actions}</div></td>
    </tr>`;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function showFeedback(message) {
  if (!el.feedback) return;
  el.feedback.textContent = message;
  el.feedback.hidden = false;
}

function hideFeedback() {
  if (el.feedback) el.feedback.hidden = true;
}

/* ---------- modal ---------- */

function openModal(product = null) {
  editing = product;
  if (el.modalTitle) el.modalTitle.textContent = product ? "Edit Product" : "Add New Product";

  document.getElementById("product-name").value = product?.name || "";
  document.getElementById("product-category").value = product?.category || "";
  document.getElementById("product-description").value = product?.description || "";
  document.getElementById("product-price").value = product ? product.price : "";
  document.getElementById("product-status").value = product?.status || "active";
  document.getElementById("product-image").value = product?.image || "";

  el.modal.hidden = false;
  el.backdrop.hidden = false;
}

function closeModal() {
  el.modal.hidden = true;
  el.backdrop.hidden = true;
  el.form.reset();
  editing = null;
}

/* ---------- events ---------- */

el.search?.addEventListener("input", render);
el.statusFilter?.addEventListener("change", render);
document.getElementById("add-product-btn")?.addEventListener("click", () => openModal());
document.getElementById("product-modal-close")?.addEventListener("click", closeModal);
document.getElementById("product-modal-cancel")?.addEventListener("click", closeModal);
el.backdrop?.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.modal.hidden) closeModal();
});

el.form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = el.form.querySelector('button[type="submit"]');
  submit.disabled = true;

  try {
    await saveProduct(
      {
        name: document.getElementById("product-name").value,
        category: document.getElementById("product-category").value,
        description: document.getElementById("product-description").value,
        price: document.getElementById("product-price").value,
        status: document.getElementById("product-status").value,
        image: document.getElementById("product-image").value
      },
      editing?.id || null,
      // The "before" snapshot. Without it the log can only say the row
      // was edited, not that the price went 2,400 -> 1,900.
      editing
    );
    closeModal();
    // No manual reload — the products stream pushes the new row in.
  } catch (err) {
    console.error("Product save failed:", err);
    showFeedback(describeError(err));
  } finally {
    submit.disabled = false;
  }
});

el.list?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const product = products.find((item) => item.id === button.dataset.id);
  if (!product) return;

  const act = button.dataset.action;
  const label = product.name || "this product";

  try {
    if (act === "edit") {
      openModal(product);
      return;
    }

    if (act === "archive") {
      if (
        !window.confirm(
          `Archive "${label}"?\n\nIt disappears from the shop but stays in Firestore, and you can restore it from the Archived view.`
        )
      )
        return;
      await archiveProduct(product.id, label);
      return;
    }

    if (act === "restore") {
      await restoreProduct(product.id, label);
      return;
    }

    if (act === "delete") {
      if (
        !window.confirm(
          `Permanently delete "${label}"?\n\nThis cannot be undone. Past orders that reference it will show a missing item.`
        )
      )
        return;
      if (window.prompt(`Type DELETE to confirm removing "${label}" for good.`) !== "DELETE") return;
      await deleteProduct(product.id, label);
      return;
    }

    await setProductStatus(product.id, product.status === "active" ? "inactive" : "active", label);
  } catch (err) {
    console.error("Product action failed:", err);
    showFeedback(describeError(err));
  }
});