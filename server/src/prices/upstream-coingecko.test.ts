import { afterEach, describe, expect, it } from "bun:test";

import { fetchCoinGeckoPrices } from "./upstream-coingecko.js";

const SAVED_KEY = process.env.COINGECKO_API_KEY;

afterEach(() => {
  if (SAVED_KEY === undefined) delete process.env.COINGECKO_API_KEY;
  else process.env.COINGECKO_API_KEY = SAVED_KEY;
});

function captureHeaders() {
  const seen: { headers?: Record<string, string> } = {};
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    seen.headers = init?.headers as Record<string, string>;
    return new Response(JSON.stringify({ bitcoin: { usd: 1, usd_24h_change: 0 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { seen, fetcher };
}

describe("fetchCoinGeckoPrices Demo key header", () => {
  it("sends the x-cg-demo-api-key header when COINGECKO_API_KEY is set", async () => {
    process.env.COINGECKO_API_KEY = "CG-demo-key";
    const { seen, fetcher } = captureHeaders();
    await fetchCoinGeckoPrices(["bitcoin"], fetcher);
    expect(seen.headers?.["x-cg-demo-api-key"]).toBe("CG-demo-key");
  });

  it("omits the header when COINGECKO_API_KEY is unset", async () => {
    delete process.env.COINGECKO_API_KEY;
    const { seen, fetcher } = captureHeaders();
    await fetchCoinGeckoPrices(["bitcoin"], fetcher);
    expect(seen.headers?.["x-cg-demo-api-key"]).toBeUndefined();
  });
});
