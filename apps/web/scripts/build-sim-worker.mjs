#!/usr/bin/env node

/**
 * Bundles the simulation worker entry into apps/web/public/sim/sim-worker.mjs.
 *
 * Constraints:
 *   - Single ESM module output (no eval, no dynamic import at runtime).
 *   - es2022 target covers BigInt natively; WKWebView CSP satisfied.
 *   - Runs before `next build`, `next dev`, and `vitest run` (prebuild,
 *     dev, and pretest wiring in package.json). Re-run `build:sim-worker`
 *     manually to refresh a long-lived dev server after engine changes.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Verify dataset.ts integrity before bundling, so a tampered or regenerated
// dataset cannot silently ship in the worker without an explicit hash update.
const datasetPath = join(__dirname, "../../../packages/core/src/projection/dataset.ts");
const hashPath = join(__dirname, "../../../packages/core/src/projection/dataset-hash.txt");
const datasetContent = readFileSync(datasetPath, "utf8");
const recordedHash = readFileSync(hashPath, "utf8").trim();
const computedHash = createHash("sha256").update(datasetContent).digest("hex");
if (computedHash !== recordedHash) {
  console.error("dataset.ts integrity check FAILED -- aborting worker build.");
  console.error(`  Recorded : ${recordedHash}`);
  console.error(`  Computed : ${computedHash}`);
  process.exit(1);
}

const entry = join(__dirname, "../src/lib/sim/sim-worker-entry.ts");
const outfile = join(__dirname, "../public/sim/sim-worker.mjs");

mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  // No dynamic import at runtime: inline everything.
  splitting: false,
  // No eval: esbuild default for non-minified builds is safe; assert explicitly.
  inject: [],
  define: {},
  minify: false,
  sourcemap: false,
  // Resolve @privance/core through the monorepo source (same as vitest alias).
  alias: {
    "@privance/core": join(__dirname, "../../../packages/core/src/index.ts"),
    "@privance/core/projection": join(__dirname, "../../../packages/core/src/projection/index.ts"),
    "@privance/core/decimal": join(__dirname, "../../../packages/core/src/decimal/index.ts"),
  },
  // TypeScript via esbuild's built-in TS transform (types stripped, not checked).
  loader: { ".ts": "ts" },
  // Treat .js extensions in imports as .ts when no .js file exists (monorepo src).
  resolveExtensions: [".ts", ".js"],
  logLevel: "info",
});
