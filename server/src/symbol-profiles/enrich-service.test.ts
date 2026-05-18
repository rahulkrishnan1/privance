import { afterEach, beforeEach, describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Unit tests for EnrichService, no network, no real DB.
// ---------------------------------------------------------------------------

import { EnrichService } from "./enrich-service.js";
import * as rateLimit from "./rate-limit.js";
import type { SymbolProfile } from "./types.js";
import { RateLimitedError } from "./types.js";

// ---------------------------------------------------------------------------
// In-memory repo stub
// ---------------------------------------------------------------------------

class InMemoryRepo {
  readonly store = new Map<string, SymbolProfile>();

  async getMany(opts: { tickers: string[] }): Promise<Map<string, SymbolProfile>> {
    const out = new Map<string, SymbolProfile>();
    for (const t of opts.tickers) {
      const p = this.store.get(t);
      if (p) out.set(t, p);
    }
    return out;
  }

  async upsertMany(opts: { profiles: SymbolProfile[] }): Promise<void> {
    for (const p of opts.profiles) this.store.set(p.ticker, p);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_COOLDOWN_MS = 100;

function makeProfile(ticker: string): SymbolProfile {
  return { ticker, assetType: "stock", displayName: `${ticker} Inc.` };
}

function yahooOkFetcher(
  profiles: SymbolProfile[],
): (url: string | URL | Request) => Promise<Response> {
  return async (url) => {
    const urlStr = String(url);
    for (const p of profiles) {
      if (urlStr.includes(encodeURIComponent(p.ticker))) {
        const body = {
          quoteSummary: {
            result: [
              {
                assetProfile: {},
                summaryDetail: {},
                quoteType: { longName: p.displayName, quoteType: "EQUITY", exchange: "XNAS" },
              },
            ],
            error: null,
          },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  };
}

beforeEach(() => {
  rateLimit.resetAll();
});

afterEach(() => {
  rateLimit.resetAll();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EnrichService, happy path", () => {
  it("fetches profile from upstream and returns it", async () => {
    const repo = new InMemoryRepo();
    const aapl = makeProfile("AAPL");
    const fetcher = yahooOkFetcher([aapl]);

    const service = new EnrichService({
      repo: repo as never,
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({ userId: "user-1", tickers: ["AAPL"] });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.ticker).toBe("AAPL");
    expect(result.unknown).toEqual([]);
  });

  it("unknown ticker lands in unknown array", async () => {
    const repo = new InMemoryRepo();
    const fetcher = yahooOkFetcher([]); // all → 404

    const service = new EnrichService({
      repo: repo as never,
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({ userId: "user-1", tickers: ["FAKE"] });

    expect(result.profiles).toEqual([]);
    expect(result.unknown).toEqual(["FAKE"]);
  });
});

describe("EnrichService, per-user cooldown", () => {
  it("first request passes cooldown gate", async () => {
    const repo = new InMemoryRepo();
    const fetcher = yahooOkFetcher([makeProfile("AAPL")]);
    const service = new EnrichService({
      repo: repo as never,
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    await expect(
      service.refresh({ userId: "user-cooldown", tickers: ["AAPL"] }),
    ).resolves.toBeDefined();
  });

  it("second request within cooldown throws RateLimitedError", async () => {
    const repo = new InMemoryRepo();
    const fetcher = yahooOkFetcher([makeProfile("AAPL")]);
    const service = new EnrichService({
      repo: repo as never,
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    await service.refresh({ userId: "user-cooldown", tickers: ["AAPL"] });

    await expect(
      service.refresh({ userId: "user-cooldown", tickers: ["AAPL"] }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("different users have independent cooldowns", async () => {
    const repo = new InMemoryRepo();
    const fetcher = yahooOkFetcher([makeProfile("AAPL")]);
    const service = new EnrichService({
      repo: repo as never,
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    await service.refresh({ userId: "user-A", tickers: ["AAPL"] });

    await expect(service.refresh({ userId: "user-B", tickers: ["AAPL"] })).resolves.toBeDefined();
  });

  it("request is allowed after cooldown window elapses", async () => {
    const repo = new InMemoryRepo();
    const fetcher = yahooOkFetcher([makeProfile("AAPL")]);
    const service = new EnrichService({
      repo: repo as never,
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    await service.refresh({ userId: "user-cd", tickers: ["AAPL"] });
    await Bun.sleep(TEST_COOLDOWN_MS + 10);

    await expect(service.refresh({ userId: "user-cd", tickers: ["AAPL"] })).resolves.toBeDefined();
  });

  it("msUntilNextRefresh returns 0 before any refresh", () => {
    const repo = new InMemoryRepo();
    const service = new EnrichService({ repo: repo as never, cooldownMs: TEST_COOLDOWN_MS });
    expect(service.msUntilNextRefresh("no-refresh-yet")).toBe(0);
  });

  it("msUntilNextRefresh returns positive value immediately after refresh", async () => {
    const repo = new InMemoryRepo();
    const fetcher = yahooOkFetcher([makeProfile("AAPL")]);
    const service = new EnrichService({
      repo: repo as never,
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    await service.refresh({ userId: "user-ms", tickers: ["AAPL"] });
    expect(service.msUntilNextRefresh("user-ms")).toBeGreaterThan(0);
  });
});
