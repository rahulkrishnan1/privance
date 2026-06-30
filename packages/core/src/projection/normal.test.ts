import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalSample } from "./normal.js";
import { seededRng } from "./random.js";
import { asSimSeed } from "./types.js";

const SEED = asSimSeed("privance-fire-v1");

// These exact values are also asserted in browser mode to verify
// cross-engine determinism (bit-identical across V8/JSC).
describe("normal sampler golden vectors", () => {
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

describe("normal sampler statistical properties", () => {
  it("mean is within 0.05 of 0 and variance is within 0.05 of 1 over many draws", () => {
    // Use a fixed seed for reproducibility; large enough sample for tight tolerance.
    const rng = seededRng(asSimSeed("stat-test-seed"));
    const n = 50000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const z = normalSample(rng);
      sum += z;
      sumSq += z * z;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });

  it("mean, variance, and the median quantile hold over many different seeds (fast-check)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 32 }), (s) => {
        const rng = seededRng(asSimSeed(s));
        const n = 20_000;
        const samples: number[] = [];
        let sum = 0;
        let sumSq = 0;
        for (let i = 0; i < n; i++) {
          const z = normalSample(rng);
          samples.push(z);
          sum += z;
          sumSq += z * z;
        }
        const mean = sum / n;
        const variance = sumSq / n - mean * mean;
        samples.sort((a, b) => a - b);
        const median = samples[Math.floor(n / 2)] ?? 0;
        const q975 = samples[Math.floor(n * 0.975)] ?? 0;
        // The median must sit near 0 and the 97.5th quantile near +1.96, which a
        // shifted or clipped sampler cannot satisfy.
        return (
          Math.abs(mean) < 0.05 &&
          Math.abs(variance - 1) < 0.05 &&
          Math.abs(median) < 0.06 &&
          Math.abs(q975 - 1.96) < 0.12
        );
      }),
      { numRuns: 30 },
    );
  });
});

describe("normal sampler tail coverage (no-clipping regression)", () => {
  it("draws beyond 2 sigma occur at approximately 4.55% frequency", () => {
    // Expected ~4.55% for |z| > 2. With N=200000 and seed, tolerance is tight.
    const rng = seededRng(asSimSeed("tail-test-2sigma"));
    const n = 200000;
    let beyond2 = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(normalSample(rng)) > 2) beyond2++;
    }
    const freq = beyond2 / n;
    // Expected 4.55%, allow +/- 0.5% due to finite sample and tail approximation.
    expect(freq).toBeGreaterThan(0.04);
    expect(freq).toBeLessThan(0.06);
  });

  it("draws beyond 3 sigma occur at plausible frequency (~0.27%)", () => {
    const rng = seededRng(asSimSeed("tail-test-3sigma"));
    const n = 200000;
    let beyond3 = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(normalSample(rng)) > 3) beyond3++;
    }
    const freq = beyond3 / n;
    // Expected ~0.27%. Must be positive (not zero = not clipped).
    // With N=200000, expected ~540 samples, std ~23, so 3-sigma range is [471, 609].
    // Allow generous bounds: 0.10% to 0.80%.
    expect(freq).toBeGreaterThan(0.001);
    expect(freq).toBeLessThan(0.008);
  });

  it("draws beyond 4 sigma are possible (not clipped)", () => {
    const rng = seededRng(asSimSeed("tail-test-4sigma"));
    const n = 500000;
    let beyond4 = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(normalSample(rng)) > 4) beyond4++;
    }
    // Expected ~32 samples in 500k. Must be at least 1.
    expect(beyond4).toBeGreaterThan(0);
  });
});

describe("normal sampler clamping", () => {
  it("u = 0 clamps to U_MIN, returns finite value (exercises u < U_MIN branch)", () => {
    const fakeRng: import("./random.js").Sfc32 = { next: () => 0 };
    const z = normalSample(fakeRng);
    expect(Number.isFinite(z)).toBe(true);
    // Clamped to U_MIN (~2.3e-10) which maps to z ~ -6.2
    expect(z).toBeLessThan(-6);
  });

  it("u = 1 - epsilon clamps to U_MAX, returns finite value (exercises u > U_MAX branch)", () => {
    const fakeRng: import("./random.js").Sfc32 = { next: () => 1 - 1e-15 };
    const z = normalSample(fakeRng);
    expect(Number.isFinite(z)).toBe(true);
    expect(z).toBeGreaterThan(6);
  });

  it("tail table lower-boundary clamp: p below first table entry returns finite z", () => {
    // p < TAIL_V_MIN^4 exercises the i < 0 clamp in tailProbit.
    // TAIL_V_MIN = 3.89e-3, so TAIL_V_MIN^4 ~ 2.3e-10 (approximately U_MIN).
    // Feed a value slightly below U_MIN to trigger both the u < U_MIN clamp
    // and thus the table's i < 0 defensive clamp.
    const fakeRng: import("./random.js").Sfc32 = { next: () => 1e-12 };
    const z = normalSample(fakeRng);
    expect(Number.isFinite(z)).toBe(true);
  });

  it("tail table upper-boundary clamp: p at P_TAIL boundary returns finite z", () => {
    // p just below 0.02275 (P_TAIL) exercises the i >= TAIL_N - 1 clamp.
    const fakeRng: import("./random.js").Sfc32 = { next: () => 0.022749 };
    const z = normalSample(fakeRng);
    expect(Number.isFinite(z)).toBe(true);
    expect(z).toBeCloseTo(-2, 0);
  });
});

// Reference [p, z] pairs computed offline with Python's stdlib
// NormalDist().inv_cdf (Wichura AS 241, accurate to ~1e-16). Points sit at
// region interiors, the central/tail split (p = 0.02275), and the empirically
// measured worst-case points in each region. Driving normalSample with a fake
// RNG returning p evaluates probit(p) directly (p is inside [U_MIN, U_MAX], so
// the clamp is a no-op). Measured peak error: 3.19e-8 central, 0.0641 tail; the
// thresholds below leave headroom and fail if the approximation regresses.
const CENTRAL_REFERENCE: readonly [number, number][] = [
  [0.022797725, -1.9991192757419964],
  [0.0228, -1.9990772149717697],
  [0.02425, -1.9729610513118845],
  [0.03, -1.8807936081512509],
  [0.05, -1.6448536269514722],
  [0.1, -1.2815515655446006],
  [0.25, -0.6744897501960817],
  [0.5, 0.0],
  [0.75, 0.6744897501960817],
  [0.9, 1.2815515655446006],
  [0.95, 1.6448536269514715],
  [0.97, 1.8807936081512504],
  [0.97575, 1.972961051311885],
  [0.9772, 1.9990772149717688],
  [0.977202275, 1.9991192757419967],
];
const TAIL_REFERENCE: readonly [number, number][] = [
  [2.3e-10, -6.232176082280632],
  [1e-9, -5.997807015007685],
  [1.7782814863761166e-9, -5.9035988780503414],
  [1e-8, -5.612001244174788],
  [1e-7, -5.199337582192818],
  [1e-6, -4.753424308822899],
  [1e-5, -4.264890793922825],
  [1e-4, -3.71901648545568],
  [0.001, -3.090232306167813],
  [0.005, -2.5758293035489],
  [0.01, -2.3263478740408408],
  [0.02274, -2.000187695289251],
  [0.97726, 2.000187695289251],
  [0.99, 2.3263478740408408],
  [0.999, 3.090232306167813],
];
const MAX_ABS_ERROR_CENTRAL = 4e-8;
const MAX_ABS_ERROR_TAIL = 0.065;

describe("normal sampler approximation accuracy", () => {
  it("central region |z| <= 2 stays within the documented error bound", () => {
    for (const [p, z] of CENTRAL_REFERENCE) {
      const err = Math.abs(normalSample({ next: () => p }) - z);
      expect(err).toBeLessThanOrEqual(MAX_ABS_ERROR_CENTRAL);
    }
  });

  it("tail region |z| > 2 stays within the documented error bound", () => {
    for (const [p, z] of TAIL_REFERENCE) {
      const err = Math.abs(normalSample({ next: () => p }) - z);
      expect(err).toBeLessThanOrEqual(MAX_ABS_ERROR_TAIL);
    }
  });
});
