/* ==========================================================
   Admin — Product reviews
   ----------------------------------------------------------
   NEW PAGE. The `product_reviews` collection has existed since
   the product drawer shipped: products.js writes a document
   every time a customer submits a review, and reads the whole
   collection back in loadProductPopularity() to compute each
   product's average rating and review count.

   That computation drives the "Popularity" sort on the shop.
   Nothing in the admin panel read the collection, so those
   numbers were being produced from data you could not see, and
   an abusive or mistaken review had no route to removal.

   This page shows the reviews and reproduces that aggregate
   with the same arithmetic, so the figure here and the order
   of the shop cannot disagree.
   ========================================================== */

import {
  attachLogoutConfirm,
  collectUnsubscribers,
  deleteReview,
  escapeHtml,
  renderAdminSidebarProfile,
  requireAdmin,
  timeAgo,
  toDate,
  watchProducts,
  watchReviews
} from "./trailbound-data.js";

const track = collectUnsubscribers();

const el = {
  avatarImg: document.getElementById("admin-avatar"),
  avatarFallback: document.getElementById("admin-avatar-fallback"),
  nameEl: document.getElementById("admin-name"),
  logoutBtn: document.getElementById("admin-logout-btn"),
  search: document.getElementById("review-search"),
  productFilter: document.getElementById("review-product-filter"),
  ratingFilter: document.getElementById("review-rating-filter"),
  list: document.getElementById("review-list"),
  aggregate: document.getElementById("review-aggregate"),
  feedback: document.getElementById("review-feedback"),
  modal: document.getElementById("review-modal"),
  backdrop: document.getElementById("review-modal-backdrop"),
  modalBody: document.getElementById("review-modal-body"),
  modalTitle: document.getElementById("review-modal-title"),
  deleteBtn: document.getElementById("review-delete-btn")
};

let reviews = [];
let products = [];
let adminUser = null;
let active = null;
let productFilterBuilt = "";

attachLogoutConfirm(el.logoutBtn);

requireAdmin((user) => {
  adminUser = user;
  renderAdminSidebarProfile(user, {
    avatarImg: el.avatarImg,
    avatarFallback: el.avatarFallback,
    nameEl: el.nameEl
  });

  track(
    watchReviews(
      (items) => {
        reviews = items;
        renderStats();
        buildProductFilter();
        render();
        renderAggregate();
      },
      {
        onError: () =>
          showFeedback("Reviews could not be loaded. Check your Firestore rules.")
      }
    )
  );

  /* Reviews store a productId and nothing else about the product, so
     the name has to come from the products collection. A review whose
     product has since been deleted still shows — with its id — rather
     than being dropped, because it is still counting toward nothing
     and you would never find out otherwise. */
  track(
    watchProducts(
      (items) => {
        products = items;
        buildProductFilter();
        render();
        renderAggregate();
      },
      /* includeArchived, because archiving gear does not delete its
         reviews. Without this an archived product's reviews would all
         render as "product not found" — which reads like data loss
         rather than what it is. */
      { includeArchived: true }
    )
  );
});

/* ---------- helpers ---------- */

const lower = (v) => String(v || "").toLowerCase();

function showFeedback(message) {
  el.feedback.textContent = message;
  el.feedback.hidden = false;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

const productName = (id) =>
  products.find((p) => p.id === id)?.name || "";

/* Whole stars only, which is what the drawer collects. A rating that
   is not a number gets no stars at all rather than zero stars, because
   zero is a rating and "unusable" is not. */
function stars(rating, rawRating) {
  if (!Number.isFinite(rating)) {
    /* JSON.stringify(NaN) is the string "null", which would print
       "unusable (null)" for the one value that actually breaks the
       storefront average — and make it indistinguishable from a
       genuinely absent rating. Name it. */
    const shown =
      typeof rawRating === "number" && Number.isNaN(rawRating)
        ? "NaN"
        : rawRating === undefined || rawRating === null || rawRating === ""
        ? "none"
        : JSON.stringify(rawRating);
    return `<span class="admin-missing" style="color:#facc15" title="products.js skips this review">unusable (${escapeHtml(
      shown
    )})</span>`;
  }
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  const colour = full <= 2 ? "#ff8a7a" : full === 3 ? "#f2c14e" : "#6ede9a";
  return `<span style="color:${colour};letter-spacing:.1em" title="${rating} out of 5">${"★".repeat(
    full
  )}<span style="opacity:.3">${"★".repeat(5 - full)}</span></span>`;
}

const when = (value) => {
  const d = toDate(value);
  return d ? d.toLocaleString("en-US") : "—";
};

/* ---------- stats ---------- */

function renderStats() {
  const rated = reviews.filter((r) => Number.isFinite(r.rating));
  const unusable = reviews.length - rated.length;
  const sum = rated.reduce((total, r) => total + r.rating, 0);
  const avg = rated.length ? sum / rated.length : 0;
  const low = rated.filter((r) => r.rating <= 2).length;
  const productIds = new Set(reviews.map((r) => r.productId).filter(Boolean));

  setText("review-total", reviews.length.toLocaleString());
  setText(
    "review-total-delta",
    unusable
      ? `${unusable} with no usable rating`
      : reviews.length
      ? "All carry a rating"
      : ""
  );
  // Green on a warning reads as reassurance. Colour it like one.
  document
    .getElementById("review-total-delta")
    ?.classList.toggle("admin-stat-delta--negative", unusable > 0);
  document
    .getElementById("review-low")
    ?.parentElement?.querySelector(".admin-stat-delta")
    ?.classList.toggle("admin-stat-delta--negative", low > 0);
  setText("review-avg", rated.length ? avg.toFixed(2) : "—");
  setText(
    "review-avg-delta",
    rated.length ? `Across ${rated.length} rated review${rated.length === 1 ? "" : "s"}` : "No ratings yet"
  );
  setText("review-low", low.toLocaleString());
  setText("review-products", productIds.size.toLocaleString());

  /* A product with no reviews gets avgRating 0 in products.js, which
     sorts it below a genuinely bad product. Worth knowing how many. */
  const unreviewed = products.filter((p) => !productIds.has(p.id)).length;
  setText(
    "review-products-delta",
    products.length ? `${unreviewed} product${unreviewed === 1 ? "" : "s"} with none` : ""
  );
}

/* ---------- filters ---------- */

function buildProductFilter() {
  const ids = [...new Set(reviews.map((r) => r.productId).filter(Boolean))];
  const signature = ids.sort().join("|") + "::" + products.length;
  if (signature === productFilterBuilt) return; // Don't clobber the selection.
  productFilterBuilt = signature;

  const previous = el.productFilter.value;
  el.productFilter.innerHTML =
    '<option value="all">All products</option>' +
    ids
      .map((id) => ({ id, label: productName(id) || `${id} (deleted product)` }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`)
      .join("");
  if ([...el.productFilter.options].some((o) => o.value === previous)) {
    el.productFilter.value = previous;
  }
}

function visible() {
  const term = lower(el.search?.value);
  const product = el.productFilter?.value || "all";
  const rating = el.ratingFilter?.value || "all";

  return reviews.filter((r) => {
    if (product !== "all" && r.productId !== product) return false;

    if (rating === "invalid") {
      if (Number.isFinite(r.rating)) return false;
    } else if (rating === "bad") {
      if (!Number.isFinite(r.rating) || r.rating > 2) return false;
    } else if (rating !== "all") {
      if (Math.round(r.rating) !== Number(rating)) return false;
    }

    if (!term) return true;
    return [r.name, r.comment, r.productId, productName(r.productId)].some((v) =>
      lower(v).includes(term)
    );
  });
}

el.search?.addEventListener("input", render);
el.productFilter?.addEventListener("change", render);
el.ratingFilter?.addEventListener("change", render);

/* ---------- table ---------- */

function render() {
  const rows = visible();

  if (!rows.length) {
    el.list.innerHTML = reviews.length
      ? '<tr><td colspan="6" class="admin-empty">No reviews match this filter.</td></tr>'
      : '<tr><td colspan="6" class="admin-empty">No customer reviews yet. They appear here the moment someone submits one from a product page.</td></tr>';
    return;
  }

  el.list.innerHTML = rows
    .map((r) => {
      const name = productName(r.productId);
      return `<tr>
      <td>${stars(r.rating, r.rawRating)}</td>
      <td>${
        name
          ? escapeHtml(name)
          : `<span class="admin-missing">${escapeHtml(r.productId || "no productId")}</span>
             <div class="admin-table-subtext admin-missing">product not found</div>`
      }</td>
      <td>${escapeHtml(r.name)}</td>
      <td><small>${escapeHtml(
        r.comment.length > 90 ? `${r.comment.slice(0, 90)}…` : r.comment
      )}</small></td>
      <td>${escapeHtml(timeAgo(r.createdAt))}</td>
      <td><div class="admin-product-actions">
        <button type="button" data-action="open" data-id="${escapeHtml(r.id)}">Open</button>
      </div></td>
    </tr>`;
    })
    .join("");
}

/* ---------- per-product aggregate ---------- */

/* Deliberately the SAME arithmetic as loadProductPopularity() in
   products.js: skip anything whose rating is not a number, sum the
   rest, divide by the count. If this ever disagrees with the shop's
   ordering, one of the two has changed and the other has not. */
function renderAggregate() {
  const totals = new Map();
  for (const r of reviews) {
    if (!r.productId) continue;
    const entry = totals.get(r.productId) ||
      { sum: 0, count: 0, spread: [0, 0, 0, 0, 0], poisoned: 0 };

    /* A rating of NaN passes products.js's `typeof r.rating !== "number"`
       test — typeof NaN IS "number" — so the storefront ADDS it, and
       that product's average becomes NaN for every visitor. NaN fails
       every comparison, so the popularity sort then places the product
       arbitrarily. This page excludes it (Number.isFinite), which is
       why the figure here can be right while the shop's is broken.
       Counting them is the only way you would ever find out. */
    if (typeof r.rawRating === "number" && !Number.isFinite(r.rawRating)) {
      entry.poisoned += 1;
      totals.set(r.productId, entry);
      continue;
    }

    if (!Number.isFinite(r.rating)) {
      totals.set(r.productId, entry);
      continue;
    }

    entry.sum += r.rating;
    entry.count += 1;
    entry.spread[Math.max(1, Math.min(5, Math.round(r.rating))) - 1] += 1;
    totals.set(r.productId, entry);
  }

  const rows = [...totals.entries()].filter(([, t]) => t.count || t.poisoned);

  if (!rows.length) {
    el.aggregate.innerHTML =
      '<tr><td colspan="4" class="admin-empty">Nothing to aggregate yet.</td></tr>';
    return;
  }

  el.aggregate.innerHTML = rows
    .map(([id, t]) => ({
      id,
      avg: t.count ? t.sum / t.count : null,
      count: t.count,
      spread: t.spread,
      poisoned: t.poisoned
    }))
    .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.count - a.count)
    .map(
      (row) => `<tr>
      <td>${
        productName(row.id)
          ? escapeHtml(productName(row.id))
          : `<span class="admin-missing">${escapeHtml(row.id)} (deleted)</span>`
      }${
        row.poisoned
          ? `<div class="admin-table-subtext" style="color:#facc15">shop average is broken \u2014 ${
              row.poisoned
            } review(s) with a NaN rating</div>`
          : ""
      }</td>
      <td>${
        row.avg === null
          ? '<span class="admin-missing">no usable ratings</span>'
          : `<strong>${row.avg.toFixed(2)}</strong> ${stars(row.avg)}`
      }</td>
      <td>${row.count}</td>
      <td><div class="admin-chip-row">${row.spread
        .map((n, i) =>
          n
            ? `<span class="admin-chip" title="${n} review${n === 1 ? "" : "s"} gave ${
                i + 1
              } star${i === 0 ? "" : "s"}">${i + 1}\u2605<span class="admin-chip-count">${n}</span></span>`
            : `<span class="admin-chip is-empty" title="no ${i + 1}-star reviews">${
                i + 1
              }\u2605<span class="admin-chip-count">0</span></span>`
        )
        .reverse()
        .join("")}</div></td>
    </tr>`
    )
    .join("");
}

/* ---------- modal ---------- */

function openReview(review) {
  active = review;
  el.modalTitle.textContent = `${
    Number.isFinite(review.rating) ? `${review.rating}-star review` : "Review"
  } by ${review.name}`;

  const name = productName(review.productId);

  el.modalBody.innerHTML = `
    <div class="order-info-grid">
      <p><small>Rating</small><strong>${stars(review.rating, review.rawRating)}</strong></p>
      <p><small>Reviewer</small><strong>${escapeHtml(review.name)}</strong></p>
      <p><small>Product</small>${
        name
          ? escapeHtml(name)
          : `<span class="admin-missing">${escapeHtml(review.productId || "—")} — not found</span>`
      }</p>
      <p><small>Product ID</small><span style="font-family:ui-monospace,monospace;font-size:.72rem;word-break:break-all">${escapeHtml(
        review.productId || "—"
      )}</span></p>
      <p><small>Posted</small>${escapeHtml(when(review.createdAt))}</p>
      <p><small>Review ID</small><span style="font-family:ui-monospace,monospace;font-size:.72rem;word-break:break-all">${escapeHtml(
        review.id
      )}</span></p>
    </div>

    <div class="order-special-request">
      <small>Comment</small>
      <p>${escapeHtml(review.comment) || '<span class="admin-missing">empty</span>'}</p>
    </div>

    ${
      review.extras.length
        ? `<p class="admin-form-subheading" style="margin-top:1rem">Other fields on this record</p>
           <div class="order-info-grid">${review.extras
             .map(
               ([k, v]) =>
                 `<p><small>${escapeHtml(k)}</small>${escapeHtml(
                   v === null || v === undefined || v === ""
                     ? "—"
                     : typeof v === "object"
                     ? JSON.stringify(v)
                     : String(v)
                 )}</p>`
             )
             .join("")}</div>`
        : ""
    }

    ${
      Number.isFinite(review.rating)
        ? ""
        : `<p class="admin-form-hint" style="color:#facc15;margin-top:.9rem">This review's
           <code>rating</code> is not a number, so products.js skips it when computing the
           product's average. It counts toward nothing on the shop.</p>`
    }

    <p class="admin-form-hint" style="margin-top:.9rem">Deleting is permanent and immediately
      changes this product's average rating and its position in the shop's popularity sort.
      The deletion is recorded in the activity log with the comment text, so there is a
      record of what was removed.</p>`;

  el.modal.hidden = false;
  el.backdrop.hidden = false;
}

function closeModal() {
  el.modal.hidden = true;
  el.backdrop.hidden = true;
  el.modalBody.innerHTML = "";
  active = null;
}

el.list?.addEventListener("click", (event) => {
  const button = event.target.closest('button[data-action="open"]');
  if (!button) return;
  const review = reviews.find((r) => r.id === button.dataset.id);
  if (review) openReview(review);
});

document.getElementById("review-modal-close")?.addEventListener("click", closeModal);
document.getElementById("review-modal-cancel")?.addEventListener("click", closeModal);
el.backdrop?.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.modal.hidden) closeModal();
});

el.deleteBtn?.addEventListener("click", async () => {
  if (!active) return;

  const confirmed = window.confirm(
    `Delete this ${Number.isFinite(active.rating) ? `${active.rating}-star ` : ""}review by ${
      active.name
    }?\n\nThis cannot be undone, and it changes the product's average rating on the shop.`
  );
  if (!confirmed) return;

  el.deleteBtn.disabled = true;
  el.deleteBtn.textContent = "Deleting...";

  try {
    await deleteReview(active, adminUser);
    closeModal();
  } catch (err) {
    console.error("Review delete failed:", err);
    showFeedback("That review could not be deleted. Check your Firestore rules.");
  } finally {
    el.deleteBtn.disabled = false;
    el.deleteBtn.textContent = "Delete review";
  }
});