import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
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
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Which files get cached for offline use.
        // Firestore data itself won't work offline (it needs internet),
        // but your pages, styles, and scripts will still load instantly.
        globPatterns: ["**/*.{js,css,html,png,svg,jpg,jpeg}"],
      },
    }),
  ],
});