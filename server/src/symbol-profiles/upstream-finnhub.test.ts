import { describe, expect, it } from "bun:test";

import { fetchFinnhubProfiles } from "./upstream-finnhub.js";

const KEY = "test-key";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Route the two Finnhub calls (/stock/profile2 and /stock/metric) by endpoint
// and the ticker embedded in the URL.
function fetcherFor(
  profiles: Record<string, () => Response>,
  metrics: Record<string, () => Response> = {},
) {
  return async (url: string | URL | Request) => {
    const s = url.toString();
    const ticker = s.match(/symbol=([^&]+)/)?.[1] ?? "";
    if (s.includes("stock/profile2")) {
      return (profiles[ticker] ?? (() => json({})))();
    }
    if (s.includes("stock/metric")) {
      return (metrics[ticker] ?? (() => json({ metric: {} })))();
    }
    return new Response("not found", { status: 404 });
  };
}

describe("fetchFinnhubProfiles", () => {
  it("maps a profile and converts the dividend percent to a fraction", async () => {
    const out = await fetchFinnhubProfiles(
      ["AAPL"],
      KEY,
      fetcherFor(
        {
          AAPL: () =>
            json({
              name: "Apple Inc",
              finnhubIndustry: "Technology",
              country: "US",
              currency: "USD",
              exchange: "NASDAQ NMS",
              ticker: "AAPL",
            }),
        },
        { AAPL: () => json({ metric: { dividendYieldIndicatedAnnual: 1.5 } }) },
      ),
    );
    expect(out.get("AAPL")).toMatchObject({
      ticker: "AAPL",
      assetType: "stock",
      displayName: "Apple Inc",
      sector: "Technology",
      country: "US",
      currency: "USD",
      exchange: "NASDAQ NMS",
      dividendYield: "0.015000",
    });
  });

  it("omits a ticker Finnhub returns no profile for (empty object)", async () => {
    const out = await fetchFinnhubProfiles(["ETF"], KEY, fetcherFor({ ETF: () => json({}) }));
    expect(out.has("ETF")).toBe(false);
  });

  it("treats a 403 (bad key) as unknown rather than failing the batch", async () => {
    const out = await fetchFinnhubProfiles(
      ["FORB"],
      KEY,
      fetcherFor({ FORB: () => new Response("forbidden", { status: 403 }) }),
    );
    expect(out.has("FORB")).toBe(false);
  });

  it("isolates a 429 to that ticker (omitted, no throw)", async () => {
    const out = await fetchFinnhubProfiles(
      ["LIM"],
      KEY,
      fetcherFor({ LIM: () => new Response("rate limited", { status: 429 }) }),
    );
    expect(out.has("LIM")).toBe(false);
  });

  it("falls back to the TTM yield when indicated-annual is 0", async () => {
    const out = await fetchFinnhubProfiles(
      ["KO"],
      KEY,
      fetcherFor(
        { KO: () => json({ name: "Coca-Cola", ticker: "KO" }) },
        {
          KO: () =>
            json({ metric: { dividendYieldIndicatedAnnual: 0, currentDividendYieldTTM: 2.0 } }),
        },
      ),
    );
    expect(out.get("KO")?.dividendYield).toBe("0.020000");
  });

  it("leaves dividendYield undefined when no positive yield is reported", async () => {
    const out = await fetchFinnhubProfiles(
      ["NODIV"],
      KEY,
      fetcherFor(
        { NODIV: () => json({ name: "No Dividend Co", ticker: "NODIV" }) },
        {
          NODIV: () =>
            json({ metric: { dividendYieldIndicatedAnnual: 0, currentDividendYieldTTM: 0 } }),
        },
      ),
    );
    expect(out.get("NODIV")).toBeDefined();
    expect(out.get("NODIV")?.dividendYield).toBeUndefined();
  });

  it("keeps the profile when the dividend metric call fails", async () => {
    const out = await fetchFinnhubProfiles(
      ["MSFT"],
      KEY,
      fetcherFor(
        { MSFT: () => json({ name: "Microsoft", finnhubIndustry: "Technology", ticker: "MSFT" }) },
        { MSFT: () => new Response("boom", { status: 500 }) },
      ),
    );
    expect(out.get("MSFT")).toMatchObject({ displayName: "Microsoft", sector: "Technology" });
    expect(out.get("MSFT")?.dividendYield).toBeUndefined();
  });

  it("omits a ticker whose profile body is not valid JSON", async () => {
    const out = await fetchFinnhubProfiles(
      ["JUNK"],
      KEY,
      fetcherFor({ JUNK: () => new Response("<html>nope</html>", { status: 200 }) }),
    );
    expect(out.has("JUNK")).toBe(false);
  });

  it("returns an empty map for no tickers", async () => {
    const out = await fetchFinnhubProfiles([], KEY, async () => json({}));
    expect(out.size).toBe(0);
  });
});
