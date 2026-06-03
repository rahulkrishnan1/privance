import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

// The KDF worker loads argon2 from a copy vendored under public/. If hash-wasm
// is bumped without re-vendoring, the worker would run a different build than
// the pinned dependency. Fail loudly so the copy can never silently drift.
describe("vendored argon2 worker asset", () => {
  it("is byte-identical to the pinned hash-wasm build", () => {
    const pinnedPkg = require.resolve("hash-wasm/package.json");
    const pinned = readFileSync(join(dirname(pinnedPkg), "dist/argon2.umd.min.js"));
    // Vitest runs with cwd at the apps/web workspace root.
    const vendored = readFileSync(join(process.cwd(), "public/kdf/argon2.umd.min.js"));
    expect(vendored.equals(pinned)).toBe(true);
  });
});
