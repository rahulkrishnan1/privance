// Service worker build script using Workbox injectManifest.
// Runs post-Vite-build: scans out/ for hashed assets, generates a revisioned
// precache manifest, and compiles sw-src.ts into out/sw.js with Workbox runtime.
//
// Usage: node scripts/build-sw.mjs
// Prerequisites: vite build must have completed (out/ directory must exist)

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { injectManifest } from "workbox-build";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const swSrc = resolve(projectRoot, "src", "sw-src.ts");
const swDest = resolve(projectRoot, "out", "sw.js");
const globDirectory = resolve(projectRoot, "out");

const { count, size } = await injectManifest({
  swSrc,
  swDest,
  globDirectory,
  globPatterns: ["**/*.{js,css,html,wasm,png,svg,woff2,json,mjs}"],
  globIgnores: ["sw.js", "workbox-*.js"],
  maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, // 8MB for WASM files
});

console.log(`SW built: ${count} files precached (${(size / 1024).toFixed(1)} KB)`);
