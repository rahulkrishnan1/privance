import { logger } from "../core/logger.js";
import * as rateLimit from "./rate-limit.js";
import type { DataSource, FetchLike, RefreshResult } from "./types.js";
import { InvalidSourceError } from "./types.js";
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

export type PriceServiceOptions = {
  fetcher?: FetchLike;
  cooldownMs?: number;
};

export class PriceService {
  readonly #fetcher: FetchLike;
  readonly #cooldownMs: number;

  constructor({ fetcher = globalThis.fetch, cooldownMs = COOLDOWN_MS }: PriceServiceOptions = {}) {
    this.#fetcher = fetcher;
    this.#cooldownMs = EFFECTIVE_COOLDOWN_MS ?? cooldownMs;
  }

  /**
   * Gate, fetch upstream, record cooldown. Throws:
   *  - RateLimitedError if within cooldown window
   *  - InvalidSourceError if source is not recognised
   *  - UpstreamUnavailableError on network failure or upstream 5xx/429
   */
  async refresh(input: {
    userId: string;
    tickers: string[];
    source: string;
  }): Promise<RefreshResult> {
    const { userId, tickers, source } = input;

    // Validate source before gating so we don't consume a cooldown slot.
    if (source !== "yahoo" && source !== "coingecko") {
      throw new InvalidSourceError(source);
    }
    const dataSource: DataSource = source;

    // Per-user cooldown gate (throws RateLimitedError if too soon).
    rateLimit.gateRefresh(userId, this.#cooldownMs);

    const upstream = USE_FAKE_UPSTREAM
      ? fetchFakePrices(tickers)
      : dataSource === "yahoo"
        ? await fetchYahooPrices(tickers, this.#fetcher)
        : await fetchCoinGeckoPrices(tickers, this.#fetcher);

    // Consume cooldown only when the user got something back. An empty
    // result is usually a bad ticker, locking them out for 60 s on a fixable
    // typo is hostile.
    if (upstream.size > 0) {
      rateLimit.recordRefresh(userId, this.#cooldownMs);
    }

    logger.info(
      {
        event: "prices.refresh",
        source: dataSource,
        requested: tickers.length,
        fetched: upstream.size,
      },
      "price refresh completed",
    );

    const prices = [];
    const unknown = [];

    for (const ticker of tickers) {
      const entry = upstream.get(ticker);
      if (entry !== undefined) {
        prices.push({ ticker, price: entry.price, fetchedAt: entry.fetchedAt });
      } else {
        unknown.push(ticker);
      }
    }

    return { prices, unknown };
  }

  /** Returns ms until the user may refresh again (0 = free to refresh). */
  msUntilNextRefresh(userId: string): number {
    return rateLimit.msUntilNextRefresh(userId, this.#cooldownMs);
  }
}
