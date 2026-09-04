/* ==========================================================
   Trailbound — Product Catalog
   Search, filter, sort, and detail-drawer logic.

   CATEGORY_TREE / COLORS / SIZES come from taxonomy.js, which is
   loaded as a classic <script> tag BEFORE this file in products.html:

     <script src="taxonomy.js"></script>
     <script type="module" src="products.js"></script>

   Product inventory itself is loaded from Firestore at startup —
   run seed-products.cjs once (see that file) to populate it.

   Cart handling lives in cart-store.js and is shared with
   booking.js, cart.js, and checkout.js — see that file for the
   cart item shape and persistence approach.
   ========================================================== */

import { db } from './firebase-config.js';
import { collection, getDocs, query, where, addDoc } from 'firebase/firestore';
import { addProductToCart, updateCartBadge, onCartUpdated, getCart } from './cart-store.js';

let PRODUCTS = [];

/* ---------- Load products from Firestore ---------- */
async function loadProducts() {
  const snapshot = await getDocs(collection(db, "products"));
  PRODUCTS = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      // Firestore Timestamps -> ISO strings, so the rest of the app
      // can keep using `new Date(p.dateAdded)` unchanged.
      dateAdded: data.dateAdded && data.dateAdded.toDate
        ? data.dateAdded.toDate().toISOString()
        : data.dateAdded
    };
  });
}

/* ---------- Popularity, derived from product_reviews ----------
   "Popularity" isn't a stored field — it's computed from ratings:
   highest average star rating first, ties broken by review count.
   Reads the whole product_reviews collection once (same pattern as
   loading trails/guides/packages elsewhere) and attaches
   avgRating/reviewCount onto each product in PRODUCTS. ---------- */
async function loadProductPopularity() {
  const totals = {}; // productId -> { sum, count }

  try {
    const snapshot = await getDocs(collection(db, "product_reviews"));
    snapshot.docs.forEach(doc => {
      const r = doc.data();
      if (!r.productId || typeof r.rating !== "number") return;
      if (!totals[r.productId]) totals[r.productId] = { sum: 0, count: 0 };
      totals[r.productId].sum += r.rating;
      totals[r.productId].count += 1;
    });
  } catch (err) {
    console.error("Failed to load review aggregates for popularity sort:", err);
  }

  PRODUCTS.forEach(p => {
    const t = totals[p.id];
    p.avgRating = t ? t.sum / t.count : 0;
    p.reviewCount = t ? t.count : 0;
  });
}

/* ==========================================================
   App state
   ========================================================== */
const state = {
  search: "",
  category: "All",
  subcategory: "All",
  minPrice: 0,
  maxPrice: 0, // set once PRODUCTS has loaded, see init()
  sizes: new Set(),
  colors: new Set(),
  sort: "popularity"
};

/* ==========================================================
   DOM refs
   ========================================================== */
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  els.grid = document.getElementById("products-grid");
  els.status = document.getElementById("products-status");
  els.search = document.getElementById("products-search");
  els.sort = document.getElementById("products-sort");
  els.categoryTree = document.getElementById("products-category-tree");
  els.priceMin = document.getElementById("products-price-min");
  els.priceMax = document.getElementById("products-price-max");
  els.priceMinLabel = document.getElementById("products-price-min-label");
  els.priceMaxLabel = document.getElementById("products-price-max-label");
  els.sizeFilters = document.getElementById("products-size-filters");
  els.colorFilters = document.getElementById("products-color-filters");
  els.resultCount = document.getElementById("products-result-count");
  els.clearFilters = document.getElementById("products-clear-filters");
  els.cartCount = document.getElementById("cart-count");
  els.toast = document.getElementById("cart-toast");

  els.drawer = document.getElementById("product-drawer");
  els.drawerBackdrop = document.getElementById("product-drawer-backdrop");
  els.drawerClose = document.getElementById("product-drawer-close");
  els.drawerImgMain = document.getElementById("drawer-img-main");
  els.drawerThumbs = document.getElementById("drawer-thumbs");
  els.drawerTitle = document.getElementById("drawer-title");
  els.drawerCategory = document.getElementById("drawer-category");
  els.drawerPrice = document.getElementById("drawer-price");
  els.drawerDesc = document.getElementById("drawer-desc");
  els.drawerSpecs = document.getElementById("drawer-specs");
  els.drawerSizeRow = document.getElementById("drawer-size-row");
  els.drawerSizeOpts = document.getElementById("drawer-size-opts");
  els.drawerColorRow = document.getElementById("drawer-color-row");
  els.drawerColorOpts = document.getElementById("drawer-color-opts");
  els.drawerQty = document.getElementById("drawer-qty");
  els.drawerAddBtn = document.getElementById("drawer-add-btn");
  els.drawerStock = document.getElementById("drawer-stock");

  els.reviewsSummary = document.getElementById("drawer-reviews-summary");
  els.reviewList = document.getElementById("drawer-review-list");
  els.reviewMoreBtn = document.getElementById("drawer-review-more-btn");
  els.reviewStarsInput = document.getElementById("drawer-review-stars-input");
  els.reviewName = document.getElementById("drawer-review-name");
  els.reviewComment = document.getElementById("drawer-review-comment");
  els.reviewSubmitBtn = document.getElementById("drawer-review-submit-btn");
  els.reviewFeedback = document.getElementById("drawer-review-feedback");

  els.status.hidden = false;
  els.status.textContent = "Loading gear…";

  // Cart badge should reflect reality immediately, and stay in sync if
  // the cart changes in another tab (e.g. removed from cart.html).
  updateCartBadge(els.cartCount);
  onCartUpdated(() => updateCartBadge(els.cartCount));

  try {
    await loadProducts();
  } catch (err) {
    console.error("Failed to load products from Firestore:", err);
    els.status.textContent = "Couldn't load the catalog right now. Please refresh or try again shortly.";
    return;
  }

  await loadProductPopularity();

  state.maxPrice = PRODUCTS.length ? Math.max(...PRODUCTS.map(p => p.price)) : 0;

  buildPriceInputs();
  buildCategoryTree();
  buildAttributeFilters();
  buildReviewStarsInput();
  bindEvents();
  render();
}

/* ---------- Sidebar builders ---------- */
function buildPriceInputs() {
  const max = state.maxPrice;
  els.priceMin.max = max;
  els.priceMax.max = max;
  els.priceMin.value = 0;
  els.priceMax.value = max;
  updatePriceLabels();
}

function updatePriceLabels() {
  els.priceMinLabel.textContent = "₱" + Number(els.priceMin.value).toLocaleString();
  els.priceMaxLabel.textContent = "₱" + Number(els.priceMax.value).toLocaleString();
}

function buildCategoryTree() {
  const wrap = els.categoryTree;
  wrap.innerHTML = "";

  const allBtn = categoryButton("All", "All", "All");
  allBtn.classList.add("is-active");
  wrap.appendChild(allBtn);

  Object.entries(CATEGORY_TREE).forEach(([cat, subs]) => {
    const catBtn = categoryButton(cat, cat, "All");
    wrap.appendChild(catBtn);

    const list = document.createElement("div");
    list.className = "products-subtree";

    if (Array.isArray(subs)) {
      subs.forEach(sub => list.appendChild(categoryButton(sub, cat, sub, true)));
    } else {
      // nested (Merchandise)
      Object.entries(subs).forEach(([groupName, groupSubs]) => {
        const groupLabel = document.createElement("div");
        groupLabel.className = "products-subtree-group";
        groupLabel.textContent = groupName;
        list.appendChild(groupLabel);
        groupSubs.forEach(sub => list.appendChild(categoryButton(sub, cat, sub, true)));
      });
    }
    wrap.appendChild(list);
  });
}

function categoryButton(label, cat, sub, indent) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "products-cat-btn" + (indent ? " indent" : "");
  btn.textContent = label;
  btn.dataset.cat = cat;
  btn.dataset.sub = sub;
  btn.addEventListener("click", () => {
    state.category = cat;
    state.subcategory = sub;
    document.querySelectorAll(".products-cat-btn").forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    render();
  });
  return btn;
}

function buildAttributeFilters() {
  els.sizeFilters.innerHTML = "";
  SIZES.forEach(size => {
    els.sizeFilters.appendChild(chip(size, () => toggleSetValue(state.sizes, size)));
  });
  els.colorFilters.innerHTML = "";
  COLORS.forEach(color => {
    els.colorFilters.appendChild(chip(color, () => toggleSetValue(state.colors, color)));
  });
}

function chip(label, onToggle) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "products-chip";
  b.textContent = label;
  b.addEventListener("click", () => {
    b.classList.toggle("is-active");
    onToggle();
    render();
  });
  return b;
}

function toggleSetValue(set, val) {
  if (set.has(val)) set.delete(val);
  else set.add(val);
}

/* ---------- Event bindings ---------- */
function bindEvents() {
  els.search.addEventListener("input", () => {
    state.search = els.search.value.trim().toLowerCase();
    render();
  });

  els.sort.addEventListener("change", () => {
    state.sort = els.sort.value;
    render();
  });

  els.priceMin.addEventListener("input", () => {
    if (Number(els.priceMin.value) > Number(els.priceMax.value)) {
      els.priceMin.value = els.priceMax.value;
    }
    state.minPrice = Number(els.priceMin.value);
    updatePriceLabels();
    render();
  });

  els.priceMax.addEventListener("input", () => {
    if (Number(els.priceMax.value) < Number(els.priceMin.value)) {
      els.priceMax.value = els.priceMin.value;
    }
    state.maxPrice = Number(els.priceMax.value);
    updatePriceLabels();
    render();
  });

  els.clearFilters.addEventListener("click", () => {
    state.search = "";
    state.category = "All";
    state.subcategory = "All";
    state.sizes.clear();
    state.colors.clear();
    state.sort = "popularity";
    els.search.value = "";
    els.sort.value = "popularity";
    document.querySelectorAll(".products-chip").forEach(c => c.classList.remove("is-active"));
    document.querySelectorAll(".products-cat-btn").forEach(b => b.classList.remove("is-active"));
    document.querySelector('.products-cat-btn[data-cat="All"]').classList.add("is-active");
    buildPriceInputs();
    render();
  });

  els.drawerClose.addEventListener("click", closeDrawer);
  els.drawerBackdrop.addEventListener("click", closeDrawer);
  els.drawerAddBtn.addEventListener("click", addActiveToCart);
  els.reviewSubmitBtn.addEventListener("click", handleReviewSubmit);
  els.reviewMoreBtn.addEventListener("click", () => {
    visibleReviewCount += REVIEWS_PAGE_SIZE;
    renderReviewList();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeDrawer();
  });
}

/* ==========================================================
   Filtering, sorting, rendering
   ========================================================== */
function getFilteredProducts() {
  return PRODUCTS.filter(p => {
    if (state.category !== "All" && p.category !== state.category) return false;
    if (state.subcategory !== "All" && p.subcategory !== state.subcategory) return false;
    if (p.price < state.minPrice || p.price > state.maxPrice) return false;

    if (state.search) {
      const hay = `${p.name} ${p.category} ${p.subcategory}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }

    if (state.sizes.size > 0) {
      const hasMatch = p.attributes.size.some(s => state.sizes.has(s));
      if (!hasMatch) return false;
    }

    if (state.colors.size > 0) {
      const hasMatch = p.attributes.color.some(c => state.colors.has(c));
      if (!hasMatch) return false;
    }

    return true;
  });
}

function getSortedProducts(list) {
  const sorted = [...list];
  switch (state.sort) {
    case "price-asc": sorted.sort((a, b) => a.price - b.price); break;
    case "price-desc": sorted.sort((a, b) => b.price - a.price); break;
    case "name-asc": sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
    case "newest": sorted.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded)); break;
    case "popularity":
    default:
      sorted.sort((a, b) => {
        const avgDiff = (b.avgRating || 0) - (a.avgRating || 0);
        if (avgDiff !== 0) return avgDiff;
        return (b.reviewCount || 0) - (a.reviewCount || 0);
      });
  }
  return sorted;
}

function render() {
  const filtered = getSortedProducts(getFilteredProducts());
  els.resultCount.textContent = filtered.length;

  els.grid.innerHTML = "";

  if (filtered.length === 0) {
    els.status.hidden = false;
    els.status.textContent = "No gear matches those filters yet. Try widening your search.";
    return;
  }
  els.status.hidden = true;

  filtered.forEach(p => els.grid.appendChild(productCard(p)));
}

function productCard(p) {
  const card = document.createElement("article");
  // "col" classes place this card in the Bootstrap row (#products-grid);
  // "product-card" keeps all the existing look/behavior from styles.css
  card.className = "col product-card";
  card.innerHTML = `
    <div class="product-card-img">
      <img src="${p.images[0]}" alt="${p.name}" loading="lazy">
      ${!p.inStock ? '<span class="product-badge product-badge--out">Sold Out</span>' : ""}
    </div>
    <div class="product-card-body">
      <span class="product-card-cat">${p.subcategory}</span>
      <h4>${p.name}</h4>
      <div class="product-card-footer">
        <span class="product-card-price">₱${p.price.toLocaleString()}</span>
        <button type="button" class="product-card-btn">View</button>
      </div>
    </div>
  `;
  card.querySelector(".product-card-btn").addEventListener("click", () => openDrawer(p));
  card.querySelector(".product-card-img").addEventListener("click", () => openDrawer(p));
  return card;
}

/* ==========================================================
   Product detail drawer
   ========================================================== */
let activeProduct = null;
let activeImageIndex = 0;
let selectedSize = null;
let selectedColor = null;

function openDrawer(p) {
  activeProduct = p;
  activeImageIndex = 0;
  selectedSize = p.attributes.size[0] || null;
  selectedColor = p.attributes.color[0] || null;

  els.drawerTitle.textContent = p.name;
  els.drawerCategory.textContent = `${p.category} — ${p.subcategory}`;
  els.drawerPrice.textContent = "₱" + p.price.toLocaleString();
  els.drawerDesc.textContent = p.description;
  els.drawerStock.textContent = p.inStock ? "In stock" : "Currently sold out";
  els.drawerStock.className = "drawer-stock" + (p.inStock ? "" : " drawer-stock--out");
  els.drawerAddBtn.disabled = !p.inStock;
  els.drawerAddBtn.textContent = p.inStock ? "Add to Cart" : "Sold Out";
  els.drawerQty.value = 1;

  renderDrawerImages();
  renderDrawerSpecs();
  renderDrawerAttributes();

  selectedRating = 0;
  renderReviewStarsInput();
  els.reviewName.value = "";
  els.reviewComment.value = "";
  els.reviewFeedback.hidden = true;
  loadReviews(p.id);

  els.drawer.classList.add("is-open");
  els.drawerBackdrop.classList.add("is-open");
  document.body.style.overflow = "hidden";
}

function closeDrawer() {
  els.drawer.classList.remove("is-open");
  els.drawerBackdrop.classList.remove("is-open");
  document.body.style.overflow = "";
}

function renderDrawerImages() {
  const p = activeProduct;
  els.drawerImgMain.src = p.images[activeImageIndex];
  els.drawerImgMain.alt = p.name;

  els.drawerThumbs.innerHTML = "";
  p.images.forEach((src, idx) => {
    const t = document.createElement("button");
    t.type = "button";
    t.className = "drawer-thumb" + (idx === activeImageIndex ? " is-active" : "");
    t.innerHTML = `<img src="${src}" alt="${p.name} view ${idx + 1}">`;
    t.addEventListener("click", () => {
      activeImageIndex = idx;
      renderDrawerImages();
    });
    els.drawerThumbs.appendChild(t);
  });
}

function renderDrawerSpecs() {
  els.drawerSpecs.innerHTML = "";
  Object.entries(activeProduct.specs).forEach(([key, val]) => {
    const row = document.createElement("div");
    row.className = "drawer-spec-row";
    row.innerHTML = `<span>${key}</span><span>${val}</span>`;
    els.drawerSpecs.appendChild(row);
  });
}

function renderDrawerAttributes() {
  const p = activeProduct;

  if (p.attributes.size.length) {
    els.drawerSizeRow.hidden = false;
    els.drawerSizeOpts.innerHTML = "";
    p.attributes.size.forEach(size => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "drawer-opt" + (size === selectedSize ? " is-active" : "");
      b.textContent = size;
      b.addEventListener("click", () => {
        selectedSize = size;
        renderDrawerAttributes();
      });
      els.drawerSizeOpts.appendChild(b);
    });
  } else {
    els.drawerSizeRow.hidden = true;
  }

  if (p.attributes.color.length) {
    els.drawerColorRow.hidden = false;
    els.drawerColorOpts.innerHTML = "";
    p.attributes.color.forEach(color => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "drawer-opt" + (color === selectedColor ? " is-active" : "");
      b.textContent = color;
      b.addEventListener("click", () => {
        selectedColor = color;
        renderDrawerAttributes();
      });
      els.drawerColorOpts.appendChild(b);
    });
  } else {
    els.drawerColorRow.hidden = true;
  }
}

function addActiveToCart() {
  if (!activeProduct || !activeProduct.inStock) return;
  const qty = Math.max(1, Number(els.drawerQty.value) || 1);

  // addProductToCart() silently merges into an existing line when the
  // same product+size+color combo is already in the cart (see
  // cart-store.js), so check for that match *before* calling it — this
  // is the only way to tell the user "you already had this" instead of
  // just "added", since the store itself doesn't report which happened.
  const alreadyInCart = getCart().some(
    (i) =>
      i.type === "product" &&
      i.productId === activeProduct.id &&
      i.size === selectedSize &&
      i.color === selectedColor
  );

  addProductToCart({
    productId: activeProduct.id,
    name: activeProduct.name,
    price: activeProduct.price,
    qty,
    image: activeProduct.images[0],
    size: selectedSize,
    color: selectedColor,
  });

  updateCartBadge(els.cartCount);

  if (alreadyInCart) {
    // Read the line back from the store rather than recomputing the merge
    // math ourselves, so the number shown always matches what's actually
    // in the cart (including the 10-unit cap in cart-store.js).
    const updatedLine = getCart().find(
      (i) => i.type === "product" && i.productId === activeProduct.id && i.size === selectedSize && i.color === selectedColor
    );
    const newQty = updatedLine ? updatedLine.qty : qty;
    showToast(`Already in your cart — quantity updated to ${newQty}`, "already");
    flashAddButton("Already in cart");
  } else {
    showToast(`Added ${activeProduct.name} to cart`, "added");
    flashAddButton("Added ✓");
  }
}

let addBtnResetTimer = null;
function flashAddButton(label) {
  const btn = els.drawerAddBtn;
  const originalLabel = activeProduct.inStock ? "Add to Cart" : "Sold Out";
  btn.textContent = label;
  btn.classList.add("drawer-add-btn--flash");
  clearTimeout(addBtnResetTimer);
  addBtnResetTimer = setTimeout(() => {
    btn.textContent = originalLabel;
    btn.classList.remove("drawer-add-btn--flash");
  }, 1600);
}

let toastTimer = null;
function showToast(message, variant = "added") {
  els.toast.textContent = message;
  els.toast.classList.remove("cart-toast--already", "cart-toast--added");
  els.toast.classList.add("is-visible", variant === "already" ? "cart-toast--already" : "cart-toast--added");
  clearTimeout(toastTimer);
  const duration = variant === "already" ? 3200 : 2200;
  toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), duration);
}

/* ==========================================================
   Ratings & Reviews
   Stored in a new "product_reviews" collection, one doc per
   review: { productId, name, rating, comment, created_at }.

   No purchase/account verification yet, same as
   support_messages in contact.js — anyone can post. Make sure
   Firestore rules allow create on this collection the same way
   they already do for orders/support_messages/bookings.

   Query is equality-only (where productId ==) with sorting done
   client-side, so it doesn't need a composite Firestore index —
   if this list ever needs server-side pagination, add
   orderBy("created_at", "desc") and create that index then.
   ========================================================== */
let activeReviews = [];
let selectedRating = 0;
let visibleReviewCount = 5;
const REVIEWS_PAGE_SIZE = 5;

function buildReviewStarsInput() {
  els.reviewStarsInput.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "drawer-review-star-btn";
    b.textContent = "★";
    b.setAttribute("aria-label", `${i} star${i > 1 ? "s" : ""}`);
    b.addEventListener("click", () => {
      selectedRating = i;
      renderReviewStarsInput();
    });
    els.reviewStarsInput.appendChild(b);
  }
  renderReviewStarsInput();
}

function renderReviewStarsInput() {
  [...els.reviewStarsInput.children].forEach((btn, idx) => {
    btn.classList.toggle("is-active", idx < selectedRating);
  });
}

function starString(rating) {
  const rounded = Math.round(rating);
  return "★".repeat(rounded) + "☆".repeat(5 - rounded);
}

// User-supplied text (name/comment) goes through this before it's
// ever placed in innerHTML — there's no auth or moderation on these
// yet, so treat every review as untrusted input.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatReviewDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function loadReviews(productId) {
  els.reviewList.innerHTML = "";
  els.reviewsSummary.innerHTML = `<span class="drawer-reviews-summary-count">Loading reviews…</span>`;

  try {
    const q = query(collection(db, "product_reviews"), where("productId", "==", productId));
    const snapshot = await getDocs(q);
    activeReviews = snapshot.docs
      .map(doc => doc.data())
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } catch (err) {
    console.error("Failed to load reviews:", err);
    activeReviews = [];
  }

  visibleReviewCount = REVIEWS_PAGE_SIZE;
  renderReviewsSummary();
  renderReviewList();
}

function renderReviewsSummary() {
  if (activeReviews.length === 0) {
    els.reviewsSummary.innerHTML = `<span class="drawer-reviews-summary-count">No reviews yet — be the first!</span>`;
    return;
  }

  const avg = activeReviews.reduce((sum, r) => sum + r.rating, 0) / activeReviews.length;
  els.reviewsSummary.innerHTML = `
    <span class="drawer-reviews-summary-stars">${starString(avg)}</span>
    <span class="drawer-reviews-summary-avg">${avg.toFixed(1)}</span>
    <span class="drawer-reviews-summary-count">(${activeReviews.length} review${activeReviews.length === 1 ? "" : "s"})</span>
  `;
}

function renderReviewList() {
  const visible = activeReviews.slice(0, visibleReviewCount);

  els.reviewList.innerHTML = visible
    .map(r => `
      <div class="drawer-review-item">
        <div class="drawer-review-item-header">
          <span class="drawer-review-item-name">${escapeHtml(r.name)}</span>
          <span class="drawer-review-item-date">${formatReviewDate(r.created_at)}</span>
        </div>
        <div class="drawer-review-item-stars">${starString(r.rating)}</div>
        <p class="drawer-review-item-comment">${escapeHtml(r.comment)}</p>
      </div>
    `)
    .join("");

  const remaining = activeReviews.length - visible.length;
  els.reviewMoreBtn.hidden = remaining <= 0;
  if (remaining > 0) {
    els.reviewMoreBtn.textContent = `See ${Math.min(REVIEWS_PAGE_SIZE, remaining)} more review${Math.min(REVIEWS_PAGE_SIZE, remaining) === 1 ? "" : "s"}`;
  }
}

async function handleReviewSubmit() {
  if (!activeProduct) return;

  const name = els.reviewName.value.trim();
  const comment = els.reviewComment.value.trim();

  if (selectedRating === 0) {
    showReviewFeedback("Please select a star rating.", true);
    return;
  }
  if (!name || !comment) {
    showReviewFeedback("Please add your name and a short review.", true);
    return;
  }

  els.reviewSubmitBtn.disabled = true;
  els.reviewSubmitBtn.textContent = "Submitting...";

  try {
    await addDoc(collection(db, "product_reviews"), {
      productId: activeProduct.id,
      name,
      rating: selectedRating,
      comment,
      created_at: new Date().toISOString(),
      // TODO (after Auth/verified-purchase is added): attach
      // `user_id` and a `verified_purchase` flag here, same idea
      // as the user_id TODO already in checkout.js.
    });

    selectedRating = 0;
    renderReviewStarsInput();
    els.reviewName.value = "";
    els.reviewComment.value = "";
    showReviewFeedback("Thanks for your review!", false);
    await loadReviews(activeProduct.id);

    // Keep popularity sort accurate immediately, without waiting for a
    // refresh — activeReviews was just refetched by loadReviews() above.
    activeProduct.reviewCount = activeReviews.length;
    activeProduct.avgRating = activeReviews.length
      ? activeReviews.reduce((sum, r) => sum + r.rating, 0) / activeReviews.length
      : 0;
    if (state.sort === "popularity") render();
  } catch (err) {
    console.error("Failed to submit review:", err);
    showReviewFeedback("Something went wrong submitting your review. Please try again.", true);
  } finally {
    els.reviewSubmitBtn.disabled = false;
    els.reviewSubmitBtn.textContent = "Submit Review";
  }
}

function showReviewFeedback(message, isError) {
  els.reviewFeedback.textContent = message;
  els.reviewFeedback.hidden = false;
  els.reviewFeedback.classList.toggle("drawer-review-feedback--error", isError);
}