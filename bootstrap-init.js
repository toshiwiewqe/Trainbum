// ==========================================================
// Loads Bootstrap's JS bundle (Popper included) so components
// driven by data-bs-* attributes work: navbar-toggler collapse,
// the products-page offcanvas filter drawer, etc.
//
// Include on every page as a module script, after header.js:
//   <script type="module" src="bootstrap-init.js"></script>
//
// This only needs to run once per page — it attaches Bootstrap's
// event listeners globally, so any data-bs-toggle markup anywhere
// on the page (including markup injected later, like header.js's
// navbar) will work without further setup.
// ==========================================================
import "bootstrap/dist/js/bootstrap.bundle.min.js";
