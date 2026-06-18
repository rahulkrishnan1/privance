/**
 * engine.ts -- simulatePlan: deterministic FIRE projection engine.
 *
 * Modes: Monte Carlo (seeded PRNG + normal sampler) and historical replay.
 * Phases: accumulation -> drawdown.
 *
 * Conventions:
 *   Success definition: pot > 0 at planUntilAge, regardless of whether FI was
 *     reached. Paths that never reach FI but finish with pot > 0 count as
 *     successes. neverFiFraction is reported separately.
 *   Percentile method: nearest-rank by sorted index (pure integer, no float).
 *     For N values and percentile fraction p, index = Math.floor(p * (N - 1)).
 *   Draw order: path-major. All years for path 0 are consumed first from the
 *     PRNG, then path 1, etc. This makes the draw sequence deterministic and
 *     reviewable year-by-year.
 *   FIRE number rounding: Decimal division with banker (half-even) rounding.
 *   Year order (matches the plan lifecycle diagram): accumulation adds the
 *     contribution then applies the return; drawdown subtracts the spend then
 *     applies the return.
 *   Money float boundary: applying a return to a balance. Balance (Decimal
 *     cents) is converted to float, multiplied by (1 + r), then banker-rounded
 *     back to integer cents. Returns themselves (the MC draw and the replay
 *     stock/bond blend) are float; money never is except at this boundary.
 *   MC returns are clamped at -100% (an unlevered portfolio cannot lose more
 *     than everything); depletion is terminal only in drawdown.
 *   Allowed float ops: +, -, *, / only. No transcendentals.
 */

import { Decimal } from "../decimal/index.js";
import { ANNUAL_RETURNS } from "./dataset.js";
import { normalSample } from "./normal.js";
import { seededRng } from "./random.js";
import type { SimSeed, SimulateResult, WorstCohort, YearBand } from "./types.js";

export interface SimulatePlanOptions {
  /** Current pot value in cents. */
  readonly startingPotCents: Decimal;
  /** Monthly contribution in cents. Annualized as x12 inside the engine. */
  readonly monthlyContributionCents: Decimal;
  /** Annual retirement spend in cents (real dollars). */
  readonly annualSpendCents: Decimal;
  /** Safe withdrawal rate in basis points (e.g. 400 = 4%). */
  readonly swrBps: number;
  /** Current age (integer). */
  readonly currentAge: number;
  /** Age to run the simulation until (integer). */
  readonly planUntilAge: number;
  /** Stock weight (0..1) applied across the whole horizon. */
  readonly stockWeight: number;
  /** Seed for the Monte Carlo PRNG. */
  readonly seed: SimSeed;
  /** MC: arithmetic mean annual real return in basis points. */
  readonly muBps: number;
  /** MC: standard deviation in basis points. */
  readonly sigmaBps: number;
  /** Number of Monte Carlo paths (default 5000). */
  readonly paths?: number;
}

export type { SimulateResult } from "./types.js";

/**
 * Apply a return to a Decimal balance via the permitted float boundary.
 * Steps:
 *   1. Convert balance to float (Number of cents).
 *   2. Multiply by (1 + r) -- pure float multiply.
 *   3. Banker-round back to integer cents.
 *   4. Return as Decimal.
 *
 * Allowed ops: +, -, *, /. No transcendentals.
 */
function applyReturn(balanceCents: Decimal, r: number): Decimal {
  // Step 1: to float
  const balFloat = Number(balanceCents.toMinorUnits());
  // Step 2: apply return
  const newFloat = balFloat * (1 + r);
  // Step 3: banker round to integer cents
  const floored = Math.floor(newFloat);
  const frac = newFloat - floored;
  let rounded: bigint;
  if (frac < 0.5) {
    rounded = BigInt(floored);
  } else if (frac > 0.5) {
    rounded = BigInt(floored + 1);
  } else {
    // Exactly halfway: round to even
    rounded = floored % 2 === 0 ? BigInt(floored) : BigInt(floored + 1);
  }
  return Decimal.fromMinorUnits(rounded);
}

/**
 * Select the value at percentile `p` (0..1) from an already-sorted array.
 * Index = floor(p * (n - 1)). Pure integer index -- no float in result.
 */
function selectPercentile(sorted: Decimal[], p: number): Decimal {
  const idx = Math.floor(p * (sorted.length - 1));
  // biome-ignore lint/style/noNonNullAssertion: idx is clamped by floor(p*(n-1)) to [0, n-1]
  return sorted[idx]!;
}

function computeFireNumber(annualSpendCents: Decimal, swrBps: number): Decimal {
  // FIRE number = annualSpend / SWR
  // SWR as Decimal: swrBps cents / 10000 cents, but we want the rate as a
  // Decimal divisor. Use: fireNumber = annualSpend * 10000 / swrBps (integer bps).
  const ten_thousand = Decimal.fromString("10000.00");
  const swr = Decimal.fromString(`${swrBps}.00`);
  return annualSpendCents.mul(ten_thousand, { round: "banker" }).div(swr, "banker");
}

interface PathResult {
  /** true if pot > 0 at planUntilAge */
  survived: boolean;
  /** true if FI was never reached */
  neverFi: boolean;
  /** age at which FI was reached; planUntilAge if never reached */
  fireAge: number;
  /** pot value at end of each simulated year (Decimal cents) */
  yearlyPots: Decimal[];
  /** if depleted before planUntilAge, the age at which it happened */
  depletionAge: number | null;
}

/**
 * Simulate one path given an array of annual returns (one per year).
 * returns[i] is the weighted annual real return for year i (decimal fraction, e.g. 0.07).
 */
function simulatePath(
  startingPot: Decimal,
  annualContrib: Decimal,
  annualSpend: Decimal,
  fireTarget: Decimal,
  currentAge: number,
  planUntilAge: number,
  returns: number[],
): PathResult {
  const horizon = planUntilAge - currentAge;
  let pot = startingPot;
  let inAccumulation = pot.cmp(fireTarget) < 0;
  let fireAge = inAccumulation ? planUntilAge : currentAge;
  let neverFi = inAccumulation;
  const yearlyPots: Decimal[] = [];
  let depletionAge: number | null = null;

  for (let y = 0; y < horizon; y++) {
    // biome-ignore lint/style/noNonNullAssertion: y < horizon = returns.length
    const r = returns[y]!;

    if (inAccumulation) {
      // Accumulation: add contribution first, then apply return (plan lifecycle).
      pot = pot.add(annualContrib);
      pot = applyReturn(pot, r);
      // A clamped -100% return zeroes the pot but the path continues:
      // contributions keep coming, so depletion is not terminal here.
      if (pot.isNegative()) pot = Decimal.zero();
      if (pot.cmp(fireTarget) >= 0) {
        fireAge = currentAge + y + 1;
        inAccumulation = false;
        neverFi = false;
      }
      yearlyPots.push(pot);
    } else {
      // Drawdown: subtract spend first, then apply return (plan lifecycle).
      pot = pot.sub(annualSpend);
      if (!pot.isNegative() && !pot.isZero()) {
        pot = applyReturn(pot, r);
      }
      if (pot.isNegative() || pot.isZero()) {
        depletionAge = currentAge + y + 1;
        for (let rest = y; rest < horizon; rest++) {
          yearlyPots.push(Decimal.zero());
        }
        return { survived: false, neverFi, fireAge, yearlyPots, depletionAge };
      }
      yearlyPots.push(pot);
    }
  }

  return {
    survived: !pot.isZero(),
    neverFi,
    fireAge,
    yearlyPots,
    depletionAge: null,
  };
}

function runMonteCarlo(
  opts: SimulatePlanOptions,
  fireTarget: Decimal,
  annualContrib: Decimal,
  pathCount: number,
): { mcResult: import("./types.js").McResult } {
  const { startingPotCents, annualSpendCents, currentAge, planUntilAge, seed, muBps, sigmaBps } =
    opts;
  const horizon = planUntilAge - currentAge;
  const mu = muBps / 10000;
  const sigma = sigmaBps / 10000;

  const rng = seededRng(seed);

  let successes = 0;
  let neverFiCount = 0;
  const fireAges: number[] = [];

  // Per-year sorted pot lists for percentile bands
  const yearPots: Decimal[][] = Array.from({ length: horizon }, () => []);

  // Draw order: path-major (all years of path 0, then path 1, ...)
  for (let p = 0; p < pathCount; p++) {
    const returns: number[] = [];
    for (let y = 0; y < horizon; y++) {
      const z = normalSample(rng);
      // mu/sigma already encode the allocation blend (presets derive them from
      // the weight-blended dataset; advanced mode overrides them). Clamp the
      // draw at -100%: an unlevered portfolio cannot lose more than everything.
      const draw = mu + sigma * z;
      returns.push(draw < -1 ? -1 : draw);
    }

    const path = simulatePath(
      startingPotCents,
      annualContrib,
      annualSpendCents,
      fireTarget,
      currentAge,
      planUntilAge,
      returns,
    );

    if (path.survived) successes++;
    if (path.neverFi) {
      neverFiCount++;
    } else {
      // Median FIRE age is taken over paths that actually reached FI; never-FI
      // paths carry planUntilAge as a sentinel and would skew it upward.
      fireAges.push(path.fireAge);
    }

    for (let y = 0; y < horizon; y++) {
      // biome-ignore lint/style/noNonNullAssertion: both arrays have length horizon
      yearPots[y]!.push(path.yearlyPots[y]!);
    }
  }

  // Sort each year's pot list for percentile selection
  const yearlyBands: YearBand[] = yearPots.map((pots) => {
    pots.sort((a, b) => {
      const am = a.toMinorUnits();
      const bm = b.toMinorUnits();
      if (am < bm) return -1;
      if (am > bm) return 1;
      return 0;
    });
    return {
      p10: selectPercentile(pots, 0.1),
      p25: selectPercentile(pots, 0.25),
      p50: selectPercentile(pots, 0.5),
      p75: selectPercentile(pots, 0.75),
      p90: selectPercentile(pots, 0.9),
    };
  });

  // Median FIRE age: nearest-rank on sorted fireAges (FI-reaching paths only).
  // When no path reaches FI, fall back to planUntilAge (callers gate on neverFi).
  fireAges.sort((a, b) => a - b);
  const medianFireAge =
    fireAges.length > 0
      ? // biome-ignore lint/style/noNonNullAssertion: guarded by length > 0; index floor(0.5*(n-1)) is in [0, n-1]
        fireAges[Math.floor(0.5 * (fireAges.length - 1))]!
      : planUntilAge;

  return {
    mcResult: {
      successRate: successes / pathCount,
      neverFiFraction: neverFiCount / pathCount,
      medianFireAge,
      pathCount,
      yearlyBands,
    },
  };
}

function runReplay(
  opts: SimulatePlanOptions,
  fireTarget: Decimal,
  annualContrib: Decimal,
): { replayResult: import("./types.js").ReplayResult } {
  const { startingPotCents, annualSpendCents, currentAge, planUntilAge, stockWeight } = opts;
  const horizon = planUntilAge - currentAge;
  const bondWeight = 1 - stockWeight;
  const total = ANNUAL_RETURNS.length; // 152
  // biome-ignore lint/style/noNonNullAssertion: ANNUAL_RETURNS is a non-empty compile-time constant
  const firstYear = ANNUAL_RETURNS[0]!.year; // 1871
  // biome-ignore lint/style/noNonNullAssertion: ANNUAL_RETURNS is a non-empty compile-time constant
  const lastYear = ANNUAL_RETURNS[total - 1]!.year; // 2022

  // Complete windows: start years where startYear + horizon - 1 <= lastYear
  // i.e. startYear <= lastYear - horizon + 1
  const lastCompleteStart = lastYear - horizon + 1;
  const completeWindowCount =
    lastCompleteStart >= firstYear ? lastCompleteStart - firstYear + 1 : 0;
  const excludedWindowCount = total - completeWindowCount;

  let survivors = 0;
  const failedCohorts: WorstCohort[] = [];

  for (let i = 0; i < completeWindowCount; i++) {
    // Build returns array for this cohort
    const returns: number[] = [];
    for (let y = 0; y < horizon; y++) {
      // biome-ignore lint/style/noNonNullAssertion: i + y < completeWindowCount + horizon - 1 <= total
      const row = ANNUAL_RETURNS[i + y]!;
      const r = (stockWeight * row.stocksBps + bondWeight * row.bondsBps) / 10000;
      returns.push(r);
    }

    const path = simulatePath(
      startingPotCents,
      annualContrib,
      annualSpendCents,
      fireTarget,
      currentAge,
      planUntilAge,
      returns,
    );

    if (path.survived) {
      survivors++;
    } else {
      const startYear = firstYear + i;
      const depAge = path.depletionAge ?? planUntilAge;
      failedCohorts.push({ startYear, depletionAge: depAge });
    }
  }

  failedCohorts.sort((a, b) => a.depletionAge - b.depletionAge);
  const worstCohorts = failedCohorts.slice(0, 3);

  const survivalShare = completeWindowCount > 0 ? survivors / completeWindowCount : 1;

  return {
    replayResult: {
      survivalShare,
      excludedWindowCount,
      completeWindowCount,
      worstCohorts,
    },
  };
}

/**
 * Run a complete FIRE simulation: Monte Carlo and historical replay.
 *
 * Both phases (accumulation and drawdown) are run for every path/cohort.
 * Results are deterministic: identical inputs and seed produce identical output.
 */
export function simulatePlan(opts: SimulatePlanOptions): SimulateResult {
  const pathCount = opts.paths ?? 5000;
  const annualContrib = opts.monthlyContributionCents.mul(Decimal.fromString("12.00"), {
    round: "banker",
  });
  const fireTarget = computeFireNumber(opts.annualSpendCents, opts.swrBps);

  const { mcResult } = runMonteCarlo(opts, fireTarget, annualContrib, pathCount);
  const { replayResult } = runReplay(opts, fireTarget, annualContrib);

  return {
    fireNumber: fireTarget,
    mc: mcResult,
    replay: replayResult,
  };
}
