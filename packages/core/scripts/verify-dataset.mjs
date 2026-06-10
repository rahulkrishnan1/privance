/**
 * verify-dataset.mjs
 *
 * Build-time verification: recomputes the sha-256 hash of dataset.ts and
 * fails if it does not match the recorded hash in dataset-hash.txt.
 *
 * Run: node packages/core/scripts/verify-dataset.mjs
 * Exits 1 on mismatch (breaks the build), 0 on success.
 *
 * If dataset.ts was regenerated, run generate-dataset.ts first to update
 * dataset-hash.txt, then re-run this script to confirm.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "../src/projection");
const datasetPath = join(dir, "dataset.ts");
const hashPath = join(dir, "dataset-hash.txt");

const content = readFileSync(datasetPath, "utf8");
const recorded = readFileSync(hashPath, "utf8").trim();
const computed = createHash("sha256").update(content).digest("hex");

if (computed !== recorded) {
  console.error("dataset.ts integrity check FAILED.");
  console.error(`  Recorded : ${recorded}`);
  console.error(`  Computed : ${computed}`);
  console.error(
    "  If the dataset was intentionally regenerated, run generate-dataset.ts to update the hash.",
  );
  process.exit(1);
}

console.log(`dataset.ts integrity OK (sha-256: ${computed})`);
