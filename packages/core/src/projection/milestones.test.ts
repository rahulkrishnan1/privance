import { describe, expect, it } from "vitest";
import { Decimal } from "../decimal/decimal.js";
import { computeMilestones, type MilestonesInput } from "./milestones.js";
import type { YearBand } from "./types.js";

/** Build yearly bands from p50 dollar values; other percentiles mirror p50 (unused here). */
function bandsFromMedians(mediansDollars: number[]): YearBand[] {
  return mediansDollars.map((d) => {
    const v = Decimal.fromString(d.toFixed(2));
    return { p10: v, p25: v, p50: v, p75: v, p90: v };
  });
}

function dollars(n: number): Decimal {
  return Decimal.fromString(n.toFixed(2));
}

function byKey(ms: ReturnType<typeof computeMilestones>) {
  return Object.fromEntries(ms.map((m) => [m.key, m]));
}

function nonNull<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected a non-null milestone field");
  return value;
}

// A mid-career plan: $1,000,000 number, median pot grows from 200k past 1.5M.
function baseInput(overrides: Partial<MilestonesInput> = {}): MilestonesInput {
  // Ages 40..60 (21 bands), median crossing 700k around index 8, 1M ~ index 12, 1.5M ~ index 18.
  const medians = [
    200_000, 250_000, 320_000, 400_000, 480_000, 560_000, 640_000, 720_000, 800_000, 880_000,
    960_000, 1_040_000, 1_120_000, 1_200_000, 1_280_000, 1_360_000, 1_440_000, 1_520_000, 1_600_000,
    1_680_000, 1_760_000,
  ];
  return {
    fireNumberCents: dollars(1_000_000),
    startingPotCents: dollars(200_000),
    currentAge: 40,
    planUntilAge: 95,
    medianFireAge: 52,
    neverFi: false,
    yearlyBands: bandsFromMedians(medians),
    geoMeanBps: 526, // balanced geometric mean
    annualContributionCents: dollars(24_000),
    ...overrides,
  };
}

describe("computeMilestones", () => {
  it("returns the four milestones in ladder order", () => {
    const ms = computeMilestones(baseInput());
    expect(ms.map((m) => m.key)).toEqual(["coast", "lean", "fire", "fat"]);
  });

  it("lean = 0.7x and fat = 1.5x the FIRE number, exact Decimal", () => {
    const m = byKey(computeMilestones(baseInput()));
    expect(m.lean.amountCents?.toFloat()).toBe(700_000);
    expect(m.fire.amountCents?.toFloat()).toBe(1_000_000);
    expect(m.fat.amountCents?.toFloat()).toBe(1_500_000);
  });

  it("amount ladder is strictly increasing lean < fire < fat", () => {
    const m = byKey(computeMilestones(baseInput()));
    expect(nonNull(m.lean.amountCents).cmp(nonNull(m.fire.amountCents))).toBe(-1);
    expect(nonNull(m.fire.amountCents).cmp(nonNull(m.fat.amountCents))).toBe(-1);
  });

  it("FIRE age is the MC median, and Lean is reached no later than FIRE", () => {
    const m = byKey(computeMilestones(baseInput()));
    expect(m.fire.age).toBe(52);
    // Lean (700k) crosses at index 7 -> age 48; Fat (1.5M) at index 17 -> age 58
    // (band i is the pot at age currentAge + i + 1, matching the engine and chart).
    expect(m.lean.age).toBe(48);
    expect(m.fat.age).toBe(58);
    expect(nonNull(m.lean.age)).toBeLessThanOrEqual(nonNull(m.fire.age));
    expect(nonNull(m.fat.age)).toBeGreaterThanOrEqual(nonNull(m.fire.age));
  });

  it("band index i maps to age currentAge + i + 1 (end-of-year convention)", () => {
    // First band already at/above the lean threshold: crossing at index 0 must
    // report the age one year after currentAge, matching the engine and chart.
    const m = byKey(
      computeMilestones(
        baseInput({ currentAge: 40, yearlyBands: bandsFromMedians([700_000, 800_000, 900_000]) }),
      ),
    );
    expect(m.lean.age).toBe(41);
  });

  it("FIRE age is null when the plan never reaches the number", () => {
    const m = byKey(computeMilestones(baseInput({ neverFi: true, medianFireAge: 95 })));
    expect(m.fire.age).toBeNull();
    expect(m.fire.amountCents?.toFloat()).toBe(1_000_000);
  });

  it("a milestone the median never reaches has a null age", () => {
    // Median tops out below Fat FIRE (1.5M): fat.age must be null.
    const lowMedians = bandsFromMedians(
      Array.from({ length: 21 }, (_, i) => 200_000 + i * 50_000), // max 1.2M < 1.5M
    );
    const m = byKey(computeMilestones(baseInput({ yearlyBands: lowMedians })));
    expect(m.fat.age).toBeNull();
  });

  it("Coast FIRE: reachable plan reports an age below FIRE and a smaller threshold", () => {
    const m = byKey(computeMilestones(baseInput()));
    expect(m.coast.age).not.toBeNull();
    expect(nonNull(m.coast.age)).toBeLessThan(m.fire.age ?? 999);
    expect(m.coast.fromAge).toBe(true);
    // The coast threshold is below the full FIRE number (growth covers the rest).
    expect(nonNull(m.coast.amountCents).cmp(nonNull(m.fire.amountCents))).toBe(-1);
  });

  it("Coast is null when growth alone can never reach the number by the target age", () => {
    // Tiny pot, no contributions, near-zero growth: cannot coast.
    const m = byKey(
      computeMilestones(
        baseInput({
          startingPotCents: dollars(1_000),
          annualContributionCents: dollars(0),
          geoMeanBps: 10,
          currentAge: 63,
        }),
      ),
    );
    expect(m.coast.age).toBeNull();
    expect(m.coast.amountCents).toBeNull();
  });

  it("already past the coast target age still resolves without error", () => {
    const m = byKey(
      computeMilestones(baseInput({ currentAge: 66, planUntilAge: 95, coastTargetAge: 65 })),
    );
    // currentAge already meets/exceeds the FIRE number on the median path or not;
    // the function must return a defined milestone array regardless.
    expect(m.coast).toBeDefined();
  });
});
