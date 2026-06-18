import path from "node:path";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const coreRoot = path.resolve(__dirname, "../../packages/core/src");
// Aliases ordered most-specific first so Vite matches subpaths before the root.
// next/link uses process.env which is absent in the browser test environment;
// alias it to a minimal shim that renders a plain anchor.
const alias = [
  { find: "@privance/core/decimal", replacement: path.join(coreRoot, "decimal/index.ts") },
  { find: "@privance/core/projection", replacement: path.join(coreRoot, "projection/index.ts") },
  { find: "@privance/core/storage", replacement: path.join(coreRoot, "storage/index.ts") },
  { find: "@privance/core/sync", replacement: path.join(coreRoot, "sync/index.ts") },
  { find: "@privance/core", replacement: path.join(coreRoot, "index.ts") },
  { find: "@", replacement: path.resolve(__dirname, "./src") },
  { find: "next/link", replacement: path.resolve(__dirname, "./src/__mocks__/next-link.tsx") },
];

export default defineConfig({
  // Dedupe React so component deps (e.g. react-hook-form) share the single React
  // instance the test renderer uses; otherwise hooks see a null dispatcher.
  resolve: { alias, dedupe: ["react", "react-dom"] },
  // Next inlines NEXT_PUBLIC_* at build time; the browser test bundle has no
  // process, so inline a stand-in version the way Next would in production.
  define: { "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify("0.0.0-test") },
  plugins: [react()],
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
