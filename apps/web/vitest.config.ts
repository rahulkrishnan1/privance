import path from "node:path";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const alias = {
  "@privance/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
  "@": path.resolve(__dirname, "./src"),
};

export default defineConfig({
  // Dedupe React so component deps (e.g. react-hook-form) share the single React
  // instance the test renderer uses; otherwise hooks see a null dispatcher.
  resolve: { alias, dedupe: ["react", "react-dom"] },
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
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
