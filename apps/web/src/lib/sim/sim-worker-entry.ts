/**
 * Simulation worker entry.
 *
 * Wire protocol:
 *   host -> worker:  { id, method: "simulate", args: WireSimulateArgs }
 *   worker -> host:  { id, ok: true, result: WireSimulateResult }
 *                  | { id, ok: false, error: string }
 *   worker -> host (startup): { ready: true }
 *
 * Decimal values cross the boundary as decimal strings (structured clone
 * cannot carry BigInt instances). The worker reconstructs them via
 * Decimal.fromString and serialises results back to strings.
 *
 * No DEK, no ciphertext, no encrypted-record access here. Inputs are plain
 * numbers and strings.
 */

import { Decimal } from "@privance/core/decimal";
import type { SimulatePlanOptions } from "@privance/core/projection";
import { asSimSeed, simulatePlan } from "@privance/core/projection";

// Wire types (JSON-safe; shared with worker-client.ts via wire-types.ts)
import type { WireSimulateArgs, WireSimulateResult, WorkerRequest } from "./wire-types.js";

function handleSimulate(args: WireSimulateArgs): WireSimulateResult {
  const opts: SimulatePlanOptions = {
    startingPotCents: Decimal.fromString(args.startingPotCents),
    monthlyContributionCents: Decimal.fromString(args.monthlyContributionCents),
    annualSpendCents: Decimal.fromString(args.annualSpendCents),
    swrBps: args.swrBps,
    currentAge: args.currentAge,
    planUntilAge: args.planUntilAge,
    stockWeight: args.stockWeight,
    seed: asSimSeed(args.seed),
    muBps: args.muBps,
    sigmaBps: args.sigmaBps,
    paths: args.paths,
  };

  const result = simulatePlan(opts);

  return {
    fireNumber: result.fireNumber.toString(),
    mc: {
      successRate: result.mc.successRate,
      neverFiFraction: result.mc.neverFiFraction,
      medianFireAge: result.mc.medianFireAge,
      pathCount: result.mc.pathCount,
      yearlyBands: result.mc.yearlyBands.map((band) => ({
        p10: band.p10.toString(),
        p25: band.p25.toString(),
        p50: band.p50.toString(),
        p75: band.p75.toString(),
        p90: band.p90.toString(),
      })),
    },
    replay: {
      survivalShare: result.replay.survivalShare,
      excludedWindowCount: result.replay.excludedWindowCount,
      completeWindowCount: result.replay.completeWindowCount,
      worstCohorts: result.replay.worstCohorts.map((c) => ({
        startYear: c.startYear,
        depletionAge: c.depletionAge,
      })),
    },
  };
}

self.addEventListener("message", (event: MessageEvent) => {
  const req = event.data as WorkerRequest;
  const { id, args } = req;
  // Read method as a plain string: the worker must still reject a malformed
  // envelope at runtime even though the typed contract only names "simulate".
  const method: string = req.method;

  if (method !== "simulate") {
    self.postMessage({ id, ok: false, error: `Unknown method: ${method}` });
    return;
  }

  try {
    const result = handleSimulate(args);
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

self.postMessage({ ready: true });
