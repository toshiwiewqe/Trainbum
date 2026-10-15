// ==========================================================
// Trailbound shared site footer — single source of truth.
//
// Paste these two lines at the bottom of every page, just before
// </body> (same idea as the header):
//
//   <div id="site-footer-root"></div>
//   <script type="module" src="footer.js"></script>
//
// To change a link, phone number or email, edit it ONCE here and
// every page picks it up. The styles are in styles.css under
// "SITE FOOTER".
// ==========================================================

const root = document.getElementById("site-footer-root");

if (root) {
  const year = new Date().getFullYear();

  root.outerHTML = `
    <footer class="site-footer" id="site-footer">
      <div class="site-footer-inner">
        <div class="site-footer-top">

          <div class="site-footer-brand">
            <a href="index.html" class="site-footer-logo" aria-label="Trailbound home">
              <img src="/logoo2.jpg" alt="Trailbound Adventures logo" />
            </a>
            <p class="site-footer-tagline">Your basecamp for Luzon's trails. Plan it, book it, climb it.</p>
            <a href="booking.html" class="site-footer-cta">
              Book a trek
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>
              </svg>
            </a>
          </div>

          <nav class="site-footer-col" aria-label="Explore">
            <span class="site-footer-label">Explore</span>
            <a href="trail.html">Trails</a>
            <a href="booking.html">Book a trek</a>
            <a href="about.html">About us</a>
          </nav>

          <nav class="site-footer-col" aria-label="Shop and help">
            <span class="site-footer-label">Shop &amp; help</span>
            <a href="products.html">Hiking gear</a>
            <a href="cart.html">Your cart</a>
            <a href="contact.html">Contact &amp; support</a>
          </nav>

          <div class="site-footer-col">
            <span class="site-footer-label">Connect</span>
            <a href="https://instagram.com/trailbound.ph" target="_blank" rel="noopener" class="site-footer-social">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                   stroke-width="1.8" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5"></rect>
                <circle cx="12" cy="12" r="4"></circle>
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"></circle>
              </svg>
              Instagram
            </a>
            <a href="https://facebook.com/trailbound.ph" target="_blank" rel="noopener" class="site-footer-social">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V9H7v3.5h2V21h3.5v-8.5h2.5l.5-3.5h-3V7a1 1 0 0 1 1-1H15z"></path>
              </svg>
              Facebook
            </a>
          </div>

          <div class="site-footer-col">
            <span class="site-footer-label">Reach us</span>
            <a href="tel:+639261234567" class="site-footer-nowrap">+63 926 123 4567</a>
            <a href="mailto:hello@trailbound.ph">hello@trailbound.ph</a>
            <span class="site-footer-note">Based in the Philippines</span>
          </div>

        </div>

        <div class="site-footer-bottom">
          <span>&copy; ${year} Trailbound. All rights reserved.</span>
          <button type="button" class="site-footer-top-btn" id="site-footer-top-btn">
            Back to top
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path>
            </svg>
          </button>
        </div>
      </div>
    </footer>
  `;

  // Back to top. The homepage scrolls with Lenis; if script.js has
  // shared it as window.lenis, use it so the scroll stays smooth.
  document.getElementById("site-footer-top-btn")?.addEventListener("click", () => {
    if (window.lenis?.scrollTo) {
      window.lenis.scrollTo(0);
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}
