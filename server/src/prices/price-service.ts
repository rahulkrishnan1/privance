import { logger } from "../core/logger.js";
import * as rateLimit from "./rate-limit.js";
import type { CachedPriceRow } from "./repo.js";
import type { DataSource, FetchLike, PriceEntry, RefreshResult } from "./types.js";
import { InvalidSourceError, UpstreamUnavailableError } from "./types.js";
import { fetchCoinGeckoPrices } from "./upstream-coingecko.js";
import { fetchFakePrices } from "./upstream-fake.js";
import { fetchYahooPrices } from "./upstream-yahoo.js";

const USE_FAKE_UPSTREAM = process.env.PRICE_PROVIDER === "fake";

// Fake upstream is for E2E + dev. The cooldown is a rate-limit against the
// real Yahoo / CoinGecko free tier, so it has no purpose in fake mode and
// would otherwise cause back-to-back tests to 429 each other through the
// shared E2E user.
const EFFECTIVE_COOLDOWN_MS = USE_FAKE_UPSTREAM ? 0 : null;

const COOLDOWN_MS = 30_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

type PricesRepoShape = {
  getMany(opts: { source: string; tickers: string[] }): Promise<CachedPriceRow[]>;
  upsertMany(rows: CachedPriceRow[]): Promise<void>;
};

export type PriceServiceOptions = {
  pricesRepo: PricesRepoShape;
  fetcher?: FetchLike;
  cooldownMs?: number;
};

export class PriceService {
  readonly #pricesRepo: PricesRepoShape;
  readonly #fetcher: FetchLike;
  readonly #cooldownMs: number;

  constructor({
    pricesRepo,
    fetcher = globalThis.fetch,
    cooldownMs = COOLDOWN_MS,
  }: PriceServiceOptions) {
    this.#pricesRepo = pricesRepo;
    this.#fetcher = fetcher;
    this.#cooldownMs = EFFECTIVE_COOLDOWN_MS ?? cooldownMs;
  }

  async refresh(input: {
    userId: string;
    tickers: string[];
    source: string;
  }): Promise<RefreshResult> {
    const { userId, tickers, source } = input;

    if (source !== "yahoo" && source !== "coingecko") {
      throw new InvalidSourceError(source);
    }
    const dataSource: DataSource = source;

    const now = Date.now();
    const cached = await this.#pricesRepo.getMany({ source: dataSource, tickers });

    const freshCached = cached.filter((r) => now - r.fetchedAt.getTime() < CACHE_TTL_MS);
    const freshMap = new Map(freshCached.map((r) => [r.ticker, r]));
    const needFetch = tickers.filter((t) => !freshMap.has(t));

    if (needFetch.length === 0) {
      return {
        prices: freshCached.map((r) => ({
          ticker: r.ticker,
          price: r.price,
          fetchedAt: r.fetchedAt.toISOString(),
        })),
        unknown: [],
      };
    }

    rateLimit.gateRefresh(userId, this.#cooldownMs);

    let upstream: Map<string, { price: string; fetchedAt: string }>;
    let upstreamFailed = false;

    try {
      upstream = USE_FAKE_UPSTREAM
        ? fetchFakePrices(needFetch)
        : dataSource === "yahoo"
          ? await fetchYahooPrices(needFetch, this.#fetcher)
          : await fetchCoinGeckoPrices(needFetch, this.#fetcher);
    } catch (err) {
      if (err instanceof UpstreamUnavailableError) {
        upstream = new Map();
        upstreamFailed = true;
      } else {
        throw err;
      }
    }

    const gotSomething = upstream.size > 0;

    if (gotSomething) {
      const newRows = [...upstream.entries()].map(([ticker, entry]) => ({
        source: dataSource,
        ticker,
        price: entry.price,
        fetchedAt: new Date(entry.fetchedAt),
      }));
      await this.#pricesRepo.upsertMany(newRows);
      rateLimit.recordRefresh(userId, this.#cooldownMs);
    }

    logger.info(
      {
        event: "prices.refresh",
        source: dataSource,
        requested: tickers.length,
        fetched: upstream.size,
        cacheHits: freshCached.length,
        upstreamFailed,
      },
      "price refresh completed",
    );

    // Build stale fallback map for tickers that need it (upstream failed or returned nothing).
    const staleByTicker = new Map(
      cached.filter((r) => !freshMap.has(r.ticker)).map((r) => [r.ticker, r]),
    );

    const prices: PriceEntry[] = [];
    const unknown: string[] = [];

    for (const ticker of tickers) {
      const freshRow = freshMap.get(ticker);
      if (freshRow !== undefined) {
        prices.push({ ticker, price: freshRow.price, fetchedAt: freshRow.fetchedAt.toISOString() });
      } else {
        const upstreamEntry = upstream.get(ticker);
        if (upstreamEntry !== undefined) {
          prices.push({ ticker, price: upstreamEntry.price, fetchedAt: upstreamEntry.fetchedAt });
        } else {
          const stale = staleByTicker.get(ticker);
          if (stale !== undefined) {
            prices.push({ ticker, price: stale.price, fetchedAt: stale.fetchedAt.toISOString() });
          } else {
            unknown.push(ticker);
          }
        }
      }
    }

    return { prices, unknown };
  }

  /** Returns ms until the user may refresh again (0 = free to refresh). */
  msUntilNextRefresh(userId: string): number {
    return rateLimit.msUntilNextRefresh(userId, this.#cooldownMs);
  }
}
