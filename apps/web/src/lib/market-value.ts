import { Decimal, SCALE_CENTS, SCALE_CRYPTO } from "@privance/core";

type LocalHoldingMin = {
  ticker: string;
  proxyTicker: string | null;
  sharesMajor: string;
  sharesScale: number;
  scaleFactor: string | undefined;
};

type PriceEntry = { ticker: string; price: string };

// Mirrors `holdingMarketValue` in @privance/core but operates on the web-side
// LocalHolding shape (already decrypted + flattened by the feature query hooks)
// so it's usable before the data is reconstituted into a core Holding object.
// Shared between holdings + accounts to avoid cross-feature `_helpers` imports.
export function getMarketValue(h: LocalHoldingMin, prices: Map<string, PriceEntry>): Decimal {
  const priceTicker = h.proxyTicker ?? h.ticker;
  const entry = prices.get(priceTicker);
  if (entry === undefined) return Decimal.zero(SCALE_CENTS);
  try {
    const shares = Decimal.fromString(h.sharesMajor, h.sharesScale);
    const price = Decimal.fromString(entry.price, SCALE_CRYPTO);
    const scale =
      h.scaleFactor !== undefined ? Decimal.fromString(h.scaleFactor, SCALE_CRYPTO) : null;
    const effectivePrice = scale !== null ? price.mul(scale, { resultScale: SCALE_CRYPTO }) : price;
    return shares.mul(effectivePrice, { resultScale: SCALE_CENTS });
  } catch {
    return Decimal.zero(SCALE_CENTS);
  }
}
