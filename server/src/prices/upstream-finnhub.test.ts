import { describe, expect, it } from "bun:test";

import { fetchFinnhubPrices } from "./upstream-finnhub.js";

const KEY = "test-key";

function quote(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Route Finnhub profile and quote calls separately.
function fetcherFor(map: Record<string, () => Response>) {
  return async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes("stock/profile2")) return quote({ currency: "USD" });
    for (const [ticker, make] of Object.entries(map)) {
      if (urlStr.includes(`symbol=${ticker}`)) return make();
    }
    return new Response("not found", { status: 404 });
  };
}

describe("fetchFinnhubPrices", () => {
  it("returns fixed-8 price and previous price for a live quote", async () => {
    const { prices: out } = await fetchFinnhubPrices(
      ["AAPL"],
      KEY,
      fetcherFor({ AAPL: () => quote({ c: 182.5, pc: 180.25 }) }),
    );
    expect(out.get("AAPL")).toEqual({
      price: "182.50000000",
      previousPrice: "180.25000000",
      fetchedAt: expect.any(String),
    });
  });

  it("omits a ticker priced at 0 (Finnhub's unknown-symbol signal)", async () => {
    const { prices: out } = await fetchFinnhubPrices(
      ["NOPE"],
      KEY,
      fetcherFor({ NOPE: () => quote({ c: 0, pc: 0 }) }),
    );
    expect(out.has("NOPE")).toBe(false);
  });

  it("omits a ticker with a negative or non-finite price", async () => {
    const { prices: out } = await fetchFinnhubPrices(
      ["BAD"],
      KEY,
      fetcherFor({ BAD: () => quote({ c: -5, pc: 10 }) }),
    );
    expect(out.has("BAD")).toBe(false);
  });

  it("nulls previousPrice when previous close is sub-cent (divide-by-zero guard)", async () => {
    const { prices: out } = await fetchFinnhubPrices(
      ["NEW"],
      KEY,
      fetcherFor({ NEW: () => quote({ c: 100, pc: 0 }) }),
    );
    expect(out.get("NEW")).toMatchObject({ price: "100.00000000", previousPrice: null });
  });

  it("nulls previousPrice when previous close is missing", async () => {
    const { prices: out } = await fetchFinnhubPrices(
      ["NOPC"],
      KEY,
      fetcherFor({ NOPC: () => quote({ c: 50 }) }),
    );
    expect(out.get("NOPC")).toMatchObject({ price: "50.00000000", previousPrice: null });
  });

  it("isolates a 429 to that ticker (omitted, no throw) and keeps the rest", async () => {
    const { prices: out } = await fetchFinnhubPrices(
      ["LIM", "OK"],
      KEY,
      fetcherFor({
        LIM: () => new Response("rate limited", { status: 429 }),
        OK: () => quote({ c: 12.5, pc: 12 }),
      }),
    );
    expect(out.has("LIM")).toBe(false);
    expect(out.get("OK")).toMatchObject({ price: "12.50000000" });
  });

  it("isolates a 5xx to that ticker (omitted, no throw)", async () => {
    const { prices: out } = await fetchFinnhubPrices(
      ["DOWN"],
      KEY,
      fetcherFor({ DOWN: () => new Response("boom", { status: 503 }) }),
    );
    expect(out.has("DOWN")).toBe(false);
  });

  it("treats a 403 (bad key) as unknown rather than failing the batch", async () => {
    const { prices: out } = await fetchFinnhubPrices(
      ["FORB"],
      KEY,
      fetcherFor({ FORB: () => new Response("forbidden", { status: 403 }) }),
    );
    expect(out.has("FORB")).toBe(false);
  });

  it("omits a ticker whose body is not valid JSON", async () => {
    const { prices: out } = await fetchFinnhubPrices(
      ["JUNK"],
      KEY,
      fetcherFor({ JUNK: () => new Response("<html>nope</html>", { status: 200 }) }),
    );
    expect(out.has("JUNK")).toBe(false);
  });

  it("returns an empty map for no tickers without calling the fetcher", async () => {
    let called = false;
    const { prices: out } = await fetchFinnhubPrices([], KEY, async () => {
      called = true;
      return new Response("{}", { status: 200 });
    });
    expect(out.size).toBe(0);
    expect(called).toBe(false);
  });

  it("passes the api key as the Finnhub token query param on both endpoints", async () => {
    const seenUrls: string[] = [];
    await fetchFinnhubPrices(["AAPL"], "secret-123", async (url) => {
      seenUrls.push(url.toString());
      return String(url).includes("profile2") ? quote({ currency: "USD" }) : quote({ c: 1, pc: 1 });
    });
    expect(seenUrls).toEqual([
      "https://finnhub.io/api/v1/stock/profile2?symbol=AAPL&token=secret-123",
      "https://finnhub.io/api/v1/quote?symbol=AAPL&token=secret-123",
    ]);
  });
});

describe("fetchFinnhubPrices currency validation", () => {
  for (const currency of ["GBp", "GBP", "EUR", undefined, null, 123, "usd"]) {
    it(`rejects currency ${String(currency)} before requesting a quote`, async () => {
      const urls: string[] = [];
      const result = await fetchFinnhubPrices(["TEST"], KEY, async (url) => {
        urls.push(String(url));
        return String(url).includes("profile2")
          ? Response.json({ currency })
          : quote({ c: 100, pc: 99 });
      });
      expect(result.prices.size).toBe(0);
      expect(result.unsupported).toEqual(new Set(["TEST"]));
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain("/stock/profile2?symbol=TEST&token=test-key");
    });
  }

  for (const [failure, makeResponse] of Object.entries({
    unavailable: () => new Response("unavailable", { status: 503 }),
    limited: () => new Response("limited", { status: 429 }),
    unknown: () => new Response("not found", { status: 404 }),
    malformed: () => new Response("not json", { status: 200 }),
    network: () => {
      throw new Error("network unavailable");
    },
  })) {
    it(`never requests a quote when profile verification fails: ${failure}`, async () => {
      let calls = 0;
      const result = await fetchFinnhubPrices(["TEST"], KEY, async () => {
        calls++;
        return makeResponse();
      });
      expect(calls).toBe(1);
      expect(result.prices.size).toBe(0);
      expect(result.unsupported.size).toBe(0);
    });
  }
});
