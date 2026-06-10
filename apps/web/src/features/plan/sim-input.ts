/**
 * Converts a saved PlanPayload + liquid pot into a SimWorkerInput.
 *
 * Shared by plan-screen.tsx (initial run from saved payload) and the dashboard
 * projection hook, so both surfaces derive identical inputs and the worker-
 * client memo key matches -- a single computation serves both.
 */

import type { PlanPayload } from "@privance/core";
import { Decimal, SCALE_CENTS } from "@privance/core";
import { getPreset, PRESET_BALANCED } from "@privance/core/projection";
import type { SimWorkerInput } from "@/lib/sim/worker-client";

export function payloadToSimInput(payload: PlanPayload, potCents: Decimal): SimWorkerInput {
  const preset = payload.preset === "custom" ? null : getPreset(payload.preset);

  // getPreset always resolves a named preset, so the ?? guards are unreachable;
  // they exist only to satisfy the nullable type and derive from the balanced
  // preset so they can never drift from the source constants.
  const muBps =
    payload.preset === "custom" ? payload.muBps : (preset?.muBps ?? PRESET_BALANCED.muBps);
  const sigmaBps =
    payload.preset === "custom" ? payload.sigmaBps : (preset?.sigmaBps ?? PRESET_BALANCED.sigmaBps);
  const stockWeight =
    payload.preset === "custom"
      ? payload.stockWeightBps / 10000
      : (preset?.stockWeight ?? PRESET_BALANCED.stockWeight);

  const monthlyContributionCents = Decimal.fromMinorUnits(
    BigInt(payload.monthlyContributionCents),
    SCALE_CENTS,
  );
  const annualSpendCents = Decimal.fromMinorUnits(BigInt(payload.annualSpendCents), SCALE_CENTS);

  return {
    startingPotCents: potCents,
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
