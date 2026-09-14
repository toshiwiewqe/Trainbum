import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "path";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        trail: resolve(import.meta.dirname, "trail.html"),
        products: resolve(import.meta.dirname, "products.html"),
        booking: resolve(import.meta.dirname, "booking.html"),
        contact: resolve(import.meta.dirname, "contact.html"),
        login: resolve(import.meta.dirname, "login.html"),
        account: resolve(import.meta.dirname, "account.html"),
        cart: resolve(import.meta.dirname, "cart.html"),
        checkout: resolve(import.meta.dirname, "checkout.html"),
      },
    },
  },
  plugins: [
    basicSsl(),
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
      },
    }),
  ],
});