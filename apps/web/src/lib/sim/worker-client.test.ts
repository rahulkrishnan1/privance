/**
 * Unit tests for worker-client.ts (happy-dom, Worker mocked).
 *
 * Tests cover:
 *  - happy path: worker returns result matching in-thread engine
 *  - worker error propagates as rejected promise
 *  - timeout triggers in-thread fallback and latches it
 *  - two concurrent requests resolve independently via the pending map
 *  - second identical call returns memoized result (no extra postMessage)
 */

import { Decimal } from "@privance/core/decimal";
import { asSimSeed, simulatePlan } from "@privance/core/projection";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSimMemo, resetWorkerState, type SimWorkerInput, simulate } from "./worker-client.js";

// MEMO_MAX must match the constant in worker-client.ts.
const MEMO_MAX = 20;

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

// In-thread ground truth for the fixture (deterministic).
function inThreadResult() {
  return simulatePlan({
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
}

type WorkerListener = ((event: MessageEvent) => void) | null;

interface MockWorker {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

/**
 * Build a fake Worker. The worker-client registers listeners in this order:
 *   1. addEventListener("message", onReady)    - during initWorker
 *   2. addEventListener("error", ...)          - during initWorker
 *   3. addEventListener("message", handler)    - inside onReady callback
 *   4. addEventListener("error", ...)          - inside onReady callback
 * Ready fires on the first microtask after construction.
 * postMessage is called synchronously after initWorker resolves.
 *
 * opts.respondWith: synchronously calls back with the given result after postMessage.
 * opts.rejectWith:  synchronously calls back with error after postMessage.
 * opts.noResponse:  postMessage is called (counted) but no callback is made (for timeout tests).
 */
function makeMockWorker(opts: {
  respondWith?: (msg: { id: string; method: string; args: unknown }) => object;
  rejectWith?: string;
  noResponse?: boolean;
}): { w: MockWorker; postMessageMock: ReturnType<typeof vi.fn> } {
  let onReadyListener: WorkerListener = null;
  let messageHandler: WorkerListener = null;
  const postMessageMock = vi.fn();

  const w: MockWorker = {
    addEventListener: vi.fn((event: string, listener: (event: MessageEvent) => void) => {
      if (event === "message") {
        if (onReadyListener === null) {
          onReadyListener = listener;
          // Fire ready on the next microtask.
          Promise.resolve().then(() => {
            onReadyListener?.({ data: { ready: true } } as MessageEvent);
          });
        } else {
          // Second message listener: the permanent response handler.
          messageHandler = listener;
        }
      }
    }),
    removeEventListener: vi.fn(),
    terminate: vi.fn(),
    postMessage: postMessageMock.mockImplementation(
      (msg: { id: string; method: string; args: unknown }) => {
        if (opts.noResponse) return;

        if (opts.rejectWith !== undefined) {
          const replyEvent = {
            data: { id: msg.id, ok: false, error: opts.rejectWith },
          } as MessageEvent;
          messageHandler?.(replyEvent);
          return;
        }

        if (opts.respondWith) {
          const result = opts.respondWith(msg);
          const replyEvent = { data: { id: msg.id, ok: true, result } } as MessageEvent;
          messageHandler?.(replyEvent);
        }
      },
    ),
  };

  return { w, postMessageMock };
}

// Serialise result the same way the worker does (Decimal -> string).
function toWireResult(result: ReturnType<typeof inThreadResult>) {
  return {
    fireNumber: result.fireNumber.toString(),
    mc: {
      successRate: result.mc.successRate,
      neverFiFraction: result.mc.neverFiFraction,
      medianFireAge: result.mc.medianFireAge,
      pathCount: result.mc.pathCount,
      yearlyBands: result.mc.yearlyBands.map((b) => ({
        p10: b.p10.toString(),
        p25: b.p25.toString(),
        p50: b.p50.toString(),
        p75: b.p75.toString(),
        p90: b.p90.toString(),
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

describe("simulate()", () => {
  beforeEach(() => {
    resetWorkerState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: resolves with result equal to in-thread engine output", async () => {
    const expected = inThreadResult();
    const wireResult = toWireResult(expected);
    const { w } = makeMockWorker({ respondWith: () => wireResult });
    // Use a class-like stub so 'new Worker(...)' returns our mock object.
    vi.stubGlobal("Worker", function MockWorkerCtor() {
      return w;
    });

    const result = await simulate(FIXTURE);

    expect(result.fireNumber.toString()).toBe(expected.fireNumber.toString());
    expect(result.mc.successRate).toBe(expected.mc.successRate);
    expect(result.mc.pathCount).toBe(expected.mc.pathCount);
    expect(result.replay.survivalShare).toBe(expected.replay.survivalShare);
    expect(result.mc.yearlyBands).toHaveLength(expected.mc.yearlyBands.length);
  });

  it("worker error propagates as rejected promise with the worker's message", async () => {
    const { w } = makeMockWorker({ rejectWith: "internal engine error" });
    vi.stubGlobal("Worker", function MockWorkerCtor() {
      return w;
    });

    await expect(simulate(FIXTURE)).rejects.toThrow("internal engine error");
  });

  it("timeout triggers in-thread fallback and result matches engine", async () => {
    vi.useFakeTimers();
    const { w, postMessageMock } = makeMockWorker({ noResponse: true });
    vi.stubGlobal("Worker", function MockWorkerCtor() {
      return w;
    });

    const promise = simulate(FIXTURE);
    // Let microtasks (ready event, initWorker resolution) run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Advance past the 5 s timeout.
    await vi.advanceTimersByTimeAsync(6_000);
    vi.useRealTimers();

    const result = await promise;
    const expected = inThreadResult();
    expect(result.fireNumber.toString()).toBe(expected.fireNumber.toString());
    expect(result.mc.successRate).toBe(expected.mc.successRate);
    // postMessage was called once (the timed-out request).
    expect(postMessageMock).toHaveBeenCalledTimes(1);
  });

  it("fallback latches: after timeout subsequent calls skip the worker entirely", async () => {
    vi.useFakeTimers();
    const { w, postMessageMock } = makeMockWorker({ noResponse: true });
    vi.stubGlobal("Worker", function MockWorkerCtor() {
      return w;
    });

    const p1 = simulate(FIXTURE);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(6_000);
    vi.useRealTimers();
    await p1;

    // Reset memo so memoization doesn't mask the test.
    clearSimMemo();

    // Second call: worker is latched unavailable, should NOT post another message.
    const result = await simulate(FIXTURE);
    // postMessage still only called once (from the first call).
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(result.mc.pathCount).toBe(FIXTURE.paths);
  });

  it("two concurrent requests resolve independently via the pending map", async () => {
    const expected = inThreadResult();
    const wireResult = toWireResult(expected);

    const resolvers: Array<() => void> = [];
    let onReadyListener: WorkerListener = null;
    let messageHandler: WorkerListener = null;

    const postMessageMock = vi.fn((msg: { id: string }) => {
      const id = msg.id;
      // Capture the id and fire the response only when we manually call the resolver.
      resolvers.push(() => {
        messageHandler?.({
          data: { id, ok: true, result: wireResult },
        } as MessageEvent);
      });
    });

    const w = {
      addEventListener: vi.fn((event: string, listener: (event: MessageEvent) => void) => {
        if (event === "message") {
          if (onReadyListener === null) {
            onReadyListener = listener;
            Promise.resolve().then(() => {
              onReadyListener?.({ data: { ready: true } } as MessageEvent);
            });
          } else {
            messageHandler = listener;
          }
        }
      }),
      removeEventListener: vi.fn(),
      terminate: vi.fn(),
      postMessage: postMessageMock,
    };

    vi.stubGlobal("Worker", function MockWorkerCtor() {
      return w;
    });

    const p1 = simulate(FIXTURE);
    const input2: SimWorkerInput = { ...FIXTURE, paths: 50 };
    const p2 = simulate(input2);

    // Let the ready event and both postMessage calls queue up.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(resolvers).toHaveLength(2);

    // Fire in reverse order to prove pending map matches by id (not FIFO).
    resolvers[1]?.();
    resolvers[0]?.();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.fireNumber.toString()).toBe(expected.fireNumber.toString());
    expect(r2.fireNumber.toString()).toBe(expected.fireNumber.toString());
  });

  it("worker boot failure falls back in-thread and latches (R18 restricted hosts)", async () => {
    const ctor = vi.fn(() => {
      throw new Error("Worker blocked by CSP");
    });
    vi.stubGlobal("Worker", ctor);

    const expected = inThreadResult();
    const result = await simulate(FIXTURE);
    expect(result.fireNumber.toString()).toBe(expected.fireNumber.toString());
    expect(result.mc.successRate).toBe(expected.mc.successRate);

    // Latched: a second call with different inputs must not retry the constructor.
    clearSimMemo();
    await simulate({ ...FIXTURE, paths: 50 });
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it("second call with identical inputs returns memoized result without extra worker round-trip", async () => {
    const expected = inThreadResult();
    const wireResult = toWireResult(expected);
    const { w, postMessageMock } = makeMockWorker({ respondWith: () => wireResult });
    vi.stubGlobal("Worker", function MockWorkerCtor() {
      return w;
    });

    const r1 = await simulate(FIXTURE);
    const r2 = await simulate(FIXTURE);

    // postMessage sent only once (second call hits memo).
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    // Both results are the same object reference from the memo.
    expect(r1).toBe(r2);
  });

  it("memo evicts the oldest entry but keeps recent ones (LRU by reference identity)", async () => {
    // Use the in-thread fallback path by latching workerUnavailable via a boot-fail stub.
    vi.stubGlobal("Worker", () => {
      throw new Error("no worker in this test");
    });

    // A memo hit returns the SAME object reference; a recompute returns a fresh
    // one. That identity check distinguishes eviction from a silent pass.
    const inputs: SimWorkerInput[] = Array.from({ length: MEMO_MAX + 1 }, (_, i) => ({
      ...FIXTURE,
      paths: i + 1, // distinct paths values 1..MEMO_MAX+1 -> distinct memo keys
    }));

    // biome-ignore lint/style/noNonNullAssertion: inputs is non-empty by construction
    const oldest = inputs[0]!;
    // biome-ignore lint/style/noNonNullAssertion: inputs has > 1 entry
    const second = inputs[1]!;

    const oldestFirst = await simulate(oldest);
    const secondFirst = await simulate(second);

    // Fill the rest. After MEMO_MAX+1 distinct inputs, the very first (oldest)
    // entry has been evicted; "second" is still within the window.
    for (let i = 2; i < inputs.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by length
      await simulate(inputs[i]!);
    }

    // Check the survivor first: re-simulating "second" before touching anything
    // else is a memo hit -> same reference. (Doing the oldest recompute first
    // would itself evict another entry and perturb the window.)
    const secondAgain = await simulate(second);
    expect(secondAgain).toBe(secondFirst);

    // The oldest entry was evicted, so this recomputes -> a new object reference.
    const oldestAgain = await simulate(oldest);
    expect(oldestAgain).not.toBe(oldestFirst);
  });

  it("post-ready worker error causes in-flight simulate to resolve via in-thread fallback", async () => {
    let errorListener: ((ev: ErrorEvent) => void) | null = null;
    let onReadyListener: ((ev: MessageEvent) => void) | null = null;
    let _postReadyMessageHandler: ((ev: MessageEvent) => void) | null = null;
    const postMessageMock = vi.fn();

    const w = {
      addEventListener: vi.fn((event: string, listener: (ev: unknown) => void) => {
        if (event === "message") {
          if (onReadyListener === null) {
            onReadyListener = listener as (ev: MessageEvent) => void;
            // Fire ready on the next microtask.
            Promise.resolve().then(() => {
              onReadyListener?.({ data: { ready: true } } as MessageEvent);
            });
          } else {
            _postReadyMessageHandler = listener as (ev: MessageEvent) => void;
          }
        } else if (event === "error") {
          // The first error listener is the boot-failure guard (ignored here).
          // The second is the post-ready crash handler we want to fire.
          if (onReadyListener !== null) {
            errorListener = listener as (ev: ErrorEvent) => void;
          }
        }
      }),
      removeEventListener: vi.fn(),
      terminate: vi.fn(),
      postMessage: postMessageMock.mockImplementation(() => {
        // Do NOT respond -- let the error fire instead.
      }),
    };

    vi.stubGlobal("Worker", function MockWorkerCtor() {
      return w;
    });

    const p = simulate(FIXTURE);

    // Let the ready event and postMessage call settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Fire the post-ready error event (simulating a worker crash after boot).
    if (errorListener !== null) {
      (errorListener as (ev: ErrorEvent) => void)({ message: "crashed" } as ErrorEvent);
    }

    // The in-flight simulate() should fall back to in-thread and resolve.
    const result = await p;
    const expected = inThreadResult();
    expect(result.fireNumber.toString()).toBe(expected.fireNumber.toString());
    expect(result.mc.successRate).toBe(expected.mc.successRate);

    // Subsequent calls must skip the worker (latched).
    clearSimMemo();
    const result2 = await simulate(FIXTURE);
    // postMessage only called once (the original in-flight request before crash).
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(result2.mc.successRate).toBe(expected.mc.successRate);
  });
});
