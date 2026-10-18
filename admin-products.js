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
  salePricing,
  saveProduct,
  setProductStatus,
  setProductQuantity,
  storageUnavailableReason,
  uploadProductImage,
  toDate,
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
  images: document.getElementById("product-images"),
  attributes: document.getElementById("product-attributes"),
  specs: document.getElementById("product-specs"),
  stockInput: document.getElementById("product-instock"),
  stockCard: document.getElementById("product-stock-card"),
  stockState: document.getElementById("product-stock-state"),
  quantity: document.getElementById("product-quantity"),
  qtyNote: document.getElementById("product-qty-note"),
  dropzone: document.getElementById("product-dropzone"),
  fileInput: document.getElementById("product-image-file"),
  uploadError: document.getElementById("product-upload-error"),

  /* ADDED — the sale card in the product form */
  saleCard: document.getElementById("product-sale-card"),
  saleOn: document.getElementById("product-sale-on"),
  saleBody: document.getElementById("product-sale-body"),
  saleState: document.getElementById("product-sale-state"),
  saleValue: document.getElementById("product-sale-value"),
  saleValueLabel: document.getElementById("product-sale-value-label"),
  saleCap: document.getElementById("product-sale-cap"),
  saleCapField: document.getElementById("product-sale-cap-field"),
  salePreview: document.getElementById("product-sale-preview"),

  /* ADDED — the stock dialog that replaced window.prompt() */
  stockModal: document.getElementById("stock-modal"),
  stockBackdrop: document.getElementById("stock-modal-backdrop"),
  stockForm: document.getElementById("stock-form"),
  stockQty: document.getElementById("stock-quantity"),
  stockThumb: document.getElementById("stock-thumb"),
  stockThumbEmpty: document.getElementById("stock-thumb-empty"),
  stockName: document.getElementById("stock-product-name"),
  stockMeta: document.getElementById("stock-product-meta"),
  stockWas: document.getElementById("stock-was"),
  stockOutcome: document.getElementById("stock-outcome"),
  stockResumeRow: document.getElementById("stock-resume-row"),
  stockResume: document.getElementById("stock-resume"),
  stockSave: document.getElementById("stock-modal-save"),
  panelHeader: document.querySelector(".admin-products-panel .admin-panel-header"),
  avatarImg: document.getElementById("admin-avatar"),
  avatarFallback: document.getElementById("admin-avatar-fallback"),
  nameEl: document.getElementById("admin-name"),
  logoutBtn: document.getElementById("admin-logout-btn")
};

let products = [];
let editing = null;
let showArchived = false;

/* Shared threshold rather than a per-product field. One number is one
   thing to reason about; if different products need different floors
   later, this becomes a `lowStockAt` on the document. */
const LOW_STOCK_AT = 5;

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
      [
        product.name,
        product.description,
        product.category,
        product.subcategory,
        ...Object.keys(product.specs),
        ...Object.values(product.specs),
        ...Object.values(product.attributes).flat()
      ].some((value) => String(value || "").toLowerCase().includes(term));
    // The status filter is meaningless in the archived view — every
    // archived product is forced to "inactive" on the way in.
    if (!matchesText) return false;
    if (showArchived || status === "all") return true;
    // "active"/"inactive" are the <option> values the markup already
    // used; what they now mean is in stock / out of stock.
    return status === "active" ? product.inStock : !product.inStock;
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
    }">${showArchived ? "← Back to active Products" : `Archived (${archivedCount})`}</button>
    ${
      showArchived
        ? '<span class="admin-archive-hint">Archived Products is hidden from the shop but nothing has been lost. Restore puts it back; delete is permanent.</span>'
        : ""
    }`;
}

function render() {
  // Stats describe the live catalogue only — archived Products is not
  // inventory you can sell, so counting it inflates every card.
  const live = products.filter((p) => !p.archived);
  const archivedCount = products.length - live.length;
  const active = live.filter((p) => p.inStock);
  const categories = new Set(live.map((p) => p.category).filter(Boolean));

  setText("product-total", live.length.toLocaleString());
  setText("product-active", active.length.toLocaleString());

  /* FIXED. This summed unit prices — the cost of buying one of each,
     which is not inventory value and never was. Value is price times
     the number of units held, so it needs the count. Products with no
     count are excluded and said so, rather than being treated as one
     unit each and quietly inflating the figure. */
  const tracked = live.filter((p) => p.hasQuantity);
  const stockValue = tracked.reduce((sum, p) => sum + p.price * p.quantity, 0);
  setText("product-value", peso(stockValue));

  const valueCard = document.getElementById("product-value")?.parentElement;
  let valueNote = document.getElementById("product-value-note");
  if (valueCard && !valueNote) {
    valueNote = document.createElement("p");
    valueNote.id = "product-value-note";
    valueNote.className = "admin-stat-delta";
    valueCard.appendChild(valueNote);
  }
  if (valueNote) {
    const untracked = live.length - tracked.length;
    valueNote.textContent = tracked.length
      ? `${tracked.length} tracked${untracked ? ` \u00b7 ${untracked} without a count` : ""}`
      : "No products have a stock count yet";
  }

  setText("product-categories", categories.size.toLocaleString());

  // Low stock belongs next to Active Products — it is the number that
  // tells you to do something today.
  const low = live.filter((p) => p.hasQuantity && p.quantity > 0 && p.quantity <= LOW_STOCK_AT).length;
  const zero = live.filter((p) => p.hasQuantity && p.quantity === 0).length;
  const activeCard = document.getElementById("product-active")?.parentElement;
  let activeNote = document.getElementById("product-active-note");
  if (activeCard && !activeNote) {
    activeNote = document.createElement("p");
    activeNote.id = "product-active-note";
    activeNote.className = "admin-stat-delta";
    activeCard.appendChild(activeNote);
  }
  if (activeNote) {
    const bits = [];
    if (low) bits.push(`${low} low (\u2264${LOW_STOCK_AT})`);
    if (zero) bits.push(`${zero} at zero`);
    activeNote.textContent = bits.join(" \u00b7 ") || "Nothing running low";
    activeNote.classList.toggle("admin-stat-delta--negative", low > 0 || zero > 0);
  }

  renderArchiveToggle(archivedCount);

  const rows = visibleProducts();
  if (!rows.length) {
    const message = showArchived
      ? "Nothing archived. Archived Products is kept here so it can be restored."
      : products.length
      ? "No products match this filter."
      : "No products yet. Add one to publish it to the shop.";
    el.list.innerHTML = `<tr><td colspan="7" class="admin-empty">${message}</td></tr>`;
    return;
  }

  el.list.innerHTML = rows.map(rowHtml).join("");
}

function rowHtml(product) {
  const actions = showArchived
    ? `<button type="button" data-action="restore" data-id="${product.id}">Restore</button>
       <button type="button" class="is-danger" data-action="delete" data-id="${product.id}">Delete forever</button>`
    : `<button type="button" data-action="edit" data-id="${product.id}">Edit</button>
       <button type="button" data-action="stock" data-id="${product.id}">Stock</button>
       <button type="button" data-action="toggle" data-id="${product.id}">${
        product.inStock ? "Mark out" : "Mark in"
      }</button>
       <button type="button" data-action="archive" data-id="${product.id}">Archive</button>`;

  // A line of the fields that used to be invisible here, so the table
  // shows at a glance which records are still missing specs or images.
  const meta = [
    product.subcategory ? escapeHtml(product.subcategory) : "",
    `${product.images.length} image${product.images.length === 1 ? "" : "s"}`,
    product.popularity ? `popularity ${product.popularity}` : "",
    product.archived && product.archivedBy ? `archived by ${escapeHtml(product.archivedBy)}` : ""
  ].filter(Boolean).join(" · ");

  const attrSummary = Object.entries(product.attributes)
    .filter(([, list]) => list.length)
    .map(([key, list]) => `<span class="admin-chip">${escapeHtml(key)} ${list.length}</span>`)
    .join("");
  const specCount = Object.keys(product.specs).length;

  /* The badge says whether it is on sale; the line under it says how
     many are left. A product can legitimately be on sale with a low
     count, or off sale with plenty — so both have to be visible. */
  const badge = product.archived
    ? '<span class="admin-product-status admin-product-status--inactive">archived</span>'
    : product.inStock
    ? '<span class="admin-product-status admin-product-status--active">in stock</span>'
    : '<span class="admin-product-status admin-product-status--inactive">out of stock</span>';

  let count;
  if (!product.hasQuantity) {
    // Not "0". Nothing has been counted for this product yet, and
    // saying zero would read as sold out.
    count = '<span class="admin-qty-pill is-untracked">not tracked</span>';
  } else if (product.quantity === 0) {
    count = '<span class="admin-qty-pill is-zero">0 left</span>';
  } else if (product.quantity <= LOW_STOCK_AT) {
    count = `<span class="admin-qty-pill is-low">${product.quantity} left</span>`;
  } else {
    count = `<span class="admin-qty-pill">${product.quantity} in stock</span>`;
  }

  const stock = `${badge}<div class="admin-qty-cell">${count}</div>`;

  /* The price cell shows what a customer is charged today, with the
     normal price struck through beside it — the same shape the shop
     uses, so the two can be compared at a glance. A sale the table
     cannot show is one you have to open 63 products to audit. */
  const priceCell = product.onSale
    ? `<span class="admin-price-sale">${peso(product.salePrice)}</span>
       <span class="admin-price-was">${peso(product.price)}</span>
       <span class="admin-sale-pill">${escapeHtml(product.saleBadge)}</span>`
    : peso(product.price);

  return `<tr${product.archived ? ' class="is-archived"' : ""}>
      <td>${
        product.image
          ? `<img class="admin-product-thumb" src="${escapeHtml(product.image)}" alt="" loading="lazy"
                  onerror="this.classList.add('is-broken');this.removeAttribute('src')">`
          : '<div class="admin-product-thumb"></div>'
      }</td>
      <td><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(
    product.description || "No description"
  )}</small>${meta ? `<small class="admin-product-meta">${meta}</small>` : ""}</td>
      <td>${escapeHtml(product.category)}</td>
      <td>${priceCell}</td>
      <td>${stock}</td>
      <td><div class="admin-chip-row">${attrSummary || '<span class="admin-chip is-empty">none</span>'}${
        specCount ? `<span class="admin-chip">specs ${specCount}</span>` : ""
      }</div></td>
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

/* ==========================================================
   REPEATABLE ROW EDITORS
   ----------------------------------------------------------
   Three of the product fields are not scalars:

     images       a list of URLs
     attributes   a map of name -> list   (color: [...], size: [...])
     specs        a map of label -> text  (Material: "Ripstop Nylon")

   All three are edited as rows you can add and remove. The two maps
   deliberately use a GENERIC key column rather than fixed Colour and
   Size inputs: Firestore replaces a map wholesale on write, so a form
   that only knew the keys present today would silently delete any key
   added later from the console. Reading the keys off the document and
   writing them all back is what makes that impossible.
   ========================================================== */

const rowTemplates = {
  images: (value = "") => `
    <div class="admin-repeat-row" data-row>
      <img class="admin-repeat-thumb" alt="" ${
        value ? `src="${escapeHtml(value)}"` : ""
      } onerror="this.classList.add('is-broken');this.removeAttribute('src')">
      <input type="url" class="admin-repeat-input" data-field="value"
             value="${escapeHtml(value)}" placeholder="https://i.ibb.co/.../photo.jpg">
      <button type="button" class="admin-row-upload" data-row-upload
              aria-label="Replace this image with a file">Upload</button>
      <button type="button" class="admin-repeat-remove" data-remove aria-label="Remove image">×</button>
    </div>`,

  attributes: (key = "", value = "") => `
    <div class="admin-repeat-row" data-row>
      <input class="admin-repeat-key" data-field="key" value="${escapeHtml(key)}" placeholder="color">
      <input class="admin-repeat-input" data-field="value" value="${escapeHtml(value)}"
             placeholder="Comma, separated, values">
      <button type="button" class="admin-repeat-remove" data-remove aria-label="Remove attribute">×</button>
    </div>`,

  specs: (key = "", value = "") => `
    <div class="admin-repeat-row" data-row>
      <input class="admin-repeat-key" data-field="key" value="${escapeHtml(key)}" placeholder="Material">
      <input class="admin-repeat-input" data-field="value" value="${escapeHtml(value)}"
             placeholder="Ripstop Nylon">
      <button type="button" class="admin-repeat-remove" data-remove aria-label="Remove spec">×</button>
    </div>`
};

function fillRows(container, template, entries) {
  container.innerHTML = entries.length
    ? entries.map((args) => template(...args)).join("")
    : template();
}

/** Reads a list editor back out, dropping blank rows. */
function readList(container) {
  return [...container.querySelectorAll("[data-row]")]
    .map((row) => row.querySelector('[data-field="value"]').value.trim())
    .filter(Boolean);
}

/**
 * Reads a key/value editor back out.
 *
 * `split` turns the value into a list, for attributes; specs keep
 * theirs as text.
 *
 * `keepEmpty` is what stops a save quietly reshaping the document.
 * Your tent carries `size: []` — an attribute that exists but has no
 * options yet. Dropping blank rows wholesale would delete that key on
 * the first edit, so for attributes a named row survives with an empty
 * list. A spec with no text is just an unfinished row and is dropped.
 */
function readMap(container, { split = false, keepEmpty = false } = {}) {
  const out = {};
  container.querySelectorAll("[data-row]").forEach((row) => {
    const key = row.querySelector('[data-field="key"]').value.trim();
    const raw = row.querySelector('[data-field="value"]').value.trim();
    if (!key) return;
    if (!raw && !keepEmpty) return;
    out[key] = split ? raw.split(",").map((v) => v.trim()).filter(Boolean) : raw;
  });
  return out;
}

/** A row counts once it has anything in it — a named attribute with
    no options yet is still a row you have filled in. */
function countRows(container) {
  return [...container.querySelectorAll("[data-row]")].filter((row) =>
    [...row.querySelectorAll("input")].some((input) => input.value.trim())
  ).length;
}

function refreshCounts() {
  setText("product-images-count", `${countRows(el.images)} listed`);
  setText("product-attrs-count", `${countRows(el.attributes)} listed`);
  setText("product-specs-count", `${countRows(el.specs)} listed`);
}

// Add / remove / live image preview, delegated once for all three.
[el.images, el.attributes, el.specs].forEach((container) => {
  container?.addEventListener("click", (e) => {
    if (!e.target.closest("[data-remove]")) return;
    const rows = container.querySelectorAll("[data-row]");
    // Never leave a section with no row at all — an empty box gives
    // you nothing to type into.
    if (rows.length <= 1) {
      container.querySelectorAll("input").forEach((input) => (input.value = ""));
      container.querySelector(".admin-repeat-thumb")?.removeAttribute("src");
    } else {
      e.target.closest("[data-row]").remove();
    }
    refreshCounts();
  });

  container?.addEventListener("input", (e) => {
    const thumb = e.target.closest("[data-row]")?.querySelector(".admin-repeat-thumb");
    if (thumb && e.target.dataset.field === "value") {
      const url = e.target.value.trim();
      thumb.classList.remove("is-broken");
      if (url) thumb.src = url;
      else thumb.removeAttribute("src");
    }
    refreshCounts();
  });
});

document.querySelectorAll("[data-add]").forEach((button) =>
  button.addEventListener("click", () => {
    const which = button.dataset.add;
    el[which].insertAdjacentHTML("beforeend", rowTemplates[which]());
    el[which].querySelector("[data-row]:last-child input")?.focus();
    refreshCounts();
  })
);

/* ---------- modal ---------- */

const stamp = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleString("en-PH") : "—";
};

function openModal(product = null) {
  editing = product;
  if (el.modalTitle) el.modalTitle.textContent = product ? "Edit Product" : "Add New Product";

  document.getElementById("product-name").value = product?.name || "";
  document.getElementById("product-category").value = product?.category || "";
  document.getElementById("product-subcategory").value = product?.subcategory || "";
  document.getElementById("product-description").value = product?.description || "";
  document.getElementById("product-price").value = product ? product.price : "";
  document.getElementById("product-popularity").value = product ? product.popularity : "";
  // A new product is in stock unless you say otherwise.
  document.getElementById("product-instock").checked = product ? product.inStock : true;
  // Empty means untracked, so an untracked product gets an empty box —
  // not a 0, which would turn tracking on and sell-out the product on
  // the next save.
  el.quantity.value = product?.hasQuantity ? product.quantity : "";
  paintStock();

  /* The sale, read from the stored map rather than the computed
     salePrice: the form edits the rule, not its result. */
  const sale = product?.sale || {};
  setSaleType(sale.type === "amount" ? "amount" : "percent");
  el.saleOn.checked = sale.on === true;
  el.saleValue.value = sale.value ? String(sale.value) : "";
  el.saleCap.value = sale.cap ? String(sale.cap) : "";
  paintSale();

  clearUploadError();

  fillRows(el.images, rowTemplates.images, (product?.images || []).map((url) => [url]));
  // Re-rendered rows lose the disabled state, so re-apply it. No-ops
  // unless an upload has already been found not to work.
  paintUploadAvailability();

  // A blank new product gets the two attribute keys this catalogue
  // already uses, so the common case is one less thing to type.
  const attrEntries = Object.entries(product?.attributes || {}).map(([k, v]) => [k, v.join(", ")]);
  fillRows(
    el.attributes,
    rowTemplates.attributes,
    attrEntries.length ? attrEntries : product ? [] : [["color", ""], ["size", ""]]
  );

  fillRows(el.specs, rowTemplates.specs, Object.entries(product?.specs || {}));

  setText("product-meta-id", product?.id || "Assigned by Firestore on save");
  setText("product-meta-added", product ? stamp(product.dateAdded) : "—");
  setText("product-meta-updated", product ? stamp(product.updatedAt) : "—");

  /* Which field actually controls whether the shop sells this item.
     Worth stating, because your records use inStock and the panel used
     to write `status` — two flags, and products.js reads both. */
  setText(
    "product-meta-availability",
    !product
      ? "inStock (new records)"
      : product.hasStatusField && product.hasInStockField
      ? "status AND inStock — both present, the shop honours both"
      : product.hasStatusField
      ? "status"
      : "inStock"
  );

  // Anything in the document with no input on this form.
  const extrasBox = document.getElementById("product-meta-extras");
  if (extrasBox) {
    const rows = product?.extras || [];
    extrasBox.innerHTML = rows.length
      ? '<div><dt style="grid-column:1/-1;padding-top:.4rem">Other fields on this record</dt></div>' +
        rows
          .map(([key, value]) => {
            const shown =
              value === null || value === undefined || value === ""
                ? "—"
                : value?.toDate
                ? stamp(value)
                : typeof value === "object"
                ? JSON.stringify(value)
                : String(value);
            return `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(shown)}</dd></div>`;
          })
          .join("")
      : "";
    extrasBox.hidden = !rows.length;
  }

  refreshCounts();
  el.modal.hidden = false;
  el.backdrop.hidden = false;
  document.getElementById("product-form-fields").scrollTop = 0;
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
  if (e.key !== "Escape") return;
  // Stock first: it is the one on top when both exist, and closing the
  // form underneath it would be the wrong dialog to dismiss.
  if (el.stockModal && !el.stockModal.hidden) closeStockModal();
  else if (el.modal && !el.modal.hidden) closeModal();
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
        subcategory: document.getElementById("product-subcategory").value,
        description: document.getElementById("product-description").value,
        price: document.getElementById("product-price").value,
        popularity: document.getElementById("product-popularity").value,
        inStock: document.getElementById("product-instock").checked,
        quantity: el.quantity.value,
        sale: readSaleForm(),
        images: readList(el.images),
        attributes: readMap(el.attributes, { split: true, keepEmpty: true }),
        specs: readMap(el.specs)
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

    if (act === "stock") {
      openStockModal(product);
      return;
    }

    // Marking something back in stock when nothing is left would put a
    // product on the shop that cannot be fulfilled.
    if (!product.inStock && product.hasQuantity && product.quantity === 0) {
      showFeedback(`"${label}" has 0 units. Set a quantity with the Stock button before putting it on sale.`);
      return;
    }

    // hasStatusField tells the data layer whether this document carries
    // a `status` field at all. Yours do not — availability is inStock —
    // so passing it stops the panel bolting a second, competing flag
    // onto 63 records.
    await setProductStatus(product.id, product.inStock ? "inactive" : "active", label, {
      hasStatusField: product.hasStatusField
    });
  } catch (err) {
    console.error("Product action failed:", err);
    showFeedback(describeError(err));
  }
});

/* ==========================================================
   STOCK DIALOG
   ----------------------------------------------------------
   Was window.prompt() + a stacked window.confirm(). Both are drawn
   by the browser, not the page: unstyleable, unable to show the
   product being edited, and unable to say what the number will do
   before it is committed.

   The dialog keeps the same two decisions the prompts made —
   how many, and whether to relist — and nothing more. It does not
   reach for openModal(): that is a twelve-section form, and this
   is one field.
   ========================================================== */

/* The product whose count is being edited. null when the dialog is
   shut, which is also what stops a stale save firing after close. */
let stockTarget = null;

function openStockModal(product) {
  if (!el.stockModal || !product) return;
  stockTarget = product;

  el.stockName.textContent = product.name || "Untitled product";
  el.stockMeta.textContent = [
    product.category || product.subcategory || "Uncategorised",
    peso(product.price)
  ].join(" · ");

  /* A broken URL must not leave an alt-text stub sitting in the card,
     so the placeholder takes over on error rather than on load. */
  const src = product.images?.[0] || "";
  el.stockThumb.hidden = !src;
  el.stockThumbEmpty.hidden = Boolean(src);
  if (src) {
    el.stockThumb.src = src;
    el.stockThumb.alt = product.name || "";
    el.stockThumb.onerror = () => {
      el.stockThumb.hidden = true;
      el.stockThumbEmpty.hidden = false;
    };
  }

  el.stockWas.textContent = product.hasQuantity
    ? `currently ${product.quantity}`
    : "no count kept yet";

  // Untracked products open empty rather than at 0: 0 is a real count
  // that takes the product off sale, and pre-filling it would make
  // that the default answer to a question nobody asked.
  el.stockQty.value = product.hasQuantity ? String(product.quantity) : "";

  el.stockResume.checked = true;
  paintStockModal();

  el.stockModal.hidden = false;
  el.stockBackdrop.hidden = false;
  el.stockQty.focus();
  el.stockQty.select();
}

function closeStockModal() {
  if (!el.stockModal) return;
  el.stockModal.hidden = true;
  el.stockBackdrop.hidden = true;
  el.stockThumb.onerror = null;
  stockTarget = null;
}

/* Reads the box and reports, in order: is this a usable number, what
   will the shop do with it, and does the relist question apply. */
function paintStockModal() {
  if (!stockTarget) return;

  const raw = String(el.stockQty.value).trim();
  const parsed = Number(raw);
  const blank = raw === "";
  const valid = !blank && Number.isFinite(parsed) && parsed >= 0;
  const qty = valid ? Math.max(0, Math.trunc(parsed)) : null;

  // The floor is 0, so the minus buttons stop there instead of
  // bouncing off a value the field would reject on save. A blank box
  // counts as the floor too: pressing −1 on an untracked product would
  // otherwise land on 0, which takes it off sale.
  const atFloor = qty === null || qty <= 0;
  el.stockForm.querySelectorAll("[data-stock-step]").forEach((btn) => {
    btn.disabled = atFloor && Number(btn.dataset.stockStep) < 0;
  });

  const name = stockTarget.name || "this product";
  let text;
  let tone;

  if (blank) {
    text = stockTarget.hasQuantity
      ? `Enter a whole number. The count stays at ${stockTarget.quantity} until you do.`
      : "Enter a whole number. 0 is a real count and takes the product off sale.";
    tone = "";
  } else if (!valid) {
    text = `“${raw}” is not a whole number of 0 or more.`;
    tone = "is-bad";
  } else if (qty === stockTarget.quantity && stockTarget.hasQuantity) {
    text = `Already ${qty}. Nothing to save.`;
    tone = "";
  } else if (qty === 0) {
    text = `Saving 0 takes ${name} off sale — the shop shows “Sold Out” and Add to Cart is disabled.`;
    tone = "is-zero";
  } else if (qty <= LOW_STOCK_AT) {
    text = `${name} stays on sale with ${qty} left, and the shop shows a low-stock badge.`;
    tone = "is-low";
  } else {
    text = `${name} stays on sale with ${qty} in stock.`;
    tone = "is-ok";
  }

  el.stockOutcome.textContent = text;
  el.stockOutcome.className = "admin-stock-outcome" + (tone ? " " + tone : "");

  const unchanged = valid && stockTarget.hasQuantity && qty === stockTarget.quantity;

  /* The relist question. It only arises when the product has units but
     has been deliberately marked out of stock — restocking should not
     quietly undo that, and guessing either way is wrong.

     `!unchanged` matters: without it the question appears the moment
     such a product is opened, before anything has been typed, asking
     about a save that is not on the table. */
  const needsResume =
    valid &&
    !unchanged &&
    qty > 0 &&
    !stockTarget.inStock &&
    stockTarget.hasQuantity &&
    stockTarget.quantity > 0;
  el.stockResumeRow.hidden = !needsResume;

  el.stockSave.disabled = !valid || unchanged;
}

el.stockQty?.addEventListener("input", paintStockModal);

el.stockForm?.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-stock-step], [data-stock-set]");
  if (!btn) return;

  const current = Math.max(0, Math.trunc(Number(el.stockQty.value) || 0));
  el.stockQty.value = String(
    btn.dataset.stockSet !== undefined
      ? Math.max(0, Math.trunc(Number(btn.dataset.stockSet)))
      : Math.max(0, current + Number(btn.dataset.stockStep))
  );
  paintStockModal();
});

el.stockForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!stockTarget) return;

  const next = Number(String(el.stockQty.value).trim());
  if (!Number.isFinite(next) || next < 0) return;

  // Captured before the dialog closes, because closeStockModal clears
  // stockTarget and the await below outlives it.
  const product = stockTarget;
  const resume = el.stockResumeRow.hidden ? true : el.stockResume.checked;
  const quantity = Math.max(0, Math.trunc(next));

  el.stockSave.disabled = true;
  try {
    const changed = await setProductQuantity(product, quantity, { resume });
    closeStockModal();
    if (changed) {
      hideFeedback();
    } else {
      showFeedback(`"${product.name}" was already at ${quantity}. Nothing changed.`);
    }
  } catch (err) {
    console.error("Stock update failed:", err);
    // Left open, so the number typed is not lost to a transient failure.
    el.stockOutcome.textContent = describeError(err);
    el.stockOutcome.className = "admin-stock-outcome is-bad";
    el.stockSave.disabled = false;
  }
});

document.getElementById("stock-modal-close")?.addEventListener("click", closeStockModal);
document.getElementById("stock-modal-cancel")?.addEventListener("click", closeStockModal);
el.stockBackdrop?.addEventListener("click", closeStockModal);

/* ==========================================================
   SALE
   ----------------------------------------------------------
   The form edits the RULE — on/off, percent or pesos, how much,
   and the cap — never the resulting price. salePricing() in
   trailbound-data.js turns that rule into a number, and it is the
   only thing in the project that does: the shop, the cart and
   checkout all call the same function on the same stored map, so
   they cannot drift apart.

   That is also why the preview below runs the real function rather
   than its own copy of the arithmetic. A preview that agrees with
   the code by coincidence is worse than none.
   ========================================================== */

/** The whole form's sale rule, in the shape saveProduct expects. */
function readSaleForm() {
  return {
    on: el.saleOn?.checked === true,
    type: el.saleCard?.dataset.saleMode === "amount" ? "amount" : "percent",
    value: el.saleValue?.value ?? "",
    // Sent whatever the type; saveProduct drops it on a flat amount.
    cap: el.saleCap?.value ?? ""
  };
}

function setSaleType(type) {
  if (!el.saleCard) return;
  const wanted = type === "amount" ? "amount" : "percent";
  el.saleCard.dataset.saleMode = wanted;
  el.saleCard.querySelectorAll("[data-sale-type]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.saleType === wanted);
    btn.setAttribute("aria-pressed", String(btn.dataset.saleType === wanted));
  });
  if (el.saleValueLabel) el.saleValueLabel.textContent = wanted === "amount" ? "Pesos off" : "Percent off";
  if (el.saleValue) el.saleValue.placeholder = wanted === "amount" ? "500" : "25";
  // Hidden rather than disabled: a cap that cannot apply should not be
  // sitting there holding a number you might think is in effect.
  if (el.saleCapField) el.saleCapField.hidden = wanted === "amount";
}

function paintSale() {
  if (!el.saleCard) return;

  const form = readSaleForm();
  const price = Number(document.getElementById("product-price")?.value) || 0;
  const info = salePricing({ price, sale: form });

  el.saleCard.classList.toggle("is-on", form.on);
  el.saleBody.hidden = !form.on;

  let state;
  let tone = "";

  if (!form.on) {
    state = "Not on sale";
  } else if (!price) {
    state = "Set a price first";
    tone = "is-warn";
  } else if (!info.active) {
    state = "No discount yet";
    tone = "is-warn";
  } else {
    state = info.badge;
    tone = "is-live";
  }

  el.saleState.textContent = state;
  el.saleState.className = "admin-sale-state" + (tone ? " " + tone : "");

  if (!form.on) {
    el.salePreview.textContent = "";
    el.salePreview.className = "admin-sale-preview";
    return;
  }

  let preview;
  let previewTone = "";

  if (!price) {
    preview = "Enter the product's normal price above and this will work out the sale price.";
    previewTone = "is-warn";
  } else if (!info.active) {
    preview = el.saleCard.dataset.saleMode === "amount"
      ? "Enter how many pesos to take off."
      : "Enter a percentage to take off.";
    previewTone = "is-warn";
  } else if (info.salePrice === 0) {
    // Almost always a typo — ₱500 off a ₱300 item, or 150%.
    preview = `${peso(price)} → free. The discount is at least the price, so this product would cost nothing.`;
    previewTone = "is-bad";
  } else {
    preview = `${peso(price)} → ${peso(info.salePrice)} · ${peso(info.discount)} off`;
    if (info.capApplied) {
      /* The case worth spelling out. "25% off, cap ₱50" on a ₱1,399
         item is ₱50 off, not ₱350 — the cap silently redefines the
         headline number, and the shop will badge the real one. */
      preview += ` — the cap holds it to ${peso(info.cap)}, so this is ${info.percentOff}% off, not ${info.value}%.`;
      previewTone = "is-warn";
    }
  }

  el.salePreview.textContent = preview;
  el.salePreview.className = "admin-sale-preview" + (previewTone ? " " + previewTone : "");
}

el.saleOn?.addEventListener("change", paintSale);
el.saleValue?.addEventListener("input", paintSale);
el.saleCap?.addEventListener("input", paintSale);
// The sale price depends on the product's price, so the preview has to
// follow edits to the field above it.
document.getElementById("product-price")?.addEventListener("input", paintSale);

el.saleCard?.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-sale-type]");
  if (!btn) return;
  setSaleType(btn.dataset.saleType);
  paintSale();
});

/* ==========================================================
   STOCK SWITCH
   ========================================================== */

/* Keeps the card's wording and colour in step with the control, so it
   states the product's condition rather than leaving you to infer it
   from a tick. */
function paintStock() {
  if (!el.stockInput) return;

  const raw = String(el.quantity?.value ?? "").trim();
  const tracked = raw !== "";
  const qty = tracked ? Math.max(0, Math.trunc(Number(raw) || 0)) : null;

  /* Zero units forces the switch off and holds it there. Doing this on
     screen rather than only in the writer is the point: the form shows
     the state it is about to save, instead of you ticking "in stock",
     pressing Save, and finding it off afterwards. */
  if (qty === 0) el.stockInput.checked = false;
  el.stockInput.disabled = qty === 0;
  el.stockCard?.classList.toggle("is-locked", qty === 0);

  const inStock = el.stockInput.checked;
  el.stockCard?.classList.toggle("is-out", !inStock);
  if (el.stockState) {
    el.stockState.textContent = inStock
      ? "In stock — on sale"
      : qty === 0
      ? "Out of stock — nothing left to sell"
      : "Out of stock — listed, but cannot be bought";
  }

  if (el.qtyNote) {
    el.qtyNote.textContent = !tracked
      ? "No count kept for this product. The switch alone decides whether the shop sells it."
      : qty === 0
      ? "At zero, so the shop cannot sell it. Add units to put it back on sale."
      : qty <= LOW_STOCK_AT
      ? `Only ${qty} left — at or below the ${LOW_STOCK_AT}-unit low-stock mark.`
      : `${qty} units counted.`;
    el.qtyNote.classList.toggle("is-warn", tracked && qty <= LOW_STOCK_AT);
  }
}

el.stockInput?.addEventListener("change", paintStock);
el.quantity?.addEventListener("input", paintStock);

/* The +/- buttons. An untracked product starts from 0 the first time
   you nudge it, which is how tracking gets turned on deliberately. */
document.querySelectorAll("[data-qty-step]").forEach((button) =>
  button.addEventListener("click", () => {
    const step = Number(button.dataset.qtyStep) || 0;
    const current = Math.max(0, Math.trunc(Number(el.quantity.value) || 0));
    el.quantity.value = String(Math.max(0, current + step));
    paintStock();
  })
);

/* ==========================================================
   IMAGE UPLOAD
   ----------------------------------------------------------
   Two entry points, one code path:
     - the dropzone (click or drag), which APPENDS rows
     - a row's Upload button, which REPLACES that row's URL
   ========================================================== */

function showUploadError(message) {
  if (!el.uploadError) return;
  el.uploadError.textContent = message;
  el.uploadError.hidden = false;
}

function clearUploadError() {
  if (el.uploadError) el.uploadError.hidden = true;
}

/* Once uploading is known not to work, the drop zone says so instead
   of going on looking like a button. The URL fields keep working —
   they are the route that does not depend on Storage at all. */
function paintUploadAvailability() {
  const reason = storageUnavailableReason();
  if (!reason || !el.dropzone) return;

  el.dropzone.classList.add("is-unavailable");
  if (el.fileInput) el.fileInput.disabled = true;

  const strong = el.dropzone.querySelector(".admin-dropzone-text strong");
  if (strong) strong.textContent = "Image upload is unavailable on this project";

  const notes = el.dropzone.querySelectorAll(".admin-dropzone-text small");
  if (notes[0]) notes[0].textContent = "Paste an image URL in a row below instead — it works exactly the same.";
  if (notes[1]) notes[1].remove();

  // Per-row Upload buttons go with it, for the same reason.
  el.images?.querySelectorAll("[data-row-upload]").forEach((btn) => {
    btn.disabled = true;
    btn.title = reason;
  });
}

/** A row mid-upload: the input shows progress and cannot be edited. */
function setRowBusy(row, percent) {
  const input = row.querySelector('[data-field="value"]');
  const button = row.querySelector("[data-row-upload]");
  if (!input) return;
  if (percent === null) {
    input.disabled = false;
    input.placeholder = "https://i.ibb.co/.../photo.jpg";
    row.classList.remove("is-uploading");
    row.style.removeProperty("--upload-progress");
    if (button) { button.disabled = false; button.textContent = "Upload"; }
    return;
  }
  input.disabled = true;
  row.classList.add("is-uploading");
  row.style.setProperty("--upload-progress", `${percent}%`);
  if (button) { button.disabled = true; button.textContent = `${percent}%`; }
}

function setRowUrl(row, url) {
  const input = row.querySelector('[data-field="value"]');
  const thumb = row.querySelector(".admin-repeat-thumb");
  if (input) input.value = url;
  if (thumb) {
    thumb.classList.remove("is-broken");
    thumb.src = url;
  }
}

async function uploadInto(row, file) {
  clearUploadError();
  try {
    const url = await uploadProductImage(file, {
      productId: editing?.id || "new",
      onProgress: (pct) => setRowBusy(row, pct)
    });
    setRowUrl(row, url);
  } catch (err) {
    console.error("Image upload failed:", err);
    showUploadError(err.message || "The upload failed.");
    // A row added for a failed upload and left empty is just noise.
    if (!row.querySelector('[data-field="value"]')?.value) row.remove();
    // If the problem is the bucket rather than this file, stop offering
    // uploads — otherwise the next four images fail the same way and it
    // reads as the page being broken rather than a setting being off.
    paintUploadAvailability();
  } finally {
    setRowBusy(row, null);
    refreshCounts();
  }
}

/** Adds an empty row and returns it, so an upload has somewhere to land. */
function appendImageRow() {
  el.images.insertAdjacentHTML("beforeend", rowTemplates.images(""));
  // A row created after the verdict is in needs the same treatment as
  // the ones that were already on screen.
  paintUploadAvailability();
  return el.images.lastElementChild;
}

async function uploadFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  clearUploadError();
  // Sequential, not parallel: progress stays readable and a slow
  // connection does not have four uploads competing for it.
  for (const file of files) {
    await uploadInto(appendImageRow(), file);
  }
}

el.fileInput?.addEventListener("change", async (event) => {
  await uploadFiles(event.target.files);
  event.target.value = ""; // so choosing the same file twice still fires
});

/* Drag and drop. dragover must be cancelled or the browser navigates
   to the dropped file instead of handing it over. */
["dragenter", "dragover"].forEach((type) =>
  el.dropzone?.addEventListener(type, (event) => {
    event.preventDefault();
    el.dropzone.classList.add("is-dragging");
  })
);
["dragleave", "drop"].forEach((type) =>
  el.dropzone?.addEventListener(type, (event) => {
    event.preventDefault();
    if (type === "dragleave" && el.dropzone.contains(event.relatedTarget)) return;
    el.dropzone.classList.remove("is-dragging");
  })
);
el.dropzone?.addEventListener("drop", async (event) => {
  const files = [...(event.dataTransfer?.files || [])].filter((f) =>
    String(f.type || "").startsWith("image/")
  );
  if (!files.length) {
    showUploadError("That was not an image file.");
    return;
  }
  await uploadFiles(files);
});

/* Per-row Upload: a single hidden input reused for every row, with the
   target row held alongside it. Creating one input per row would leave
   a detached input behind every time a row is removed. */
let rowFileInput = null;
let rowTarget = null;

el.images?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-row-upload]");
  if (!button) return;
  rowTarget = button.closest("[data-row]");

  if (!rowFileInput) {
    rowFileInput = document.createElement("input");
    rowFileInput.type = "file";
    rowFileInput.accept = "image/*";
    rowFileInput.hidden = true;
    rowFileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file && rowTarget?.isConnected) await uploadInto(rowTarget, file);
      rowTarget = null;
    });
    document.body.appendChild(rowFileInput);
  }
  rowFileInput.click();
});