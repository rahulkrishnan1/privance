/**
 * Shared wire types for the simulation worker RPC boundary.
 *
 * JSON-safe; Decimal values cross the boundary as decimal strings since
 * structured clone cannot carry BigInt instances.
 */

export interface WireSimulateArgs {
  startingPotCents: string;
  monthlyContributionCents: string;
  annualSpendCents: string;
  swrBps: number;
  currentAge: number;
  planUntilAge: number;
  stockWeight: number;
  seed: string;
  muBps: number;
  sigmaBps: number;
  paths?: number;
}

/** Host -> worker request envelope. The single shared shape both sides agree on. */
export interface WorkerRequest {
  id: string;
  method: "simulate";
  args: WireSimulateArgs;
}

export interface WireYearBand {
  p10: string;
  p25: string;
  p50: string;
  p75: string;
  p90: string;
}

export interface WireSimulateResult {
  fireNumber: string;
  mc: {
    successRate: number;
    neverFiFraction: number;
    medianFireAge: number;
    pathCount: number;
    yearlyBands: WireYearBand[];
  };
  replay: {
    survivalShare: number;
    excludedWindowCount: number;
    completeWindowCount: number;
    worstCohorts: { startYear: number; depletionAge: number }[];
  };
}

export type WorkerResponse =
  | { id: string; ok: true; result: WireSimulateResult }
  | { id: string; ok: false; error: string };
