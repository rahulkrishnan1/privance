/**
 * presets.ts -- Allocation presets with dataset-derived return parameters.
 *
 * Three stock/bond allocations: conservative 30/70, balanced 60/40, aggressive
 * 90/10.
 *
 * Parameters derived from ANNUAL_RETURNS in dataset.ts:
 *   mu (muBps)    = arithmetic mean of the weighted annual real returns.
 *                   The arithmetic mean is the correct expectation input for
 *                   per-period multiplicative sampling (Jensen's inequality:
 *                   E[1+r] = 1 + arithmeticMean, not 1 + geometricMean).
 *   sigma (sigmaBps) = sample standard deviation (denominator n-1).
 *   geoMeanBps    = geometric mean, derived for display only; not used in
 *                   Monte Carlo sampling.
 *
 * Constants are precomputed and committed; a test in presets.test.ts recomputes
 * them from dataset.ts and asserts exact integer equality (consistency gate).
 *
 * The arithmetic-geometric gap satisfies mu - geo ~ sigma^2 / 2 (within ~4%
 * relative error), verified by the same test.
 */

import { ANNUAL_RETURNS } from "./dataset.js";

export type PresetId = "conservative" | "balanced" | "aggressive";

export interface Preset {
  readonly id: PresetId;
  /** Fraction of portfolio in stocks: 0.0 to 1.0. */
  readonly stockWeight: number;
  /** Arithmetic mean annual real return in integer basis points. */
  readonly muBps: number;
  /** Sample standard deviation in integer basis points. */
  readonly sigmaBps: number;
  /** Geometric mean annual real return in integer basis points (display only). */
  readonly geoMeanBps: number;
}

/**
 * Conservative: 30% stocks / 70% bonds.
 * Derived from 152-year weighted annual real returns (1871-2022).
 */
export const PRESET_CONSERVATIVE: Preset = {
  id: "conservative",
  stockWeight: 0.3,
  muBps: 421,
  sigmaBps: 882,
  geoMeanBps: 384,
};

/**
 * Balanced: 60% stocks / 40% bonds.
 * Derived from 152-year weighted annual real returns (1871-2022).
 */
export const PRESET_BALANCED: Preset = {
  id: "balanced",
  stockWeight: 0.6,
  muBps: 591,
  sigmaBps: 1167,
  geoMeanBps: 526,
};

/**
 * Aggressive: 90% stocks / 10% bonds.
 * Derived from 152-year weighted annual real returns (1871-2022).
 */
export const PRESET_AGGRESSIVE: Preset = {
  id: "aggressive",
  stockWeight: 0.9,
  muBps: 761,
  sigmaBps: 1591,
  geoMeanBps: 640,
};

/** All presets, ordered conservative -> balanced -> aggressive. */
export const PRESETS: readonly Preset[] = [PRESET_CONSERVATIVE, PRESET_BALANCED, PRESET_AGGRESSIVE];

/** Look up a preset by id. */
export function getPreset(id: PresetId): Preset {
  switch (id) {
    case "conservative":
      return PRESET_CONSERVATIVE;
    case "balanced":
      return PRESET_BALANCED;
    case "aggressive":
      return PRESET_AGGRESSIVE;
  }
}

/** Return parameters for an arbitrary stock/bond allocation. */
interface AllocationParams {
  /** Arithmetic mean annual real return in integer basis points. */
  readonly muBps: number;
  /** Sample standard deviation in integer basis points. */
  readonly sigmaBps: number;
  /** Geometric mean annual real return in integer basis points (display only). */
  readonly geoMeanBps: number;
}

/**
 * Derive return parameters for any stock weight in [0, 1] by blending the
 * dataset's stock and bond series, identical to how the fixed presets are
 * computed. This is the single source of truth for the Custom allocation
 * slider; presets.test.ts asserts the committed preset constants equal this
 * function at 0.30 / 0.60 / 0.90, so the slider and the cards stay coherent.
 *
 * mu is the arithmetic mean (the correct expectation for per-period
 * multiplicative sampling), sigma the sample standard deviation (n-1), and
 * geoMean is for display only. Out-of-range weights are clamped to [0, 1].
 */
export function deriveAllocationParams(stockWeight: number): AllocationParams {
  const w = Math.min(1, Math.max(0, stockWeight));
  const bondWeight = 1 - w;
  const returns = ANNUAL_RETURNS.map(
    (r) => (w * r.stocksBps) / 10000 + (bondWeight * r.bondsBps) / 10000,
  );
  const n = returns.length;
  const arithmeticMean = returns.reduce((s, r) => s + r, 0) / n;
  const variance = returns.reduce((s, r) => s + (r - arithmeticMean) ** 2, 0) / (n - 1);
  const sigma = Math.sqrt(variance);
  const geoMean = Math.exp(returns.reduce((s, r) => s + Math.log(1 + r), 0) / n) - 1;
  return {
    muBps: Math.round(arithmeticMean * 10000),
    sigmaBps: Math.round(sigma * 10000),
    geoMeanBps: Math.round(geoMean * 10000),
  };
}
