"use client";

import { Decimal, SCALE_CRYPTO } from "@privance/core";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { refreshPrices } from "@/lib/api/prices";

type PricesMap = Map<string, Decimal>;

type PricesQueryInput = {
  /** Yahoo tickers (stocks, ETFs, mutual funds, public proxies). */
  yahooTickers: string[];
  /** CoinGecko slugs (e.g. "bitcoin", "ethereum"), not exchange symbols. */
  coingeckoTickers: string[];
};

type PricesQueryResult = {
  prices: PricesMap;
  /** Prior session close per ticker. Absent when upstream didn't provide it. */
  previousPrices: PricesMap;
  isLoading: boolean;
  isError: boolean;
};

const STALE_TIME_MS = 15 * 60 * 1000;
const GC_TIME_MS = 60 * 60 * 1000;

// Module-level price cache, shared across every consumer of usePricesQuery.
// Keeps known prices on screen across component unmounts (e.g. navigation
// between Dashboard and Holdings) and across query-key changes from add/delete.
const cache = new Map<string, Decimal>();
const prevCache = new Map<string, Decimal>();
const listeners = new Set<() => void>();
let snapshot: PricesMap = cache;
let prevSnapshot: PricesMap = prevCache;

function notify(): void {
  snapshot = new Map(cache);
  prevSnapshot = new Map(prevCache);
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): PricesMap {
  return snapshot;
}

function getPrevSnapshot(): PricesMap {
  return prevSnapshot;
}

function commitFetched(
  fetched: ReadonlyMap<string, Decimal>,
  fetchedPrev: ReadonlyMap<string, Decimal>,
): void {
  let changed = false;
  for (const [ticker, price] of fetched) {
    if (!cache.get(ticker)?.eq(price)) {
      cache.set(ticker, price);
      changed = true;
    }
  }
  for (const [ticker, prev] of fetchedPrev) {
    if (!prevCache.get(ticker)?.eq(prev)) {
      prevCache.set(ticker, prev);
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

/** Drop all cached prices and prior-session prices. Called on auth transitions
 *  (logout, login) so a new user does not see the previous user's stale prev
 *  values during the first compute cycle. */
export function resetPricesCache(): void {
  if (cache.size === 0 && prevCache.size === 0) return;
  cache.clear();
  prevCache.clear();
  notify();
}

/**
 * Returns the error to re-throw (so TanStack Query marks isError=true), or
 * null if everything settled cleanly.
 *
 * A source rejection is re-thrown when it left at least one of its tickers
 * absent from `fetched`. Successful prices are already in the module cache at
 * this point, so re-throwing does not lose them.
 */
export function pickFailure(
  yahooRes: PromiseSettledResult<{ prices: { ticker: string }[] }>,
  coingeckoRes: PromiseSettledResult<{ prices: { ticker: string }[] }>,
  yahooTickers: readonly string[],
  coingeckoTickers: readonly string[],
  fetched: ReadonlyMap<string, unknown>,
): unknown {
  if (yahooRes.status === "rejected" && yahooTickers.some((t) => !fetched.has(t))) {
    return yahooRes.reason;
  }
  if (coingeckoRes.status === "rejected" && coingeckoTickers.some((t) => !fetched.has(t))) {
    return coingeckoRes.reason;
  }
  return null;
}

export function usePricesQuery(input: PricesQueryInput): PricesQueryResult {
  const yahooSorted = [...new Set(input.yahooTickers)].sort();
  const coingeckoSorted = [...new Set(input.coingeckoTickers)].sort();
  const enabled = yahooSorted.length > 0 || coingeckoSorted.length > 0;

  const prices = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const previousPrices = useSyncExternalStore(subscribe, getPrevSnapshot, getPrevSnapshot);

  const { isFetching, isError } = useQuery({
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
      const fetchedPrev = new Map<string, Decimal>();
      const ingest = (
        entries: { ticker: string; price: string; previousPrice: string | null }[],
      ) => {
        for (const e of entries) {
          fetched.set(e.ticker, Decimal.fromString(e.price, SCALE_CRYPTO));
          if (e.previousPrice !== null) {
            fetchedPrev.set(e.ticker, Decimal.fromString(e.previousPrice, SCALE_CRYPTO));
          }
        }
      };
      if (yahooRes.status === "fulfilled") ingest(yahooRes.value.prices);
      if (coingeckoRes.status === "fulfilled") ingest(coingeckoRes.value.prices);
      // Commit before any possible throw so successful prices survive in cache.
      commitFetched(fetched, fetchedPrev);
      const err = pickFailure(yahooRes, coingeckoRes, yahooSorted, coingeckoSorted, fetched);
      if (err !== null) throw err;
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
    previousPrices,
    isLoading: isFetching && prices.size === 0,
    isError,
  };
}
