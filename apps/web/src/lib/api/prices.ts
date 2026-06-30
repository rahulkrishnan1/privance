import { z } from "zod";
import { apiFetch, parseJson } from "./client";

// Wire schemas -- mirror server/src/prices/wire.ts exactly.

const PriceEntrySchema = z.object({
  ticker: z.string(),
  price: z.string(),
  /** Prior session close as decimal string, or null when upstream didn't provide it. */
  previousPrice: z.string().nullable(),
  fetchedAt: z.string(),
});
type RefreshPricesRequest = {
  tickers: string[];
  source: "yahoo" | "coingecko";
};

const RefreshPricesResponseSchema = z.object({
  prices: z.array(PriceEntrySchema),
  unknown: z.array(z.string()),
});
export type RefreshPricesResponse = z.infer<typeof RefreshPricesResponseSchema>;

const CooldownResponseSchema = z.object({
  msUntilNextRefresh: z.number(),
});
type CooldownResponse = z.infer<typeof CooldownResponseSchema>;

export async function refreshPrices(
  tickers: string[],
  source: "yahoo" | "coingecko",
): Promise<RefreshPricesResponse> {
  const res = await apiFetch("/api/prices/refresh", {
    method: "POST",
    body: JSON.stringify({ tickers, source } satisfies RefreshPricesRequest),
  });
  return parseJson(res, RefreshPricesResponseSchema);
}

export async function getCooldown(): Promise<CooldownResponse> {
  const res = await apiFetch("/api/prices/cooldown");
  return parseJson(res, CooldownResponseSchema);
}
