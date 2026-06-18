/**
 * Client wrapper for the simulation Web Worker: ready handshake, pending map
 * keyed by request id, per-request timeout, and an in-thread fallback that
 * latches once triggered. Results are memoised by a stable serialisation of
 * the inputs plus DATASET_END_YEAR so a dataset bump invalidates stale entries.
 */

import { Decimal } from "@privance/core/decimal";
import {
  asSimSeed,
  DATASET_END_YEAR,
  type SimulateResult,
  simulatePlan,
  type YearBand,
} from "@privance/core/projection";

const WORKER_URL = "/sim/sim-worker.mjs";

// How long to wait for a single simulate call before falling back in-thread.
// The engine takes well under 1 s in Node; 5 s is generous for cold start plus
// first run on a low-end device.
const WORKER_TIMEOUT_MS = 5_000;

// Wire shapes (JSON-safe; shared with sim-worker-entry.ts via wire-types.ts)

import type {
  WireSimulateArgs,
  WireSimulateResult,
  WorkerRequest,
  WorkerResponse,
} from "./wire-types.js";

export interface SimWorkerInput {
  startingPotCents: Decimal;
  monthlyContributionCents: Decimal;
  annualSpendCents: Decimal;
  swrBps: number;
  currentAge: number;
  planUntilAge: number;
  /** Stock weight (0..1). */
  stockWeight: number;
  seed: string;
  muBps: number;
  sigmaBps: number;
  paths?: number;
}

let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let workerUnavailable = false;

const pending = new Map<
  string,
  { resolve: (v: WireSimulateResult) => void; reject: (e: Error) => void }
>();

// In-memory memo keyed by wire input hash + dataset version.
const memo = new Map<string, SimulateResult>();
const MEMO_MAX = 20;

function randomId(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function memoKey(args: WireSimulateArgs): string {
  // Stable JSON serialisation of all wire fields plus the dataset version
  // discriminator. Key order is fixed so identical inputs always hash the same.
  return JSON.stringify({
    _v: DATASET_END_YEAR,
    pot: args.startingPotCents,
    contrib: args.monthlyContributionCents,
    spend: args.annualSpendCents,
    swr: args.swrBps,
    age: args.currentAge,
    until: args.planUntilAge,
    w: args.stockWeight,
    seed: args.seed,
    mu: args.muBps,
    sigma: args.sigmaBps,
    paths: args.paths ?? null,
  });
}

function toWireArgs(input: SimWorkerInput): WireSimulateArgs {
  return {
    startingPotCents: input.startingPotCents.toString(),
    monthlyContributionCents: input.monthlyContributionCents.toString(),
    annualSpendCents: input.annualSpendCents.toString(),
    swrBps: input.swrBps,
    currentAge: input.currentAge,
    planUntilAge: input.planUntilAge,
    stockWeight: input.stockWeight,
    seed: input.seed,
    muBps: input.muBps,
    sigmaBps: input.sigmaBps,
    paths: input.paths,
  };
}

function fromWireResult(wire: WireSimulateResult): SimulateResult {
  const yearlyBands: YearBand[] = wire.mc.yearlyBands.map((b) => ({
    p10: Decimal.fromString(b.p10),
    p25: Decimal.fromString(b.p25),
    p50: Decimal.fromString(b.p50),
    p75: Decimal.fromString(b.p75),
    p90: Decimal.fromString(b.p90),
  }));
  return {
    fireNumber: Decimal.fromString(wire.fireNumber),
    mc: {
      successRate: wire.mc.successRate,
      neverFiFraction: wire.mc.neverFiFraction,
      medianFireAge: wire.mc.medianFireAge,
      pathCount: wire.mc.pathCount,
      yearlyBands,
    },
    replay: {
      survivalShare: wire.replay.survivalShare,
      excludedWindowCount: wire.replay.excludedWindowCount,
      completeWindowCount: wire.replay.completeWindowCount,
      worstCohorts: wire.replay.worstCohorts,
    },
  };
}

function runInThread(input: SimWorkerInput): SimulateResult {
  return simulatePlan({
    startingPotCents: input.startingPotCents,
    monthlyContributionCents: input.monthlyContributionCents,
    annualSpendCents: input.annualSpendCents,
    swrBps: input.swrBps,
    currentAge: input.currentAge,
    planUntilAge: input.planUntilAge,
    stockWeight: input.stockWeight,
    seed: asSimSeed(input.seed),
    muBps: input.muBps,
    sigmaBps: input.sigmaBps,
    paths: input.paths,
  });
}

function initWorker(): Promise<void> {
  if (workerReady !== null) return workerReady;

  workerReady = new Promise<void>((resolve, reject) => {
    try {
      const w = new Worker(WORKER_URL, { type: "module" });

      const onReady = (event: MessageEvent) => {
        if (event.data?.ready === true) {
          w.removeEventListener("message", onReady);
          worker = w;

          w.addEventListener("message", (ev: MessageEvent) => {
            const msg = ev.data as WorkerResponse;
            const p = pending.get(msg.id);
            if (!p) return;
            pending.delete(msg.id);
            if (msg.ok) {
              p.resolve(msg.result);
            } else {
              p.reject(new Error(msg.error));
            }
          });

          w.addEventListener("error", (ev: ErrorEvent) => {
            const err = new SimWorkerUnavailableError(ev);
            for (const entry of pending.values()) entry.reject(err);
            pending.clear();
            workerUnavailable = true;
            w.terminate();
            worker = null;
            workerReady = null;
          });

          resolve();
        }
      };

      w.addEventListener("message", onReady);
      w.addEventListener("error", (e) => {
        // Boot failure only: post-ready runtime errors are handled by the
        // listener installed in onReady.
        if (worker === null) {
          workerReady = null;
          reject(e);
        }
      });
    } catch (e) {
      workerReady = null;
      reject(e);
    }
  });

  return workerReady;
}

class SimWorkerTimeoutError extends Error {
  constructor() {
    super("sim worker timed out");
    this.name = "SimWorkerTimeoutError";
  }
}

class SimWorkerUnavailableError extends Error {
  constructor(cause: unknown) {
    super("sim worker unavailable");
    this.name = "SimWorkerUnavailableError";
    this.cause = cause;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SimWorkerTimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function simulateViaWorker(args: WireSimulateArgs): Promise<WireSimulateResult> {
  try {
    await initWorker();
  } catch (e) {
    throw new SimWorkerUnavailableError(e);
  }
  if (worker === null) throw new SimWorkerUnavailableError(null);

  const w = worker;
  const id = randomId();
  return new Promise<WireSimulateResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: WorkerRequest = { id, method: "simulate", args };
    w.postMessage(request);
  });
}

/**
 * Run a FIRE simulation. Results are memoized per session so repeated calls
 * with identical inputs (e.g. Plan tab + dashboard) skip the worker round-trip.
 *
 * Falls back to main-thread execution if the worker is unavailable or times
 * out; the fallback latches so subsequent calls skip the worker entirely.
 */
export async function simulate(input: SimWorkerInput): Promise<SimulateResult> {
  const args = toWireArgs(input);
  const key = memoKey(args);

  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let result: SimulateResult;

  if (!workerUnavailable) {
    try {
      const wire = await withTimeout(simulateViaWorker(args), WORKER_TIMEOUT_MS);
      result = fromWireResult(wire);
    } catch (e) {
      if (e instanceof SimWorkerTimeoutError || e instanceof SimWorkerUnavailableError) {
        // Timeout or boot failure (restricted WKWebView, CSP): latch the
        // fallback and run in-thread for this and all future calls (R18).
        workerUnavailable = true;
        if (worker !== null) {
          worker.terminate();
          worker = null;
        }
        for (const entry of pending.values()) entry.reject(new SimWorkerUnavailableError(e));
        pending.clear();
        result = runInThread(input);
      } else {
        // Worker payload error: deterministic, would recur in-thread. Propagate.
        throw e;
      }
    }
  } else {
    result = runInThread(input);
  }

  if (memo.size >= MEMO_MAX) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(key, result);
  return result;
}

/** Exported for testing: clear the in-memory memo without resetting the worker. */
export function clearSimMemo(): void {
  memo.clear();
}

/**
 * Reset all module-level state (worker, memo, pending, latch) to a clean slate
 * without reimporting the module. Part of the public test seam, alongside
 * clearSimMemo.
 */
export function resetWorkerState(): void {
  if (worker !== null) {
    worker.terminate();
    worker = null;
  }
  workerReady = null;
  workerUnavailable = false;
  pending.clear();
  memo.clear();
}
