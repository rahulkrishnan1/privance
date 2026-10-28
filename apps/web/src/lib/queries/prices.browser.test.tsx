import { Decimal, SCALE_CRYPTO } from "@privance/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { refreshPrices } from "@/lib/api/prices";
import { resetPricesCache, usePricesQuery, warmPrice } from "./prices";

vi.mock("@/lib/api/prices", () => ({ refreshPrices: vi.fn() }));
const refresh = vi.mocked(refreshPrices);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function entry(ticker: string, price = "100", previousPrice: string | null = "99") {
  return { ticker, price, previousPrice, fetchedAt: new Date().toISOString() };
}

function Harness() {
  const { prices, previousPrices, isError } = usePricesQuery({
    yahooTickers: ["AAPL", "MSFT"],
    coingeckoTickers: ["bitcoin"],
  });
  return (
    <>
      {["AAPL", "MSFT", "bitcoin", "unrelated"].map((ticker) => (
        <output key={ticker} aria-label={ticker}>
          {prices.get(ticker)?.toString() ?? "unpriced"} /{" "}
          {previousPrices.get(ticker)?.toString() ?? "no prior"}
        </output>
      ))}
      <output aria-label="Price status">{isError ? "error" : "ok"}</output>
    </>
  );
}

beforeEach(() => {
  client.clear();
  resetPricesCache();
  refresh.mockReset();
});
afterEach(() => client.clear());

async function mount() {
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

it("evicts current and prior prices on fulfilled unknown without blacking out other tickers", async () => {
  refresh.mockImplementation(async (_tickers, source) => ({
    prices:
      source === "yahoo"
        ? [entry("AAPL"), entry("MSFT", "200", "199")]
        : [entry("bitcoin", "300", "299")],
    unknown: [],
  }));
  warmPrice("unrelated", Decimal.fromString("400", SCALE_CRYPTO));
  const screen = await mount();
  await expect
    .element(screen.getByLabelText("AAPL"))
    .toMatchTextContent("100.00000000 / 99.00000000");
  await expect
    .element(screen.getByLabelText("bitcoin"))
    .toMatchTextContent("300.00000000 / 299.00000000");
  refresh.mockImplementation(async (_tickers, source) => ({
    prices: source === "yahoo" ? [entry("MSFT", "201", "200")] : [entry("bitcoin", "301", "300")],
    unknown: source === "yahoo" ? ["AAPL"] : [],
  }));
  await client.invalidateQueries({ queryKey: ["prices"] });
  await expect.element(screen.getByLabelText("AAPL")).toMatchTextContent("unpriced / no prior");
  await expect
    .element(screen.getByLabelText("MSFT"))
    .toMatchTextContent("201.00000000 / 200.00000000");
  await expect
    .element(screen.getByLabelText("bitcoin"))
    .toMatchTextContent("301.00000000 / 300.00000000");
  await expect
    .element(screen.getByLabelText("unrelated"))
    .toMatchTextContent("400.00000000 / no prior");
});

it("evicts a warmed price on fulfilled unknown", async () => {
  warmPrice("AAPL", Decimal.fromString("100", SCALE_CRYPTO));
  refresh.mockImplementation(async (_tickers, source) => ({
    prices: [],
    unknown: source === "yahoo" ? ["AAPL"] : [],
  }));
  const screen = await mount();
  await expect.element(screen.getByLabelText("AAPL")).toMatchTextContent("unpriced / no prior");
});

for (const failedSource of ["yahoo", "coingecko"] as const) {
  it(`preserves ${failedSource} cache on network rejection and commits the other source`, async () => {
    refresh.mockImplementation(async (_tickers, source) => ({
      prices: source === "yahoo" ? [entry("AAPL")] : [entry("bitcoin", "300", "299")],
      unknown: [],
    }));
    const screen = await mount();
    await expect
      .element(screen.getByLabelText("AAPL"))
      .toMatchTextContent("100.00000000 / 99.00000000");
    await expect
      .element(screen.getByLabelText("bitcoin"))
      .toMatchTextContent("300.00000000 / 299.00000000");
    refresh.mockImplementation(async (_tickers, source) => {
      if (source === failedSource) throw new Error("network unavailable");
      return {
        prices:
          source === "yahoo" ? [entry("AAPL", "101", "100")] : [entry("bitcoin", "301", "300")],
        unknown: [],
      };
    });
    await client.invalidateQueries({ queryKey: ["prices"] });
    await expect.element(screen.getByLabelText("Price status")).toMatchTextContent("error");
    await expect
      .element(screen.getByLabelText("AAPL"))
      .toMatchTextContent(
        failedSource === "yahoo" ? "100.00000000 / 99.00000000" : "101.00000000 / 100.00000000",
      );
    await expect
      .element(screen.getByLabelText("bitcoin"))
      .toMatchTextContent(
        failedSource === "coingecko"
          ? "300.00000000 / 299.00000000"
          : "301.00000000 / 300.00000000",
      );
  });
}
