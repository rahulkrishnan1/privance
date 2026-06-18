/**
 * Browser-mode worker integration test (real Chromium).
 *
 * Boots the REAL built worker at /sim/sim-worker.mjs and asserts that a
 * simulate round-trip returns values equal to running the engine in-thread.
 * Determinism makes this exact equality on the serialised shapes.
 *
 * ORDERING REQUIREMENT: apps/web/public/sim/sim-worker.mjs must exist before
 * this test runs. Build it with:
 *   node apps/web/scripts/build-sim-worker.mjs
 * The prebuild script runs this automatically before `next build`. For the
 * vitest browser project, run the build script once before running tests:
 *   pnpm --filter @privance/web build:sim-worker
 * The test will skip with a clear message if the file is absent.
 */

import { Decimal } from "@privance/core/decimal";
import { asSimSeed, simulatePlan } from "@privance/core/projection";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetWorkerState, type SimWorkerInput, simulate } from "./worker-client.js";

const FIXTURE: SimWorkerInput = {
  startingPotCents: Decimal.fromString("500000.00"),
  monthlyContributionCents: Decimal.fromString("2000.00"),
  annualSpendCents: Decimal.fromString("40000.00"),
  swrBps: 400,
  currentAge: 35,
  planUntilAge: 65,
  stockWeight: 0.6,
  seed: "privance-fire-v1",
  muBps: 700,
  sigmaBps: 1700,
  paths: 100,
};

beforeEach(() => resetWorkerState());
afterEach(() => resetWorkerState());

describe("sim worker integration (real worker in Chromium)", () => {
  it("round-trip matches in-thread engine output exactly", async () => {
    // Check the worker file is present; if absent, the Worker constructor will
    // throw and the test will fail with a clear network/404 error.
    const expected = simulatePlan({
      startingPotCents: FIXTURE.startingPotCents,
      monthlyContributionCents: FIXTURE.monthlyContributionCents,
      annualSpendCents: FIXTURE.annualSpendCents,
      swrBps: FIXTURE.swrBps,
      currentAge: FIXTURE.currentAge,
      planUntilAge: FIXTURE.planUntilAge,
      stockWeight: FIXTURE.stockWeight,
      seed: asSimSeed(FIXTURE.seed),
      muBps: FIXTURE.muBps,
      sigmaBps: FIXTURE.sigmaBps,
      paths: FIXTURE.paths,
    });

    const result = await simulate(FIXTURE);

    expect(result.fireNumber.toString()).toBe(expected.fireNumber.toString());
    expect(result.mc.successRate).toBe(expected.mc.successRate);
    expect(result.mc.neverFiFraction).toBe(expected.mc.neverFiFraction);
    expect(result.mc.medianFireAge).toBe(expected.mc.medianFireAge);
    expect(result.mc.pathCount).toBe(expected.mc.pathCount);

    const bands = result.mc.yearlyBands;
    const expBands = expected.mc.yearlyBands;
    expect(bands).toHaveLength(expBands.length);
    for (let i = 0; i < bands.length; i++) {
      // Compare every percentile, not just the median: a worker that garbles the
      // tail bands while keeping p50 right would otherwise slip through.
      // biome-ignore lint/style/noNonNullAssertion: index is in [0, length-1]
      const got = bands[i]!;
      // biome-ignore lint/style/noNonNullAssertion: lengths asserted equal above
      const want = expBands[i]!;
      expect({
        p10: got.p10.toString(),
        p25: got.p25.toString(),
        p50: got.p50.toString(),
        p75: got.p75.toString(),
        p90: got.p90.toString(),
      }).toEqual({
        p10: want.p10.toString(),
        p25: want.p25.toString(),
        p50: want.p50.toString(),
        p75: want.p75.toString(),
        p90: want.p90.toString(),
      });
    }

    expect(result.replay.survivalShare).toBe(expected.replay.survivalShare);
    expect(result.replay.completeWindowCount).toBe(expected.replay.completeWindowCount);
  });
});
