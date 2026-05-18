"use client";

import { Decimal, SCALE_CRYPTO } from "@privance/core";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { ApiError } from "@/lib/api/client";
import { refreshPrices } from "@/lib/api/prices";

export type PricesMap = Map<string, Decimal>;

export type PricesQueryInput = {
  /** Yahoo tickers (stocks, ETFs, mutual funds, public proxies). */
  yahooTickers: string[];
  /** CoinGecko slugs (e.g. "bitcoin", "ethereum"), not exchange symbols. */
  coingeckoTickers: string[];
};

export type PricesQueryResult = {
  prices: PricesMap;
  isLoading: boolean;
  /** True when the server returned 429; cached prices may still be present. */
  isCooldownActive: boolean;
  isError: boolean;
};

const STALE_TIME_MS = 15 * 60 * 1000;
const GC_TIME_MS = 60 * 60 * 1000;

// Module-level price cache, shared across every consumer of usePricesQuery.
// Keeps known prices on screen across component unmounts (e.g. navigation
// between Dashboard and Holdings) and across query-key changes from add/delete.
const cache = new Map<string, Decimal>();
const listeners = new Set<() => void>();
let snapshot: PricesMap = cache;

function notify(): void {
  snapshot = new Map(cache);
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): PricesMap {
  return snapshot;
}

function commitFetched(fetched: ReadonlyMap<string, Decimal>): void {
  let changed = false;
  for (const [ticker, price] of fetched) {
    if (!cache.get(ticker)?.eq(price)) {
      cache.set(ticker, price);
      changed = true;
    }
  }
  if (changed) notify();
}

/** Seed a single price (used by pre-fetch at submit so the new row renders with a value). */
export function warmPrice(ticker: string, price: Decimal): void {
  if (cache.get(ticker)?.eq(price)) return;
  cache.set(ticker, price);
  notify();
}

export function usePricesQuery(input: PricesQueryInput): PricesQueryResult {
  const yahooSorted = [...new Set(input.yahooTickers)].sort();
  const coingeckoSorted = [...new Set(input.coingeckoTickers)].sort();
  const enabled = yahooSorted.length > 0 || coingeckoSorted.length > 0;

  const prices = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const { isFetching, isError, error } = useQuery({
    queryKey: ["prices", "y", ...yahooSorted, "c", ...coingeckoSorted],
    queryFn: async () => {
      // settled, not all-or-nothing: a Yahoo 429 mustn't black out CoinGecko.
      const [yahooRes, coingeckoRes] = await Promise.allSettled([
        yahooSorted.length > 0
          ? refreshPrices(yahooSorted, "yahoo")
          : Promise.resolve({ prices: [], unknown: [] }),
        coingeckoSorted.length > 0
          ? refreshPrices(coingeckoSorted, "coingecko")
          : Promise.resolve({ prices: [], unknown: [] }),
      ]);
      const fetched = new Map<string, Decimal>();
      if (yahooRes.status === "fulfilled") {
        for (const e of yahooRes.value.prices) {
          fetched.set(e.ticker, Decimal.fromString(e.price, SCALE_CRYPTO));
        }
      }
      if (coingeckoRes.status === "fulfilled") {
        for (const e of coingeckoRes.value.prices) {
          fetched.set(e.ticker, Decimal.fromString(e.price, SCALE_CRYPTO));
        }
      }
      commitFetched(fetched);
      const failure =
        yahooRes.status === "rejected"
          ? yahooRes.reason
          : coingeckoRes.status === "rejected"
            ? coingeckoRes.reason
            : null;
      if (failure !== null && fetched.size === 0) throw failure;
      return fetched;
    },
    enabled,
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });

  return {
    prices,
    isLoading: isFetching && prices.size === 0,
    isCooldownActive: isError && error instanceof ApiError && error.status === 429,
    isError,
  };
}
