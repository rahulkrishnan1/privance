import { describe, expect, it } from "bun:test";

import { LookupService } from "./lookup-service.js";
import type { SymbolProfile } from "./types.js";
import { UpstreamUnavailableError } from "./types.js";

class InMemoryRepo {
  private store = new Map<string, SymbolProfile>();

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

  seed(profile: SymbolProfile): void {
    this.store.set(profile.ticker, profile);
  }
}

function makeProfile(ticker: string): SymbolProfile {
  return {
    ticker,
    assetType: "stock",
    displayName: `${ticker} Inc.`,
    assetClass: "equity",
    sector: "Technology",
  };
}

function yahooProfileFetcher(
  profiles: SymbolProfile[],
  opts: { status?: number } = {},
): (url: string | URL | Request) => Promise<Response> {
  return async (url) => {
    const urlStr = String(url);
    // Crumb + cookie handshake the provider performs before quoteSummary.
    if (urlStr.includes("/v1/test/getcrumb")) {
      return new Response("test-crumb", { status: 200 });
    }
    if (urlStr.includes("fc.yahoo.com")) {
      return new Response("", { status: 404, headers: { "set-cookie": "A1=test; Path=/" } });
    }
    for (const p of profiles) {
      if (urlStr.includes(encodeURIComponent(p.ticker))) {
        if (opts.status !== undefined && opts.status !== 200) {
          return new Response("error", { status: opts.status });
        }
        // Simulate Yahoo quoteSummary response shape
        const body = {
          quoteSummary: {
            result: [
              {
                assetProfile: { sector: p.sector, industry: p.industry, country: p.country },
                summaryDetail: { currency: p.currency },
                quoteType: {
                  longName: p.displayName,
                  quoteType: "EQUITY",
                  exchange: p.exchange,
                },
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
    // Unknown ticker → 404
    return new Response("not found", { status: 404 });
  };
}

describe("LookupService, DB hit (no upstream call)", () => {
  it("returns cached profile without calling upstream fetcher", async () => {
    const repo = new InMemoryRepo();
    const aapl = makeProfile("AAPL");
    repo.seed(aapl);

    let fetcherCalled = false;
    const fetcher = async () => {
      fetcherCalled = true;
      return new Response("should not be called", { status: 500 });
    };

    const service = new LookupService({ repo: repo as never, fetcher });
    const result = await service.lookup({ tickers: ["AAPL"] });

    expect(fetcherCalled).toBe(false);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.ticker).toBe("AAPL");
    expect(result.unknown).toEqual([]);
  });
});

describe("LookupService, DB miss (cache miss → upstream fetch + insert)", () => {
  it("fetches from upstream and inserts into DB", async () => {
    const repo = new InMemoryRepo();
    const msft = makeProfile("MSFT");

    const fetcher = yahooProfileFetcher([msft]);
    const service = new LookupService({ repo: repo as never, fetcher });

    const result = await service.lookup({ tickers: ["MSFT"] });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.ticker).toBe("MSFT");
    expect(result.unknown).toEqual([]);

    // Should now be in the repo
    const cached = await (
      repo as unknown as {
        getMany: (o: { tickers: string[] }) => Promise<Map<string, SymbolProfile>>;
      }
    ).getMany({ tickers: ["MSFT"] });
    expect(cached.has("MSFT")).toBe(true);
  });
});

describe("LookupService, unknown ticker", () => {
  it("unknown ticker (DB miss, upstream 404) goes in unknown array", async () => {
    const repo = new InMemoryRepo();
    const fetcher = yahooProfileFetcher([]); // all → 404

    const service = new LookupService({ repo: repo as never, fetcher });
    const result = await service.lookup({ tickers: ["FAKE_TICK"] });

    expect(result.profiles).toEqual([]);
    expect(result.unknown).toEqual(["FAKE_TICK"]);
  });
});

describe("LookupService, fund classification + dividend yield", () => {
  it("bond-category fund is classified fixed_income with yield parsed from {raw}", async () => {
    const repo = new InMemoryRepo();
    const fetcher: (url: string | URL | Request) => Promise<Response> = async () => {
      const body = {
        quoteSummary: {
          result: [
            {
              assetProfile: {},
              summaryDetail: { yield: { raw: 0.037 } },
              quoteType: { longName: "Total Bond Market ETF", quoteType: "ETF", exchange: "XNAS" },
              fundProfile: { categoryName: "Intermediate-Term Bond" },
            },
          ],
          error: null,
        },
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const service = new LookupService({ repo: repo as never, fetcher });
    const result = await service.lookup({ tickers: ["BND"] });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.assetClass).toBe("fixed_income");
    expect(result.profiles[0]?.fundCategory).toBe("Intermediate-Term Bond");
    expect(result.profiles[0]?.dividendYield).toBe("0.037000");
  });
});

describe("LookupService, mixed batch", () => {
  it("partial hit: cached hit + uncached miss + unknown", async () => {
    const repo = new InMemoryRepo();
    const aapl = makeProfile("AAPL");
    repo.seed(aapl);

    const msft = makeProfile("MSFT");
    const fetcher = yahooProfileFetcher([msft]); // MSFT returns OK, NOPE → 404

    const service = new LookupService({ repo: repo as never, fetcher });
    const result = await service.lookup({ tickers: ["AAPL", "MSFT", "NOPE"] });

    expect(result.profiles.map((p) => p.ticker).sort()).toEqual(["AAPL", "MSFT"]);
    expect(result.unknown).toEqual(["NOPE"]);
  });
});

describe("LookupService, upstream 5xx on cache miss", () => {
  it("upstream 5xx is swallowed per-ticker and ticker lands in unknown", async () => {
    const repo = new InMemoryRepo();

    // Upstream always 500
    const fetcher = async () => new Response("error", { status: 500 });

    const service = new LookupService({ repo: repo as never, fetcher });
    const result = await service.lookup({ tickers: ["AAPL"] });

    expect(result.profiles).toEqual([]);
    expect(result.unknown).toEqual(["AAPL"]);
  });
});

describe("LookupService, empty tickers input", () => {
  it("returns empty result without touching upstream or DB", async () => {
    const repo = new InMemoryRepo();
    let fetcherCalled = false;
    const fetcher = async () => {
      fetcherCalled = true;
      return new Response("", { status: 200 });
    };

    const service = new LookupService({ repo: repo as never, fetcher });
    const result = await service.lookup({ tickers: [] });

    expect(fetcherCalled).toBe(false);
    expect(result.profiles).toEqual([]);
    expect(result.unknown).toEqual([]);
  });
});

describe("LookupService, UpstreamUnavailableError messages contain no ticker symbols", () => {
  const TICKER = "SECRET_TICKER_XYZ";

  it("upstream network error propagates as UpstreamUnavailableError with no ticker in message", async () => {
    const repo = new InMemoryRepo();
    const fetcher = async (): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    };

    const service = new LookupService({ repo: repo as never, fetcher });
    try {
      await service.lookup({ tickers: [TICKER] });
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamUnavailableError);
      if (err instanceof UpstreamUnavailableError) {
        expect(err.message).not.toContain(TICKER);
      }
    }
  });
});
