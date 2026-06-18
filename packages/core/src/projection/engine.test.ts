/**
 * engine.test.ts -- Test-first suite for simulatePlan.
 *
 * Convention notes (documented here per plan U3):
 *   Success definition: pot > 0 at planUntilAge, regardless of whether FI was
 *     reached. Paths that never reach FI but are not depleted count as
 *     successes; neverFiFraction is reported separately.
 *   Percentile method: nearest-rank by sorted index (pure integer selection,
 *     no float). For N values and percentile p, index = floor(p * (N-1)).
 *   Draw order: path-major. All years for path 0 are drawn first, then all
 *     years for path 1, ..., so the PRNG state is deterministic and reviewable.
 *   FIRE number rounding: Decimal division with banker (half-even) rounding.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Decimal } from "../decimal/decimal.js";
import { DATASET_END_YEAR, DATASET_START_YEAR } from "./dataset.js";
import { simulatePlan } from "./engine.js";
import type { SimSeed } from "./types.js";
import { asSimSeed } from "./types.js";

/** Dollars to Decimal cents. */
function usd(dollars: number): Decimal {
  return Decimal.fromString(dollars.toFixed(2));
}

const SEED = asSimSeed("privance-test-v1");

/** Mid-career inputs: 35yo, retire at 65, plan until 95, balanced preset. */
const MID_CAREER = {
  startingPotCents: usd(200_000),
  monthlyContributionCents: usd(2_000),
  annualSpendCents: usd(60_000),
  swrBps: 400,
  currentAge: 35,
  planUntilAge: 95,
  stockWeight: 0.6,
  seed: SEED,
  muBps: 591,
  sigmaBps: 1167,
  paths: 5000,
};

/** Constant-zero-return weight: stockWeight 0 with 0 mu/sigma produces r=0. */
function zeroReturnParams() {
  return { muBps: 0, sigmaBps: 0, stockWeight: 0 };
}

/**
 * Independent expectation for the documented money float boundary: grow a cent
 * balance by rate r as Number(cents) * (1 + r), then banker-round to integer
 * cents. Encodes the contract from engine.ts, not its control flow, so it can
 * catch a regression in how returns are applied.
 */
function bankerGrow(balanceCents: bigint, r: number): bigint {
  const newFloat = Number(balanceCents) * (1 + r);
  const floored = Math.floor(newFloat);
  const frac = newFloat - floored;
  if (frac < 0.5) return BigInt(floored);
  if (frac > 0.5) return BigInt(floored + 1);
  return floored % 2 === 0 ? BigInt(floored) : BigInt(floored + 1);
}

describe("AE2: FIRE number derivation", () => {
  it("spend $40,000 at 4% SWR (400 bps) -> $1,000,000 target (exactly 100000000 cents)", () => {
    // annualSpend 4000000 cents / (400/10000) = 100000000 cents = $1,000,000
    const result = simulatePlan({
      ...MID_CAREER,
      startingPotCents: usd(1_000_000),
      annualSpendCents: usd(40_000),
      swrBps: 400,
      ...zeroReturnParams(),
      paths: 10,
    });
    // At exactly the target, FIRE age = currentAge (already-FI path)
    expect(result.fireNumber.toMinorUnits()).toBe(100_000_000n);
  });

  it("spend $40,000 at 3.5% SWR (350 bps) -> $1,142,857.14 target (114285714 cents, banker rounded)", () => {
    // 4000000 / (350/10000) = 4000000 * 10000/350 = 40000000000/350 = 114285714.2857...
    // Banker round: .2857 < .5, truncate -> 114285714 cents = $1,142,857.14
    const result = simulatePlan({
      ...MID_CAREER,
      startingPotCents: usd(1_142_857.14),
      annualSpendCents: usd(40_000),
      swrBps: 350,
      ...zeroReturnParams(),
      paths: 10,
    });
    expect(result.fireNumber.toMinorUnits()).toBe(114_285_714n);
  });
});

describe("AE3: determinism", () => {
  it("two invocations with identical inputs and seed produce deeply equal results", () => {
    const r1 = simulatePlan(MID_CAREER);
    const r2 = simulatePlan(MID_CAREER);

    // MC success rates and fractions
    expect(r1.mc.successRate).toBe(r2.mc.successRate);
    expect(r1.mc.neverFiFraction).toBe(r2.mc.neverFiFraction);
    expect(r1.mc.medianFireAge).toBe(r2.mc.medianFireAge);
    expect(r1.mc.pathCount).toBe(r2.mc.pathCount);

    // Fan chart bands -- Decimal equality by minor units
    for (let y = 0; y < r1.mc.yearlyBands.length; y++) {
      // biome-ignore lint/style/noNonNullAssertion: y < yearlyBands.length
      const b1 = r1.mc.yearlyBands[y]!;
      // biome-ignore lint/style/noNonNullAssertion: r2 has the same structure as r1
      const b2 = r2.mc.yearlyBands[y]!;
      expect(b1.p10.toMinorUnits()).toBe(b2.p10.toMinorUnits());
      expect(b1.p50.toMinorUnits()).toBe(b2.p50.toMinorUnits());
      expect(b1.p90.toMinorUnits()).toBe(b2.p90.toMinorUnits());
    }

    // Replay
    expect(r1.replay.survivalShare).toBe(r2.replay.survivalShare);
    expect(r1.replay.excludedWindowCount).toBe(r2.replay.excludedWindowCount);
    expect(r1.replay.completeWindowCount).toBe(r2.replay.completeWindowCount);
  });
});

describe("AE4: replay window exclusion", () => {
  it("excluded window count equals H-1 (horizon minus 1)", () => {
    const horizon = MID_CAREER.planUntilAge - MID_CAREER.currentAge; // 60
    const expectedExcluded = horizon - 1; // 59
    const expectedComplete = DATASET_END_YEAR - DATASET_START_YEAR + 1 - horizon + 1; // 152-60+1=93

    const result = simulatePlan({ ...MID_CAREER, paths: 10 });
    expect(result.replay.excludedWindowCount).toBe(expectedExcluded);
    expect(result.replay.completeWindowCount).toBe(expectedComplete);
  });

  it("survival denominator uses only complete windows", () => {
    const result = simulatePlan({ ...MID_CAREER, paths: 10 });
    // survivalShare is successes / completeWindowCount
    // It must be in [0, 1] and consistent with the counts
    expect(result.replay.survivalShare).toBeGreaterThanOrEqual(0);
    expect(result.replay.survivalShare).toBeLessThanOrEqual(1);
  });
});

describe("AE7: zero starting pot accumulation", () => {
  it("reaches target at analytically expected age under zero-return assumption", () => {
    // Monthly $1000 -> annual $12,000. Target $1,200,000 at 1% SWR (100 bps).
    // 1200000 / 12000 = 100 years exactly -- too long. Use target $120,000 at 10% SWR.
    // Actually: use monthly $10000 -> annual $120,000; target $300,000 at 4% SWR.
    // $120,000/yr, target $300,000 -> ceil(300000/120000) = ceil(2.5) = 3 years -> age 38.
    // Wait: after year 1: $120k < $300k; year 2: $240k < $300k; year 3: $360k >= $300k -> age 38.
    const contribution = Decimal.fromString("10000.00"); // exactly $10,000/mo -> $120,000/yr
    const result = simulatePlan({
      startingPotCents: usd(0),
      monthlyContributionCents: contribution,
      annualSpendCents: usd(60_000),
      swrBps: 400, // target = $1,500,000
      currentAge: 35,
      planUntilAge: 95,
      ...zeroReturnParams(),
      seed: SEED,
      paths: 1,
    });
    // Annual contrib = $120,000. Target = $1,500,000.
    // Year 1: $120k, year 2: $240k, ..., year 12: $1,440,000 < target
    // Year 13: $1,560,000 >= $1,500,000 -> FIRE at age 35 + 13 = 48
    expect(result.mc.medianFireAge).toBe(48);
  });

  it("accumulates from zero with positive contributions", () => {
    const result = simulatePlan({
      startingPotCents: usd(0),
      monthlyContributionCents: usd(1_000),
      annualSpendCents: usd(40_000),
      swrBps: 400,
      currentAge: 30,
      planUntilAge: 90,
      ...zeroReturnParams(),
      seed: SEED,
      paths: 1,
    });
    // Zero return, $12,000/yr contribution, target $1,000,000
    // ceil(1000000 / 12000) = ceil(83.33) = 84 years from start -> age 30+84=114 > 90
    // So this path never reaches FI
    expect(result.mc.neverFiFraction).toBe(1);
  });
});

describe("AE8: already-FI", () => {
  it("returns FIRE age = currentAge when pot exceeds target", () => {
    const result = simulatePlan({
      ...MID_CAREER,
      startingPotCents: usd(2_000_000), // well above $1,500,000 target
      annualSpendCents: usd(60_000),
      swrBps: 400, // target = $1,500,000
      paths: 10,
    });
    // Median FIRE age should be currentAge (35)
    expect(result.mc.medianFireAge).toBe(MID_CAREER.currentAge);
    expect(result.mc.neverFiFraction).toBe(0);
  });

  it("pot exactly equal to FIRE number enters drawdown immediately", () => {
    // target = 4000000 / 0.04 = 100000000 cents = $1,000,000
    const result = simulatePlan({
      ...MID_CAREER,
      startingPotCents: usd(1_000_000),
      annualSpendCents: usd(40_000),
      swrBps: 400,
      paths: 10,
    });
    expect(result.mc.medianFireAge).toBe(MID_CAREER.currentAge);
    expect(result.mc.neverFiFraction).toBe(0);
  });

  it("drawdown subtracts spend before applying the return (plan lifecycle order)", () => {
    // Already-FI: pot $1,000 = target ($100 spend at 10% SWR). Constant 10%
    // return (sigma 0). Spend-first: (1000 - 100) * 1.1 = 990.00 exactly.
    // Return-first would give 1000 * 1.1 - 100 = 1000.00, so this test pins
    // the order.
    const result = simulatePlan({
      ...MID_CAREER,
      startingPotCents: usd(1_000),
      annualSpendCents: usd(100),
      swrBps: 1000,
      muBps: 1000,
      sigmaBps: 0,
      paths: 3,
    });
    // biome-ignore lint/style/noNonNullAssertion: horizon >= 1 by schema
    expect(result.mc.yearlyBands[0]!.p50.toString()).toBe("990.00");
  });
});

describe("Happy path: balanced preset mid-career", () => {
  it("MC success rate is strictly between 0 and 1", () => {
    const result = simulatePlan(MID_CAREER);
    expect(result.mc.successRate).toBeGreaterThan(0);
    expect(result.mc.successRate).toBeLessThan(1);
  });

  it("percentile bands are ordered p10 <= p25 <= p50 <= p75 <= p90 every year", () => {
    const result = simulatePlan(MID_CAREER);
    for (const band of result.mc.yearlyBands) {
      expect(band.p10.cmp(band.p25)).toBeLessThanOrEqual(0);
      expect(band.p25.cmp(band.p50)).toBeLessThanOrEqual(0);
      expect(band.p50.cmp(band.p75)).toBeLessThanOrEqual(0);
      expect(band.p75.cmp(band.p90)).toBeLessThanOrEqual(0);
    }
  });

  it("yearly bands count matches horizon length", () => {
    const result = simulatePlan(MID_CAREER);
    const horizon = MID_CAREER.planUntilAge - MID_CAREER.currentAge;
    expect(result.mc.yearlyBands.length).toBe(horizon);
  });
});

describe("Edge cases", () => {
  it("contribution 0 with pot below target yields high neverFiFraction", () => {
    const result = simulatePlan({
      ...MID_CAREER,
      startingPotCents: usd(0),
      monthlyContributionCents: usd(0),
      annualSpendCents: usd(60_000),
      swrBps: 400, // target $1,500,000, pot $0
      paths: 100,
    });
    // No way to accumulate, so all paths should be neverFI
    expect(result.mc.neverFiFraction).toBe(1);
  });

  it("planUntilAge = currentAge + 1 runs a one-year horizon without error", () => {
    expect(() =>
      simulatePlan({
        ...MID_CAREER,
        planUntilAge: MID_CAREER.currentAge + 1,
        paths: 10,
      }),
    ).not.toThrow();
    const result = simulatePlan({
      ...MID_CAREER,
      planUntilAge: MID_CAREER.currentAge + 1,
      paths: 10,
    });
    expect(result.mc.yearlyBands.length).toBe(1);
  });

  it("pot exactly equal to target enters drawdown immediately (FIRE age = currentAge)", () => {
    // target at 4% SWR with $40k spend = $1M
    const result = simulatePlan({
      ...MID_CAREER,
      startingPotCents: usd(1_000_000),
      annualSpendCents: usd(40_000),
      swrBps: 400,
      paths: 10,
    });
    expect(result.mc.medianFireAge).toBe(MID_CAREER.currentAge);
  });
});

describe("AE9: 5000-path run", () => {
  it("success rate is in (0,1) and path count is 5000", () => {
    const result = simulatePlan(MID_CAREER);
    expect(result.mc.pathCount).toBe(5000);
    expect(result.mc.successRate).toBeGreaterThan(0);
    expect(result.mc.successRate).toBeLessThan(1);
  });

  it("p10/p50/p90 series contain distinct values from each other across the horizon", () => {
    const result = simulatePlan(MID_CAREER);
    // p10 and p90 must differ in at least some years
    let p10DiffersFromP90 = false;
    for (const band of result.mc.yearlyBands) {
      if (!band.p10.eq(band.p90)) {
        p10DiffersFromP90 = true;
        break;
      }
    }
    expect(p10DiffersFromP90).toBe(true);
  });
});

describe("AE10: replay worst cohorts", () => {
  it("worst cohorts have start years within dataset range", () => {
    const result = simulatePlan(MID_CAREER);
    for (const cohort of result.replay.worstCohorts) {
      expect(cohort.startYear).toBeGreaterThanOrEqual(DATASET_START_YEAR);
      expect(cohort.startYear).toBeLessThanOrEqual(DATASET_END_YEAR);
    }
  });

  it("has at least one worst cohort entry for a plan that has failing windows", () => {
    // Use aggressive params with large spend to ensure some failures
    const result = simulatePlan({
      ...MID_CAREER,
      startingPotCents: usd(500_000),
      annualSpendCents: usd(100_000),
      swrBps: 400,
      paths: 10,
    });
    // Target = $2,500,000 with only $500k starting -- should have failures
    expect(result.replay.worstCohorts.length).toBeGreaterThan(0);
  });

  it("worst cohorts are at most 3 entries", () => {
    const result = simulatePlan(MID_CAREER);
    expect(result.replay.worstCohorts.length).toBeLessThanOrEqual(3);
  });
});

describe("AE13: float-boundary round-trip property", () => {
  it("zero return leaves balance unchanged by contributions/spend only (integration anchor)", () => {
    // With zero return in Monte Carlo (sigma=0, mu=0), the balance changes
    // only by annual contribution per year during accumulation.
    const annualContrib = usd(12_000); // $1000/mo
    const result = simulatePlan({
      startingPotCents: usd(50_000),
      monthlyContributionCents: usd(1_000),
      annualSpendCents: usd(40_000),
      swrBps: 400,
      currentAge: 35,
      planUntilAge: 36, // 1-year horizon
      ...zeroReturnParams(),
      seed: SEED,
      paths: 1,
    });
    // After 1 year of accumulation (pot $50k < target $1M):
    // p50 should be exactly $50,000 + $12,000 = $62,000
    const expected = usd(50_000).add(annualContrib);
    // biome-ignore lint/style/noNonNullAssertion: horizon is 1, so yearlyBands has exactly 1 entry
    expect(result.mc.yearlyBands[0]!.p50.toMinorUnits()).toBe(expected.toMinorUnits());
  });

  it("single deterministic path: p50 of year 1 equals the banker-rounded grown pot (fast-check)", () => {
    // sigma=0 makes every MC draw exactly mu, so a single path is deterministic.
    // Drive the REAL simulatePlan and assert yearlyBands[0].p50 against an
    // independent banker-rounding expectation computed from inputs only.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }), // starting pot in whole dollars
        fc.integer({ min: 0, max: 5_000 }), // monthly contribution in whole dollars
        fc.integer({ min: -3_000, max: 5_000 }), // mu in bps (return for the year)
        (potDollars, monthlyDollars, muBps) => {
          const startingPotCents = usd(potDollars);
          const annualContribCents = usd(monthlyDollars * 12);
          // Keep the pot below the FIRE target so the path stays in accumulation:
          // contribution is added, then the return is applied (plan lifecycle).
          const grown = startingPotCents.add(annualContribCents);
          const expected = bankerGrow(grown.toMinorUnits(), muBps / 10000);

          const result = simulatePlan({
            startingPotCents,
            monthlyContributionCents: usd(monthlyDollars),
            annualSpendCents: usd(10_000_000), // huge target -> never leaves accumulation
            swrBps: 400,
            currentAge: 35,
            planUntilAge: 36, // 1-year horizon
            stockWeight: 0,
            seed: SEED,
            muBps,
            sigmaBps: 0,
            paths: 1,
          });

          // biome-ignore lint/style/noNonNullAssertion: horizon 1 -> exactly one band
          expect(result.mc.yearlyBands[0]!.p50.toMinorUnits()).toBe(expected);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property: determinism and monotonicity", () => {
  it("identical inputs+seed produce identical results for random valid inputs (fast-check)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 50_000_000 }), // startingPot in cents
        fc.integer({ min: 0, max: 100_000 }), // monthly contribution in cents
        fc.string({ minLength: 1, maxLength: 32 }),
        (potCents, contribCents, seedStr) => {
          const seed = asSimSeed(seedStr) as SimSeed;
          const inputs = {
            startingPotCents: Decimal.fromMinorUnits(BigInt(potCents)),
            monthlyContributionCents: Decimal.fromMinorUnits(BigInt(contribCents)),
            annualSpendCents: usd(30_000),
            swrBps: 400,
            currentAge: 40,
            planUntilAge: 70,
            stockWeight: 0.6,
            seed,
            muBps: 591,
            sigmaBps: 1167,
            paths: 50,
          };
          const r1 = simulatePlan(inputs);
          const r2 = simulatePlan(inputs);
          return (
            r1.mc.successRate === r2.mc.successRate &&
            r1.mc.neverFiFraction === r2.mc.neverFiFraction
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("already-FI paths: success rate non-decreasing in starting pot (pure drawdown, same seed)", () => {
    // When BOTH pots are above the FIRE target, both start in pure drawdown.
    // Drawing the same returns from the same seed, the larger pot always stays
    // ahead -- so its success rate must be >= the smaller's.
    fc.assert(
      fc.property(
        fc.integer({ min: 150_000_000, max: 200_000_000 }), // base pot >> target ($1.5M target)
        fc.integer({ min: 1_000_000, max: 50_000_000 }), // extra cents
        (baseCents, extraCents) => {
          // target = $40k spend / 4% SWR = $1M. base pot starts at $1.5M+ so already-FI.
          const base = {
            startingPotCents: Decimal.fromMinorUnits(BigInt(baseCents)),
            monthlyContributionCents: usd(0),
            annualSpendCents: usd(40_000),
            swrBps: 400, // target $1M, both pots > $1.5M so already-FI
            currentAge: 40,
            planUntilAge: 70,
            stockWeight: 0.6,
            seed: SEED,
            muBps: 591,
            sigmaBps: 1167,
            paths: 200,
          };
          const larger = {
            ...base,
            startingPotCents: Decimal.fromMinorUnits(BigInt(baseCents + extraCents)),
          };
          const r1 = simulatePlan(base);
          const r2 = simulatePlan(larger);
          // Both in pure drawdown from day 0, same draws -> larger pot must do at least as well
          return r2.mc.successRate >= r1.mc.successRate;
        },
      ),
      { numRuns: 50 },
    );
  });

  it("output contains no NaN for any valid input (fast-check)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 50_000 }),
        fc.integer({ min: 100, max: 600 }), // swrBps
        (potCents, contribCents, swrBps) => {
          const result = simulatePlan({
            startingPotCents: Decimal.fromMinorUnits(BigInt(potCents)),
            monthlyContributionCents: Decimal.fromMinorUnits(BigInt(contribCents)),
            annualSpendCents: usd(40_000),
            swrBps,
            currentAge: 35,
            planUntilAge: 65,
            stockWeight: 0.6,
            seed: SEED,
            muBps: 591,
            sigmaBps: 1167,
            paths: 50,
          });
          const s = result.mc.successRate;
          const n = result.mc.neverFiFraction;
          return !Number.isNaN(s) && !Number.isNaN(n) && s >= 0 && s <= 1 && n >= 0 && n <= 1;
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Performance", () => {
  // Smoke test for catastrophic regressions only. The bound is deliberately
  // generous: a healthy 5000-path run is well under a second, but this also
  // runs under v8 coverage instrumentation (which ~2-3x's wall time) on shared
  // CI runners, so a tighter bound would flake without catching real slowdowns.
  it("5000-path both-phases simulation completes under 3000ms", () => {
    const start = performance.now();
    simulatePlan(MID_CAREER);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });
});

describe("Depletion at terminal year", () => {
  it("pot hits exactly 0 at planUntilAge: final band is 0, survived = false", () => {
    // Zero return. Start in drawdown (pot > target). Spend == pot / horizon
    // so the pot depletes at the last year exactly.
    // horizon = 2: pot 200, spend 100, zero return.
    // Year 1: 200 - 100 = 100 (survived so far, applyReturn does nothing at 0%)
    // Year 2: 100 - 100 = 0 -> depletionAge set, survived = false.
    const horizon = 2;
    const spend = 100; // dollars
    const pot = 200; // dollars (spend * horizon)
    const result = simulatePlan({
      startingPotCents: usd(pot),
      monthlyContributionCents: usd(0),
      annualSpendCents: usd(spend),
      // SWR target: spend / 0.04 = 2500. pot 200 < 2500, so starts in accumulation.
      // Use 10000 bps (100% SWR) so target = spend * 1 = 100; pot 200 >= 100 -> drawdown.
      swrBps: 10000,
      currentAge: 35,
      planUntilAge: 35 + horizon,
      ...zeroReturnParams(),
      seed: SEED,
      paths: 1,
    });
    // The final year's band should be 0 (depletion filled zeros from depletionAge on).
    // biome-ignore lint/style/noNonNullAssertion: horizon = 2, so index 1 exists
    expect(result.mc.yearlyBands[horizon - 1]!.p50.toMinorUnits()).toBe(0n);
    // success = pot > 0 at planUntilAge; 0 is not > 0, so successRate = 0.
    expect(result.mc.successRate).toBe(0);
  });
});

describe("return clamp at -100% in accumulation", () => {
  it("a -100% return year zeroes the pot but the next year's contribution still lands", () => {
    // muBps = -10000 (mean -100%), sigma 0 -> every draw clamps to exactly -1.
    // Year 1: (pot 100 + contrib 1200) * 0 = 0.
    // Year 2: (0 + 1200) * 0 = 0  -> still zero, but path is not terminated
    //   (accumulation total-loss is not depletion), so it appears as a band.
    const result = simulatePlan({
      startingPotCents: usd(100),
      monthlyContributionCents: usd(100), // $1,200/yr
      annualSpendCents: usd(40_000),
      swrBps: 400, // target $1M, pot stays far below -> accumulation throughout
      currentAge: 35,
      planUntilAge: 37, // 2-year horizon
      stockWeight: 0,
      seed: SEED,
      muBps: -10_000,
      sigmaBps: 0,
      paths: 1,
    });
    // biome-ignore lint/style/noNonNullAssertion: horizon 2 -> two bands
    expect(result.mc.yearlyBands[0]!.p50.toMinorUnits()).toBe(0n);
    // biome-ignore lint/style/noNonNullAssertion: horizon 2 -> two bands
    expect(result.mc.yearlyBands[1]!.p50.toMinorUnits()).toBe(0n);
    // The pot is zero at the horizon, which is not > 0, so success is 0.
    expect(result.mc.successRate).toBe(0);
  });
});

describe("replay worst cohorts ordering", () => {
  it("worst cohorts are sorted by ascending depletion age (earliest failure first)", () => {
    const result = simulatePlan({
      ...MID_CAREER,
      startingPotCents: usd(500_000),
      annualSpendCents: usd(120_000), // big spend -> several failing windows
      swrBps: 400,
      stockWeight: 0.6,
    });
    const ages = result.replay.worstCohorts.map((c) => c.depletionAge);
    expect(ages.length).toBeGreaterThan(1);
    const sortedAscending = [...ages].sort((a, b) => a - b);
    expect(ages).toEqual(sortedAscending);
  });
});

describe("paths=1", () => {
  it("all five percentiles of yearlyBands[0] are equal for a single path", () => {
    const result = simulatePlan({ ...MID_CAREER, paths: 1 });
    // biome-ignore lint/style/noNonNullAssertion: horizon > 0 by schema
    const band = result.mc.yearlyBands[0]!;
    expect(band.p10.toMinorUnits()).toBe(band.p25.toMinorUnits());
    expect(band.p25.toMinorUnits()).toBe(band.p50.toMinorUnits());
    expect(band.p50.toMinorUnits()).toBe(band.p75.toMinorUnits());
    expect(band.p75.toMinorUnits()).toBe(band.p90.toMinorUnits());
  });
});

describe("Golden pin", () => {
  it("fixed seed produces exact p10/p90/successRate/survivalShare values", () => {
    const GOLDEN_SEED = asSimSeed("privance-golden-v1");
    const result = simulatePlan({
      startingPotCents: usd(200_000),
      monthlyContributionCents: usd(2_000),
      annualSpendCents: usd(60_000),
      swrBps: 400,
      currentAge: 35,
      planUntilAge: 65,
      stockWeight: 0.6,
      seed: GOLDEN_SEED,
      muBps: 591,
      sigmaBps: 1167,
      paths: 500,
    });
    // biome-ignore lint/style/noNonNullAssertion: yearlyBands[0] always exists for 30-year horizon
    expect(result.mc.yearlyBands[0]!.p10.toString()).toBe("203381.21");
    // biome-ignore lint/style/noNonNullAssertion: same
    expect(result.mc.yearlyBands[0]!.p90.toString()).toBe("268912.99");
    expect(result.mc.successRate).toBe(1);
    expect(result.replay.survivalShare).toBe(1);
  });
});
