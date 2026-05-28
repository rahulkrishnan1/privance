import { apiFetch } from "./client";

// ---------------------------------------------------------------------------
// Wire types, mirror server/src/prices/wire.ts exactly
// ---------------------------------------------------------------------------

export type PriceEntry = {
  ticker: string;
  price: string; // decimal string
  /** Prior session close as decimal string, or null when upstream didn't provide it. */
  previousPrice: string | null;
  fetchedAt: string; // ISO-8601
};

export type RefreshPricesRequest = {
  tickers: string[];
  source: "yahoo" | "coingecko";
};

export type RefreshPricesResponse = {
  prices: PriceEntry[];
  unknown: string[];
};

export type CooldownResponse = {
  msUntilNextRefresh: number;
};

// ---------------------------------------------------------------------------
// Typed wrappers
// ---------------------------------------------------------------------------

export async function refreshPrices(
  tickers: string[],
  source: "yahoo" | "coingecko",
): Promise<RefreshPricesResponse> {
  const res = await apiFetch("/api/prices/refresh", {
    method: "POST",
    body: JSON.stringify({ tickers, source } satisfies RefreshPricesRequest),
  });
  return res.json() as Promise<RefreshPricesResponse>;
}

export async function getCooldown(): Promise<CooldownResponse> {
  const res = await apiFetch("/api/prices/cooldown");
  return res.json() as Promise<CooldownResponse>;
}
