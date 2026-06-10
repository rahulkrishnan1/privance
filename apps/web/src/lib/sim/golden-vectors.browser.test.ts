/**
 * Browser-mode golden vector tests (real Chromium via Vitest browser project).
 *
 * Covers acceptance example AE3 (cross-engine determinism). The exact values
 * below are also asserted in Node (packages/core random.test.ts and normal.test.ts).
 * Bit-identical results in Chromium V8 confirm the PRNG and sampler are
 * implementation-independent.
 */

import { asSimSeed, normalSample, seededRng } from "@privance/core/projection";
import { describe, expect, it } from "vitest";

const SEED = asSimSeed("privance-fire-v1");

describe("sfc32 golden vectors in Chromium (AE3)", () => {
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
});

describe("normal sampler golden vectors in Chromium (AE3)", () => {
  it("produces the expected sequence for seed 'privance-fire-v1'", () => {
    const rng = seededRng(SEED);
    expect(normalSample(rng)).toBe(1.3752641801899903);
    expect(normalSample(rng)).toBe(0.07700914587072744);
    expect(normalSample(rng)).toBe(0.7892032894878108);
    expect(normalSample(rng)).toBe(-0.3238958637134467);
    expect(normalSample(rng)).toBe(-0.25427433111780773);
    expect(normalSample(rng)).toBe(-1.8013214245718419);
    expect(normalSample(rng)).toBe(-0.28114794340340776);
    expect(normalSample(rng)).toBe(0.7487356386905338);
  });
});
