import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeSfc32, seededRng, xmur3Seed } from "./random.js";
import { asSimSeed } from "./types.js";

const SEED = asSimSeed("privance-fire-v1");

// ---------------------------------------------------------------------------
// Golden vectors (bit-identical assertions)
// These exact values are also asserted in browser mode in U4 to verify
// cross-engine determinism.
// ---------------------------------------------------------------------------

describe("sfc32 golden vectors", () => {
  it("produces the expected sequence for seed 'privance-fire-v1'", () => {
    const rng = seededRng(SEED);
    expect(rng.next()).toBe(0.9154752213507891);
    expect(rng.next()).toBe(0.5306918653659523);
    expect(rng.next()).toBe(0.7850034004077315);
    expect(rng.next()).toBe(0.3730084376875311);
    expect(rng.next()).toBe(0.39964181440882385);
    expect(rng.next()).toBe(0.035826116567477584);
    expect(rng.next()).toBe(0.38929846487008035);
    expect(rng.next()).toBe(0.7729917208198458);
  });

  it("xmur3 produces the expected state for seed 'privance-fire-v1'", () => {
    const state = xmur3Seed(SEED);
    expect(state.a).toBe(3720938456);
    expect(state.b).toBe(2611431205);
    expect(state.c).toBe(229321756);
    expect(state.d).toBe(1894533770);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("sfc32 determinism", () => {
  it("produces identical output for identical seeds (two independent instances)", () => {
    const rng1 = seededRng(SEED);
    const rng2 = seededRng(SEED);
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it("produces different output for different seeds", () => {
    const rng1 = seededRng(SEED);
    const rng2 = seededRng(asSimSeed("different-seed"));
    const v1 = rng1.next();
    const v2 = rng2.next();
    // Different seeds should produce different first values.
    expect(v1).not.toBe(v2);
  });

  it("makeSfc32 from xmur3Seed matches seededRng shortcut", () => {
    const state = xmur3Seed(SEED);
    const rng1 = makeSfc32(state);
    const rng2 = seededRng(SEED);
    for (let i = 0; i < 20; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });
});

// ---------------------------------------------------------------------------
// Output range
// ---------------------------------------------------------------------------

describe("sfc32 output range", () => {
  it("all outputs are in [0, 1)", () => {
    const rng = seededRng(SEED);
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Property tests (fast-check)
// ---------------------------------------------------------------------------

describe("sfc32 properties", () => {
  it("output is in [0, 1) for any seed string (fast-check)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 64 }), (s) => {
        const rng = seededRng(asSimSeed(s));
        for (let i = 0; i < 20; i++) {
          const v = rng.next();
          if (v < 0 || v >= 1) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("identical seeds produce identical sequences (fast-check)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 64 }), (s) => {
        const seed = asSimSeed(s);
        const rng1 = seededRng(seed);
        const rng2 = seededRng(seed);
        for (let i = 0; i < 10; i++) {
          if (rng1.next() !== rng2.next()) return false;
        }
        return true;
      }),
      { numRuns: 500 },
    );
  });
});
