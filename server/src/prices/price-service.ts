import { logger } from "../core/logger.js";
import * as rateLimit from "./rate-limit.js";
import type { CachedPriceRow } from "./repo.js";
import type { DataSource, FetchLike, PriceEntry, RefreshResult } from "./types.js";
import { InvalidSourceError, UpstreamUnavailableError } from "./types.js";
import { fetchCoinGeckoPrices } from "./upstream-coingecko.js";
import { fetchFakePrices } from "./upstream-fake.js";
import { fetchFinnhubPrices } from "./upstream-finnhub.js";
import { fetchYahooPrices } from "./upstream-yahoo.js";

const USE_FAKE_UPSTREAM = process.env.PRICE_PROVIDER === "fake";

// Fake upstream is for E2E + dev. The cooldown is a rate-limit against the
// real Yahoo / CoinGecko free tier, so it has no purpose in fake mode and
// would otherwise cause back-to-back tests to 429 each other through the
// shared E2E user.
const EFFECTIVE_COOLDOWN_MS = USE_FAKE_UPSTREAM ? 0 : null;

const COOLDOWN_MS = 30_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

type PricesRepoLike = {
  getMany(opts: { source: string; tickers: string[] }): Promise<CachedPriceRow[]>;
  upsertMany(rows: CachedPriceRow[]): Promise<void>;
};

type PriceServiceOptions = {
  pricesRepo: PricesRepoLike;
  fetcher?: FetchLike;
  cooldownMs?: number;
};

export class PriceService {
  readonly #pricesRepo: PricesRepoLike;
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
          previousPrice: r.previousPrice,
          fetchedAt: r.fetchedAt.toISOString(),
        })),
        unknown: [],
      };
    }

    let upstream: Map<string, { price: string; previousPrice: string | null; fetchedAt: string }> =
      new Map();
    let upstreamFailed = false;
    let finnhubUsed = false;

    // Cooldown gates the upstream call, not the cache: when cooling, serve cached rows below.
    const inCooldown = rateLimit.msUntilNextRefresh(userId, dataSource, this.#cooldownMs) > 0;
    if (!inCooldown) {
      // Start the cooldown on attempt so a failing upstream can't be hammered.
      rateLimit.recordRefresh(userId, dataSource, this.#cooldownMs);
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

      // Yahoo-only, best-effort failover to fill tickers Yahoo missed; a Finnhub
      // failure is swallowed so they fall through to the stale-cache / unknown path.
      const finnhubApiKey = process.env.FINNHUB_API_KEY?.trim() || undefined;
      if (!USE_FAKE_UPSTREAM && dataSource === "yahoo" && finnhubApiKey !== undefined) {
        const stillMissing = needFetch.filter((t) => !upstream.has(t));
        if (stillMissing.length > 0) {
          try {
            const finnhub = await fetchFinnhubPrices(stillMissing, finnhubApiKey, this.#fetcher);
            for (const [ticker, entry] of finnhub) {
              upstream.set(ticker, entry);
            }
            if (finnhub.size > 0) finnhubUsed = true;
          } catch (err) {
            if (!(err instanceof UpstreamUnavailableError)) throw err;
          }
        }
      }
    }

    if (upstream.size > 0) {
      const newRows = [...upstream.entries()].map(([ticker, entry]) => ({
        source: dataSource,
        ticker,
        price: entry.price,
        previousPrice: entry.previousPrice,
        fetchedAt: new Date(entry.fetchedAt),
      }));
      await this.#pricesRepo.upsertMany(newRows);
    }

    logger.info(
      {
        event: "prices.refresh",
        source: dataSource,
        requested: tickers.length,
        fetched: upstream.size,
        cacheHits: freshCached.length,
        skippedUpstream: inCooldown,
        upstreamFailed,
        finnhubUsed,
      },
      "price refresh completed",
    );

    const staleByTicker = new Map(
      cached.filter((r) => !freshMap.has(r.ticker)).map((r) => [r.ticker, r]),
    );

    const prices: PriceEntry[] = [];
    const unknown: string[] = [];

    for (const ticker of tickers) {
      const freshRow = freshMap.get(ticker);
      if (freshRow !== undefined) {
        prices.push({
          ticker,
          price: freshRow.price,
          previousPrice: freshRow.previousPrice,
          fetchedAt: freshRow.fetchedAt.toISOString(),
        });
      } else {
        const upstreamEntry = upstream.get(ticker);
        if (upstreamEntry !== undefined) {
          prices.push({
            ticker,
            price: upstreamEntry.price,
            previousPrice: upstreamEntry.previousPrice,
            fetchedAt: upstreamEntry.fetchedAt,
          });
        } else {
          const stale = staleByTicker.get(ticker);
          if (stale !== undefined) {
            prices.push({
              ticker,
              price: stale.price,
              previousPrice: stale.previousPrice,
              fetchedAt: stale.fetchedAt.toISOString(),
            });
          } else {
            unknown.push(ticker);
          }
        }
      }
    }

    return { prices, unknown };
  }

  // Longer of the two per-source windows; the button drives both sources.
  msUntilNextRefresh(userId: string): number {
    return Math.max(
      rateLimit.msUntilNextRefresh(userId, "yahoo", this.#cooldownMs),
      rateLimit.msUntilNextRefresh(userId, "coingecko", this.#cooldownMs),
    );
  }
}
