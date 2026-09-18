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
//
// --- MENU (below md) ---------------------------------------
// The panel is a Bootstrap RESPONSIVE offcanvas (.offcanvas-md):
// below 768px it's a full-screen panel, at >=768px Bootstrap
// strips the offcanvas styling itself and the links sit inline
// as pills exactly as before. The fade + stagger + hamburger-to-X
// are CSS only (see the "SITE HEADER MENU" block in styles.css);
// this file just flips two body classes so the CSS has something
// to hang off.
//
// Requires Bootstrap's Offcanvas JS. If bootstrap-init.js only
// imports specific components, make sure Offcanvas is one of them:
//   import "bootstrap/js/dist/offcanvas";
// (a plain `import "bootstrap"` / the bundle already covers it).
// ==========================================================

(function () {
  const root = document.getElementById("site-header-root");
  if (!root) return;

  const path = window.location.pathname.split("/").pop() || "index.html";

  // Trails used to be a #trails section at the bottom of the
  // homepage, so this link was "index.html#trails" and the active
  // state was decided by the hash. It's a standalone page now, so
  // the hash plays no part in routing anymore.
  const isTrails = path === "trail.html";
  const isHome = path === "index.html";
  const isProducts = path === "products.html";
  const isBooking = path === "booking.html";
  const isCart = path === "cart.html";
  const isContact = path === "contact.html";

  const cls = (isActive) => (isActive ? ' class="active"' : "");

  // Optional modifier, e.g. <div id="site-header-root" data-variant="site-header--static">
  const variant = root.dataset.variant ? ` ${root.dataset.variant}` : "";

  root.outerHTML = `
    <header class="site-header${variant}" id="site-header">
      <nav class="navbar navbar-expand-md w-100 p-0">
        <div class="site-header-logo">
          <img src="public/logoo2.jpg" alt="Trailbound Adventures logo" />
        </div>

        <!-- Two bars instead of Bootstrap's .navbar-toggler-icon SVG:
             they have to be separate elements so CSS can rotate them
             into an X. .navbar-toggler is kept so navbar-expand-md
             still hides the button at >=768px. -->
        <button
          class="navbar-toggler site-header-toggler"
          type="button"
          data-bs-toggle="offcanvas"
          data-bs-target="#siteHeaderNav"
          aria-controls="siteHeaderNav"
          aria-expanded="false"
          aria-label="Toggle navigation"
        >
          <span class="tb-bar"></span>
          <span class="tb-bar"></span>
        </button>

        <!-- .offcanvas-md (NOT .offcanvas): full-screen panel below
             md, plain static markup at md and up. backdrop="false"
             because the panel itself covers the viewport — the page
             behind is dimmed by CSS (body.nav-open) instead. -->
        <div
          class="offcanvas-md offcanvas-top site-header-menu"
          tabindex="-1"
          id="siteHeaderNav"
          data-bs-backdrop="false"
          data-bs-scroll="false"
          aria-label="Main navigation"
        >
          <div class="offcanvas-body">
            <div class="site-header-nav">
              <a href="index.html"${cls(isHome)}>Home</a>
              <a href="trail.html"${cls(isTrails)}>Trails</a>
              <a href="products.html"${cls(isProducts)}>Products</a>
              <a href="booking.html"${cls(isBooking)}>Book Now</a>
              <a href="contact.html"${cls(isContact)}>Contact</a>
              <a href="login.html">Log In</a>
              <span class="cart-badge">
                <a href="cart.html" class="account-icon-link${isCart ? " active" : ""}" aria-label="Cart">
                  🛒
                  <span id="cart-count" class="cart-count" hidden>0</span>
                </a>
              </span>
            </div>
          </div>
        </div>
      </nav>
    </header>
  `;

  // --- menu open/close state --------------------------------
  // `show.bs.offcanvas` etc. are ordinary DOM events that Bootstrap
  // dispatches on the element, so these listeners can be attached
  // now even though Bootstrap itself (a module) hasn't loaded yet.
  const menu = document.getElementById("siteHeaderNav");
  const toggler = document.querySelector(".site-header-toggler");
  if (!menu || !toggler) return;

  // Two classes, deliberately:
  //   nav-open  on show -> hide     drives the X, the fade, the dim
  //   nav-busy  on show -> hidden   keeps the header stacked above
  //                                 the panel until the fade-out has
  //                                 actually finished, so you can see
  //                                 the X unfold back into two bars
  const open = () => {
    document.body.classList.add("nav-open", "nav-busy");
    toggler.classList.add("is-open");
    toggler.setAttribute("aria-expanded", "true");
    // Lenis keeps scrolling under an overflow:hidden body, so pause
    // it if script.js has exposed the instance (window.lenis = lenis).
    window.lenis?.stop?.();
  };

  const close = () => {
    document.body.classList.remove("nav-open");
    toggler.classList.remove("is-open");
    toggler.setAttribute("aria-expanded", "false");
    window.lenis?.start?.();
  };

  menu.addEventListener("show.bs.offcanvas", open);
  menu.addEventListener("hide.bs.offcanvas", close);
  menu.addEventListener("hidden.bs.offcanvas", () => {
    document.body.classList.remove("nav-busy");
  });

  // Crossing up past the md breakpoint turns the panel back into a
  // static row; drop the leftover state so the page isn't left dimmed.
  window.addEventListener("resize", () => {
    if (window.innerWidth >= 768 && document.body.classList.contains("nav-open")) {
      close();
      document.body.classList.remove("nav-busy");
    }
  });
})();