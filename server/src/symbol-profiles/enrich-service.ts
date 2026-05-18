import { logger } from "../core/logger.js";
import * as rateLimit from "./rate-limit.js";
import type { SymbolProfileRepo } from "./repo.js";
import type { FetchLike, LookupResult } from "./types.js";
import { fetchFakeProfiles } from "./upstream-fake.js";
import { fetchYahooProfiles } from "./upstream-yahoo.js";

const USE_FAKE_UPSTREAM = process.env.PRICE_PROVIDER === "fake";
const COOLDOWN_MS = 60_000;

export type EnrichServiceOptions = {
  repo: SymbolProfileRepo;
  fetcher?: FetchLike;
  cooldownMs?: number;
};

/**
 * Force-refresh profiles from upstream regardless of cache age.
 * Subject to per-user cooldown (same 60 s default as prices refresh).
 */
export class EnrichService {
  readonly #repo: SymbolProfileRepo;
  readonly #fetcher: FetchLike;
  readonly #cooldownMs: number;

  constructor({
    repo,
    fetcher = globalThis.fetch,
    cooldownMs = COOLDOWN_MS,
  }: EnrichServiceOptions) {
    this.#repo = repo;
    this.#fetcher = fetcher;
    this.#cooldownMs = cooldownMs;
  }

  /**
   * Throws:
   *  - RateLimitedError if within cooldown window
   *  - UpstreamUnavailableError on network failure or upstream 5xx/429
   */
  async refresh(opts: { userId: string; tickers: string[] }): Promise<LookupResult> {
    const { userId, tickers } = opts;

    // Per-user cooldown gate (throws RateLimitedError if too soon).
    rateLimit.gateRefresh(userId, this.#cooldownMs);

    const upstream = USE_FAKE_UPSTREAM
      ? fetchFakeProfiles(tickers)
      : await fetchYahooProfiles(tickers, this.#fetcher);

    // Consume cooldown only when the user got something back. An empty result
    // is usually a typo, locking them out for 60 s on a fixable mistake is
    // hostile.
    if (upstream.size > 0) {
      rateLimit.recordRefresh(userId, this.#cooldownMs);
      await this.#repo.upsertMany({ profiles: [...upstream.values()] });
    }

    logger.info(
      {
        event: "symbol-profiles.lookup",
        source: "yahoo",
        requested: tickers.length,
        cached: 0,
        fetched: upstream.size,
      },
      "symbol profile refresh completed",
    );

    const profiles = [];
    const unknown = [];
    for (const ticker of tickers) {
      const profile = upstream.get(ticker);
      if (profile !== undefined) {
        profiles.push(profile);
      } else {
        unknown.push(ticker);
      }
    }

    return { profiles, unknown };
  }

  /** Returns ms until the user may refresh again (0 = free to refresh). */
  msUntilNextRefresh(userId: string): number {
    return rateLimit.msUntilNextRefresh(userId, this.#cooldownMs);
  }
}
