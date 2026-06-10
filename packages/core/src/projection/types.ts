/**
 * types.ts -- shared types for the projection module.
 */

import type { Decimal } from "../decimal/decimal.js";

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

/** A seed string used to initialise the PRNG. Branded to prevent accidental
 *  substitution of arbitrary strings. */
export type SimSeed = string & { readonly __brand: "SimSeed" };

export function asSimSeed(s: string): SimSeed {
  return s as SimSeed;
}

// ---------------------------------------------------------------------------
// PRNG state
// ---------------------------------------------------------------------------

/** Four 32-bit unsigned integers representing the sfc32 PRNG state. */
export interface Sfc32State {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

// ---------------------------------------------------------------------------
// Engine inputs
// ---------------------------------------------------------------------------

/** Per-year fan chart percentile snapshot. All values are Decimal cents. */
export interface YearBand {
  readonly p10: Decimal;
  readonly p25: Decimal;
  readonly p50: Decimal;
  readonly p75: Decimal;
  readonly p90: Decimal;
}

/** A single historical replay cohort that failed (pot depleted before horizon). */
export interface WorstCohort {
  /** The calendar year the cohort started (within the dataset range). */
  readonly startYear: number;
  /** The age at which the pot was depleted in this cohort. */
  readonly depletionAge: number;
}

// ---------------------------------------------------------------------------
// Engine outputs
// ---------------------------------------------------------------------------

/** Monte Carlo simulation results. */
export interface McResult {
  /** Fraction of paths where pot > 0 at planUntilAge. */
  readonly successRate: number;
  /** Fraction of paths that never reached the FIRE number by planUntilAge. */
  readonly neverFiFraction: number;
  /** Median FIRE age across all paths (nearest-rank). */
  readonly medianFireAge: number;
  /** Number of paths simulated. */
  readonly pathCount: number;
  /** Year-by-year pot percentiles for the fan chart (one entry per year). */
  readonly yearlyBands: readonly YearBand[];
}

/** Historical replay simulation results. */
export interface ReplayResult {
  /** Fraction of complete-window cohorts where pot > 0 at planUntilAge. */
  readonly survivalShare: number;
  /** Number of start years with insufficient data to cover the full horizon. */
  readonly excludedWindowCount: number;
  /** Number of start years with a complete window (the denominator). */
  readonly completeWindowCount: number;
  /** Up to 3 cohorts with earliest depletion (sorted by depletionAge asc). */
  readonly worstCohorts: readonly WorstCohort[];
}

/** Combined result from simulatePlan. */
export interface SimulateResult {
  /** The derived FIRE number in cents (annualSpend / SWR). */
  readonly fireNumber: Decimal;
  /** Monte Carlo results. */
  readonly mc: McResult;
  /** Historical replay results. */
  readonly replay: ReplayResult;
}
