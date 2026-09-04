// ==========================================================
// Trailbound shared site header — single source of truth.
//
// Usage on every page (replaces the old hand-copied <header>):
//   <div id="site-header-root"></div>
//   <script src="header.js"></script>
//
// IMPORTANT: this must stay a plain <script src="header.js">
// (no type="module", no defer/async). Plain scripts run
// synchronously the moment the parser hits them, so the header
// — including #cart-count — exists in the DOM before any
// type="module" scripts (auth-nav.js, products.js, booking.js,
// cart.js, checkout.js) run their `document.getElementById(...)`
// lookups. Module scripts are deferred by default, so this
// ordering is guaranteed as long as header.js itself stays plain.
//
// To change a nav link, badge, or active-state rule, edit it
// ONCE here — every page picks it up automatically.
// ==========================================================

(function () {
  const root = document.getElementById("site-header-root");
  if (!root) return;

  const path = window.location.pathname.split("/").pop() || "index.html";
  const hash = window.location.hash;

  const isTrails = path === "index.html" && hash === "#trails";
  const isHome = path === "index.html" && !isTrails;
  const isProducts = path === "products.html";
  const isBooking = path === "booking.html";
  const isCart = path === "cart.html";

  const cls = (isActive) => (isActive ? ' class="active"' : "");

  // Optional modifier, e.g. <div id="site-header-root" data-variant="site-header--static">
  const variant = root.dataset.variant ? ` ${root.dataset.variant}` : "";

  root.outerHTML = `
    <header class="site-header${variant}" id="site-header">
      <nav class="navbar navbar-expand-md w-100 p-0">
        <div class="site-header-logo">
          <img src="finaltrailboundlogo.png" alt="TrailBound Adventures logo" />
        </div>
        <button
          class="navbar-toggler site-header-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#siteHeaderNav"
          aria-controls="siteHeaderNav"
          aria-expanded="false"
          aria-label="Toggle navigation"
        >
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="siteHeaderNav">
          <div class="site-header-nav">
            <a href="index.html"${cls(isHome)}>Home</a>
            <a href="index.html#trails"${cls(isTrails)}>Trails</a>
            <a href="products.html"${cls(isProducts)}>Products</a>
            <a href="booking.html"${cls(isBooking)}>Book Now</a>
            <a href="#">Contact</a>
            <a href="login.html">Log In</a>
            <span class="cart-badge">
              <a href="cart.html" class="account-icon-link${isCart ? " active" : ""}" aria-label="Cart">
                🛒
                <span id="cart-count" class="cart-count" hidden>0</span>
              </a>
            </span>
          </div>
        </div>
      </nav>
    </header>
  `;
})();
