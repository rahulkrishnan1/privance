type HoldingMin = {
  ticker: string;
  proxyTicker: string | null;
  assetType: string;
};

/** Split a list of holdings into Yahoo Finance and CoinGecko ticker sets. */
export function partitionTickers(holdings: HoldingMin[]): {
  yahooTickers: string[];
  coingeckoTickers: string[];
} {
  const yahoo = new Set<string>();
  const coingecko = new Set<string>();
  for (const h of holdings) {
    if (h.proxyTicker !== null) yahoo.add(h.proxyTicker);
    else if (h.assetType === "crypto") coingecko.add(h.ticker);
    else yahoo.add(h.ticker);
  }
  return { yahooTickers: [...yahoo], coingeckoTickers: [...coingecko] };
}
