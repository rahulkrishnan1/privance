/**
 * milestones.ts -- FIRE milestone derivation (Coast / Lean / FIRE / Fat).
 *
 * Pure functions over an already-computed simulation result. The four
 * milestones are the standard FIRE ladder:
 *
 *   Coast FIRE -- the portfolio at which you could stop saving entirely and
 *                 still reach your full number by `coastTargetAge` on growth
 *                 alone. Reported as the earliest age you reach that point.
 *   Lean FIRE  -- a bare-bones independence covering ~70% of planned spend.
 *   FIRE       -- the full number (annualSpend / SWR).
 *   Fat FIRE   -- a comfortable cushion, ~150% of planned spend.
 *
 * Amounts stay Decimal end to end. The single float boundary is the coast
 * growth projection (compounding a lump sum over many years), mirrored back to
 * Decimal cents for display -- the same format-for-display boundary the chart
 * uses for `valueDisplay`. These figures are presentational projections; they
 * are never persisted nor fed back into money math.
 */

import { Decimal } from "../decimal/decimal.js";
import type { YearBand } from "./types.js";

export type MilestoneKey = "coast" | "lean" | "fire" | "fat";

export interface Milestone {
  readonly key: MilestoneKey;
  /** Target portfolio in cents; null only when Coast is unreachable within the plan. */
  readonly amountCents: Decimal | null;
  /** Median age the portfolio reaches this milestone; null if not within the horizon. */
  readonly age: number | null;
  /** Coast reads "from age N" (you may stop saving then); the rest read "at age N". */
  readonly fromAge: boolean;
}

export interface MilestonesInput {
  readonly fireNumberCents: Decimal;
  readonly startingPotCents: Decimal;
  readonly currentAge: number;
  readonly planUntilAge: number;
  /** Median FIRE age from the MC run (== planUntilAge when never reached). */
  readonly medianFireAge: number;
  readonly neverFi: boolean;
  /** Median (p50) pot per year; band i is the pot at age currentAge + i + 1 (end of year i), matching the engine and chart. Used for Lean/Fat crossings. */
  readonly yearlyBands: readonly YearBand[];
  /** Geometric mean real return in basis points; the right rate to compound a lump sum. */
  readonly geoMeanBps: number;
  /** Annual contribution in cents, for the coast accumulation path. */
  readonly annualContributionCents: Decimal;
  /** Age a coaster wants to be fully independent on growth alone. */
  readonly coastTargetAge?: number;
}

const LEAN_FRACTION = Decimal.fromString("0.7");
const FAT_FRACTION = Decimal.fromString("1.5");
const DEFAULT_COAST_TARGET_AGE = 65;

/** First age at which the median pot reaches `threshold`, or null if never within the horizon. */
function medianCrossingAge(
  bands: readonly YearBand[],
  currentAge: number,
  threshold: Decimal,
): number | null {
  for (let i = 0; i < bands.length; i++) {
    // band i holds the pot at the end of simulated year i, i.e. age currentAge + i + 1
    // (the same mapping the engine uses for fireAge and the fan chart for its x-axis).
    if (bands[i]!.p50.cmp(threshold) >= 0) return currentAge + i + 1;
  }
  return null;
}

/**
 * Coast accumulation: the earliest age whose pot, growing at the expected real
 * return with no further contributions, would still reach the FIRE number by
 * `coastTargetAge`, plus the pot threshold at that age. Both null when the
 * coast point is never reached before the target age.
 */
function deriveCoast(input: MilestonesInput): { age: number | null; amountCents: Decimal | null } {
  const coastTargetAge = input.coastTargetAge ?? DEFAULT_COAST_TARGET_AGE;
  const r = input.geoMeanBps / 10000;
  const targetCents = Number(input.fireNumberCents.toMinorUnits());
  const annualContribCents = Number(input.annualContributionCents.toMinorUnits());

  let potCents = Number(input.startingPotCents.toMinorUnits());
  const lastAge = Math.min(coastTargetAge, input.planUntilAge);
  for (let age = input.currentAge; age <= lastAge; age++) {
    const yearsToTarget = Math.max(0, coastTargetAge - age);
    if (potCents * (1 + r) ** yearsToTarget >= targetCents) {
      // Threshold pot needed at this age = target discounted by growth to target age.
      const thresholdCents = targetCents / (1 + r) ** yearsToTarget;
      return { age, amountCents: Decimal.fromMinorUnits(BigInt(Math.round(thresholdCents))) };
    }
    potCents = potCents * (1 + r) + annualContribCents;
  }
  return { age: null, amountCents: null };
}

/**
 * Derive the four FIRE milestones. Amounts: Lean = 0.7x, Fat = 1.5x the FIRE
 * number (exact Decimal); FIRE = the number itself; Coast from the growth
 * projection. Ages: FIRE from the MC median; Lean/Fat from the median band
 * crossing; Coast from the accumulation path.
 */
export function computeMilestones(input: MilestonesInput): readonly Milestone[] {
  const leanCents = input.fireNumberCents.mul(LEAN_FRACTION);
  const fatCents = input.fireNumberCents.mul(FAT_FRACTION);
  const coast = deriveCoast(input);

  return [
    { key: "coast", amountCents: coast.amountCents, age: coast.age, fromAge: true },
    {
      key: "lean",
      amountCents: leanCents,
      age: medianCrossingAge(input.yearlyBands, input.currentAge, leanCents),
      fromAge: false,
    },
    {
      key: "fire",
      amountCents: input.fireNumberCents,
      age: input.neverFi ? null : input.medianFireAge,
      fromAge: false,
    },
    {
      key: "fat",
      amountCents: fatCents,
      age: medianCrossingAge(input.yearlyBands, input.currentAge, fatCents),
      fromAge: false,
    },
  ];
}
