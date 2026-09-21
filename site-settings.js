/* ==========================================================
   Trailbound — site settings on the customer side
   ----------------------------------------------------------
   Watches settings/site, the same document the admin settings
   page writes. Saving there updates the public pages live.

   Include on any public page:
     <script type="module" src="site-settings.js"></script>

   It fills anything tagged with a data attribute:
     <span data-site="name"></span>      -> site name
     <span data-site="timezone"></span>  -> timezone label
     <span data-site="year"></span>      -> current year

   and keeps the document title in step with the site name.
   ========================================================== */

import { watchSettings } from "./trailbound-data.js";

const TITLE_SUFFIX = document.title.includes("—")
  ? document.title.split("—").slice(1).join("—").trim()
  : "";

watchSettings((settings) => {
  document.querySelectorAll('[data-site="name"]').forEach((node) => {
    node.textContent = settings.siteName;
  });

  document.querySelectorAll('[data-site="timezone"]').forEach((node) => {
    node.textContent = settings.timezone;
  });

  document.querySelectorAll('[data-site="year"]').forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });

  if (TITLE_SUFFIX) document.title = `${settings.siteName} — ${TITLE_SUFFIX}`;

  // Let other scripts on the page react without their own listener.
  window.dispatchEvent(new CustomEvent("trailbound:settings", { detail: settings }));
});
