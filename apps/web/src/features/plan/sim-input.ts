/**
 * Converts a saved PlanPayload + liquid pot into a SimWorkerInput for the
 * initial simulation run from a saved plan.
 */

import type { PlanPayload } from "@privance/core";
import { Decimal, SCALE_CENTS } from "@privance/core";
import { getPreset } from "@privance/core/projection";
import type { SimWorkerInput } from "@/lib/sim/worker-client";

export function payloadToSimInput(payload: PlanPayload, potCents: Decimal): SimWorkerInput {
  const params =
    payload.preset === "custom"
      ? {
          muBps: payload.muBps,
          sigmaBps: payload.sigmaBps,
          stockWeight: payload.stockWeightBps / 10000,
        }
      : getPreset(payload.preset);

  const { muBps, sigmaBps, stockWeight } = params;

  const monthlyContributionCents = Decimal.fromMinorUnits(
    BigInt(payload.monthlyContributionCents),
    SCALE_CENTS,
  );
  const annualSpendCents = Decimal.fromMinorUnits(BigInt(payload.annualSpendCents), SCALE_CENTS);

  // A manual starting amount (v2) overrides the live account-derived pot, so the
  // dashboard projection and the Plan tab agree on what "today" is.
  const startingPotCents =
    payload.manualStartingPotCents !== undefined
      ? Decimal.fromMinorUnits(BigInt(payload.manualStartingPotCents), SCALE_CENTS)
      : potCents;

  return {
    startingPotCents,
    monthlyContributionCents,
    annualSpendCents,
    swrBps: payload.swrBps,
    currentAge: payload.currentAge,
    planUntilAge: payload.planUntilAge,
    stockWeight,
    seed: payload.seed,
    muBps,
    sigmaBps,
  };
}
