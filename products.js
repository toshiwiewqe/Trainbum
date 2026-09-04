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
import { collection, getDocs } from 'firebase/firestore';
import { addProductToCart, updateCartBadge, onCartUpdated } from './cart-store.js';

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

  state.maxPrice = PRODUCTS.length ? Math.max(...PRODUCTS.map(p => p.price)) : 0;

  buildPriceInputs();
  buildCategoryTree();
  buildAttributeFilters();
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
    default: sorted.sort((a, b) => b.popularity - a.popularity);
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
  showToast(`Added ${activeProduct.name} to cart`);
}

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
}