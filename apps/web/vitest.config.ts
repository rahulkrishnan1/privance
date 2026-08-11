import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { alias } from "./vite.alias";

export default defineConfig({
  // Dedupe React so component deps (e.g. react-hook-form) share the single React
  // instance the test renderer uses; otherwise hooks see a null dispatcher.
  resolve: { alias, dedupe: ["react", "react-dom"] },
  // Vite inlines VITE_* at build time; the browser test bundle has no
  // process, so inline a stand-in version the way the build would.
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify("0.0.0-test") },
  plugins: [react(), tailwindcss()],
  test: {
    projects: [
      {
        // Pure logic + non-rendering assertions run in happy-dom (fast).
        extends: true,
        test: {
          name: "unit",
          environment: "happy-dom",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: ["src/**/*.browser.test.ts", "src/**/*.browser.test.tsx"],
        },
      },
      {
        // Component rendering + interaction run in a real Chromium so layout,
        // CSS, and SVG (Recharts) actually render. happy-dom/jsdom measure 0x0
        // and never draw a chart, which is why rendered bugs slipped past us.
        extends: true,
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.ts", "src/**/*.browser.test.tsx"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            // Desktop viewport: these component tests assert the wide-screen
            // layout (e.g. the inline assumptions editor). The mobile sheet flow
            // is covered by the Playwright *.mobile specs.
            viewport: { width: 1280, height: 800 },
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
