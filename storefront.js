/* ==========================================================
   Trailbound — storefront (customer side)
   ----------------------------------------------------------
   The other half of the admin products page. Whatever an admin
   publishes with status "active" renders here, live.

   Two kinds of container, because the site has two catalogs:

     <div data-trailbound-products></div>   gear from `products`
     <div data-trailbound-trails></div>     trails from `trails`

   Trails are what booking.js offers on the booking form, so a
   trail card links straight into it with ?trail=<trail_id>. Gear
   links to the product page. Only published items render: gear
   with status "active", and trails that aren't Closed.

   Deliberately markup-agnostic, because it has to drop into pages
   that already exist. Put an empty container anywhere and it fills
   itself:

     <div data-trailbound-trails data-limit="3"></div>
     <div data-trailbound-products data-category="Major Climb"></div>
     <div data-trailbound-products data-limit="3" data-layout="list"></div>

   Options, all optional:
     data-category  only this category
     data-limit     show at most N
     data-layout    "grid" (default) or "list"
     data-empty     text to show when nothing is published yet

   It also exposes window.Trailbound so pages with their own
   scripts or inline onclick handlers can reach the same data:

     Trailbound.addToWishlist({ id, name, image, price })
     Trailbound.createBooking({ trailId, trailName, date, ... })
     Trailbound.watchProducts(cb, { activeOnly: true })
   ========================================================== */

import {
  addToWishlist,
  auth,
  collectUnsubscribers,
  createBooking,
  escapeHtml,
  peso,
  watchProducts,
  watchTrails,
  watchWishlist
} from "./trailbound-data.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const track = collectUnsubscribers();

const productContainers = [...document.querySelectorAll("[data-trailbound-products]")];
const trailContainers = [...document.querySelectorAll("[data-trailbound-trails]")];
const containers = [...productContainers, ...trailContainers];

let products = [];
let trails = [];
let wishlistNames = new Set();

/* ---------- live streams ---------- */

if (productContainers.length) {
  productContainers.forEach(showLoading);
  track(
    watchProducts(
      (items) => {
        products = items;
        renderAll();
      },
      {
        // Customers only ever see published gear.
        activeOnly: true,
        onError: () => productContainers.forEach(showError)
      }
    )
  );
}

if (trailContainers.length) {
  trailContainers.forEach(showLoading);
  track(
    watchTrails(
      (items) => {
        // Map trails onto the same card shape as gear. `id` is the
        // trail_id, because that's what booking.js matches on.
        trails = items.map((t) => ({
          id: t.id,
          name: t.name,
          category: [t.difficulty, t.location].filter(Boolean).join(" · "),
          description: t.description,
          price: null,
          image: t.image,
          href: `booking.html?trail=${encodeURIComponent(t.id)}`
        }));
        renderAll();
      },
      { openOnly: true, onError: () => trailContainers.forEach(showError) }
    )
  );
}

/* ---------- wishlist state, so hearts render filled ---------- */

let stopWishlist = null;

onAuthStateChanged(auth, (user) => {
  stopWishlist?.();
  stopWishlist = null;

  if (!user) {
    wishlistNames = new Set();
    renderAll();
    return;
  }

  stopWishlist = track(
    watchWishlist(user.uid, (items) => {
      wishlistNames = new Set(items.flatMap((i) => [i.productId, i.name].filter(Boolean)));
      renderAll();
    })
  );
});

/* ---------- rendering ---------- */

function showLoading(container) {
  container.innerHTML = '<p class="tb-products-empty">Loading trails...</p>';
}

function showError(container) {
  container.innerHTML =
    '<p class="tb-products-empty">Trails could not be loaded right now. Please try again shortly.</p>';
}

function renderAll() {
  containers.forEach(renderInto);
}

function renderInto(container) {
  const isTrails = container.hasAttribute("data-trailbound-trails");
  const category = container.dataset.category;
  const limit = Number(container.dataset.limit) || 0;
  const layout = container.dataset.layout === "list" ? "list" : "grid";

  let items = isTrails ? trails : products;
  if (category) {
    items = items.filter(
      (p) => p.category.toLowerCase() === category.toLowerCase()
    );
  }
  if (limit) items = items.slice(0, limit);

  if (!items.length) {
    container.innerHTML = `<p class="tb-products-empty">${escapeHtml(
      container.dataset.empty ||
        (isTrails
          ? "No trails are open for booking just yet — check back soon."
          : "No gear is available just yet — check back soon.")
    )}</p>`;
    return;
  }

  container.className = `${container.className.replace(/tb-products--\w+/g, "").trim()} tb-products tb-products--${layout}`.trim();
  container.innerHTML = items.map(cardHtml).join("");
}

function cardHtml(product) {
  const saved = wishlistNames.has(product.id) || wishlistNames.has(product.name);
  return `<article class="tb-product-card" data-product-id="${product.id}">
    <div class="tb-product-media">
      ${
        product.image
          ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(
              product.name
            )}" class="tb-product-img" loading="lazy">`
          : '<div class="tb-product-img tb-product-img--placeholder" aria-hidden="true"></div>'
      }
      <button class="tb-wishlist-btn${saved ? " is-saved" : ""}" type="button"
              data-action="wishlist" data-id="${product.id}"
              aria-label="${saved ? "Saved to wishlist" : "Save to wishlist"}"
              aria-pressed="${saved}">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.2 5 5.7 5c2 0 3.4 1.1 4.3 2.4C10.9 6.1 12.3 5 14.3 5c3.5 0 5.3 3.4 3.7 6.7C19.5 16.4 12 21 12 21z"/></svg>
      </button>
    </div>
    <div class="tb-product-body">
      ${product.category ? `<p class="tb-product-category">${escapeHtml(product.category)}</p>` : ""}
      <h3 class="tb-product-name">${escapeHtml(product.name)}</h3>
      ${
        product.description
          ? `<p class="tb-product-desc">${escapeHtml(product.description)}</p>`
          : ""
      }
      <div class="tb-product-footer">
        <span class="tb-product-price">${
          product.price == null ? "" : peso(product.price)
        }</span>
        <a class="tb-product-book" href="${escapeHtml(
          product.href || `products.html?item=${encodeURIComponent(product.id)}`
        )}">${product.href ? "Book now" : "View"}</a>
      </div>
    </div>
  </article>`;
}

/* ---------- wishlist clicks ---------- */

containers.forEach((container) =>
  container.addEventListener("click", async (event) => {
    const button = event.target.closest('[data-action="wishlist"]');
    if (!button) return;

    const user = auth.currentUser;
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    const product = products.find((p) => p.id === button.dataset.id);
    if (!product) return;

    button.disabled = true;
    try {
      await addToWishlist(user.uid, product);
      // The wishlist stream flips the heart on its own.
    } catch (err) {
      console.error("Wishlist save failed:", err);
    } finally {
      button.disabled = false;
    }
  })
);

/* ==========================================================
   Public helper surface for pages that have their own scripts
   ========================================================== */

window.Trailbound = Object.assign(window.Trailbound || {}, {
  get products() {
    return products;
  },
  watchProducts,
  createBooking,
  addToWishlist: (item) => {
    const user = auth.currentUser;
    if (!user) {
      window.location.href = "login.html";
      return Promise.resolve();
    }
    return addToWishlist(user.uid, item);
  }
});
