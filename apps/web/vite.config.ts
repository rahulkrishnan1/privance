import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };
import { alias } from "./vite.alias";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The app never auto-swaps the service worker mid-session: in a
      // zero-knowledge app an asset/version skew landing during a crypto flow
      // is worse than a stale shell. skipWaiting: false + the update banner
      // (SwUpdateBanner) drive updates on the next fresh navigation.
      registerType: "prompt",
      injectRegister: false, // registration stays in ServiceWorkerRegistration
      manifest: false, // keep the hand-maintained public/manifest.json
      // Public assets the offline shell needs beyond the build output
      // (SQLite WASM, KDF + sim workers, icons). Build output (js/css/html)
      // is precached automatically via the default globPatterns.
      includeAssets: [
        "icon.svg",
        "icon-192.png",
        "icon-512.png",
        "icon-maskable-512.png",
        "manifest.json",
        "sqlite/**",
        "kdf/**",
        "sim/**",
      ],
      workbox: {
        skipWaiting: false,
        clientsClaim: false,
        // Vite builds a single shell; every route serves index.html.
        navigateFallback: "/",
        // Encrypted API responses are never cached (no per-user scoping in
        // the cache; a session change must not leak the previous user's data).
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  resolve: { alias },
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(process.env.VITE_APP_VERSION || pkg.version),
  },
  server: {
    port: 8081,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "out",
    // Vendor split so the SW can cache the big, rarely-changing chunks
    // independently of app code (faster installs + updates). Vite 8/Rolldown
    // requires manualChunks as a function.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-router")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) {
            return "vendor-charts";
          }
          if (id.includes("/packages/core/")) {
            return "vendor-core";
          }
        },
      },
    },
  },
});
