import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "path";

// ==========================================================
// CHANGED: the ten admin pages were missing from `input`.
//
// Vite only builds the HTML entry points listed here. Everything
// else in the project root is simply not copied into dist/ — and
// dist/ is what firebase.json serves. So the admin panel built
// fine locally with `npm run dev` (which serves any file on
// request) and then silently never existed in production:
// trailbound-app.web.app/admin-login.html would 404.
//
// Nothing else in this file changed.
// ==========================================================

const page = (name) => resolve(import.meta.dirname, `${name}.html`);

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        // ---- customer-facing ----
        main: page("index"),
        trail: page("trail"),
        products: page("products"),
        booking: page("booking"),
        contact: page("contact"),
        login: page("login"),
        account: page("account"),
        cart: page("cart"),
        checkout: page("checkout"),
        paymentResult: page("payment-result"),

        // ---- admin panel ----
        adminLogin: page("admin-login"),
        adminDashboard: page("admin-dashboard"),
        adminCatalog: page("admin-catalog"),
        adminProducts: page("admin-products"),
        adminBookings: page("admin-bookings"),
        adminBookingDetails: page("admin-booking-details"),
        adminOrders: page("admin-orders"),
        adminUsers: page("admin-users"),
        adminActivity: page("admin-activity"),
        adminSupport: page("admin-support"),
        adminSettings: page("admin-settings"),
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/favicon.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Trailbound — Hiking Trips & Guides",
        short_name: "Trailbound",
        description: "Book hiking trails, certified guides, and gear in one place.",
        theme_color: "#1a0401",
        background_color: "#1a0401",
        display: "standalone",
        start_url: "/index.html",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,jpg,jpeg}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: null,
        // ADDED: keep the admin panel out of the service worker's
        // precache. Admin pages are behind a login and change often;
        // precaching them ships the whole panel to every visitor's
        // device and can serve a stale build to you after a deploy.
        globIgnores: ["**/admin-*"],
      },
    }),
  ],
});