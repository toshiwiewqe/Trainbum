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
  dropzone: document.getElementById("product-dropzone"),
  fileInput: document.getElementById("product-image-file"),
  uploadError: document.getElementById("product-upload-error"),
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
  const active = live.filter((p) => p.inStock);
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

  const stock = product.archived
    ? '<span class="admin-product-status admin-product-status--inactive">archived</span>'
    : product.inStock
    ? '<span class="admin-product-status admin-product-status--active">in stock</span>'
    : '<span class="admin-product-status admin-product-status--inactive">out of stock</span>';

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
      <td>${peso(product.price)}</td>
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
  paintStock();
  clearUploadError();

  fillRows(el.images, rowTemplates.images, (product?.images || []).map((url) => [url]));

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
        subcategory: document.getElementById("product-subcategory").value,
        description: document.getElementById("product-description").value,
        price: document.getElementById("product-price").value,
        popularity: document.getElementById("product-popularity").value,
        inStock: document.getElementById("product-instock").checked,
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
   STOCK SWITCH
   ========================================================== */

/* Keeps the card's wording and colour in step with the control, so it
   states the product's condition rather than leaving you to infer it
   from a tick. */
function paintStock() {
  if (!el.stockInput) return;
  const inStock = el.stockInput.checked;
  el.stockCard?.classList.toggle("is-out", !inStock);
  if (el.stockState) {
    el.stockState.textContent = inStock
      ? "In stock — on sale"
      : "Out of stock — listed, but cannot be bought";
  }
}

el.stockInput?.addEventListener("change", paintStock);

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
  } finally {
    setRowBusy(row, null);
    refreshCounts();
  }
}

/** Adds an empty row and returns it, so an upload has somewhere to land. */
function appendImageRow() {
  el.images.insertAdjacentHTML("beforeend", rowTemplates.images(""));
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