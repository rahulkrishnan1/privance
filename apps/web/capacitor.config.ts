import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.privance",
  appName: "Privance",

  // The Next.js static export directory.
  webDir: "out",

  server: {
    // Android WebView requires HTTPS scheme for modern web APIs
    // (OPFS, WASM shared memory, etc.).
    androidScheme: "https",
  },

  ios: {
    // Disable the automatic safe-area inset so the app can manage its own
    // layout; prevents a double-padding at the top on notched devices.
    contentInset: "never",
  },

  // Suppress verbose Capacitor debug logs in production builds.
  // Set to "debug" locally by exporting CAPACITOR_LOG_LEVEL=debug.
  loggingBehavior: "production",
  plugins: {},
};

export default config;
