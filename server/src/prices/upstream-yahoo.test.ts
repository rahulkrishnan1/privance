import { describe, expect, it } from "bun:test";
import { fetchYahooPrices } from "./upstream-yahoo.js";

function chart(currency: unknown): Response {
  return Response.json({
    chart: { result: [{ meta: { currency, regularMarketPrice: 100, previousClose: 99 } }] },
  });
}

describe("fetchYahooPrices currency validation", () => {
  it("accepts USD with fixed-8 current and previous prices", async () => {
    const { prices: out, unsupported } = await fetchYahooPrices(["AAPL"], async () => chart("USD"));
    expect(unsupported.size).toBe(0);
    expect(out.get("AAPL")).toEqual({
      price: "100.00000000",
      previousPrice: "99.00000000",
      fetchedAt: expect.any(String),
    });
  });

  for (const currency of ["GBp", "GBP", "EUR", undefined, null, 123, "usd"]) {
    it(`rejects unvalidated currency ${String(currency)}`, async () => {
      const { prices: out, unsupported } = await fetchYahooPrices(["TEST"], async () =>
        chart(currency),
      );
      expect(out.has("TEST")).toBe(false);
      expect(unsupported).toEqual(new Set(["TEST"]));
    });
  }
});
