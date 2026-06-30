import { logger } from "../core/logger.js";
import { regionFromCountry } from "./_region.js";
import type { SymbolProfileRepo } from "./repo.js";
import type { FetchLike, LookupResult, SymbolProfile } from "./types.js";
import { UpstreamUnavailableError } from "./types.js";
import { fetchFakeProfiles } from "./upstream-fake.js";
import { fetchFinnhubProfiles } from "./upstream-finnhub.js";
import { fetchYahooProfiles } from "./upstream-yahoo.js";

const USE_FAKE_UPSTREAM = process.env.PRICE_PROVIDER === "fake";

/**
 * Older cached profiles were stored with `region: undefined`. Derive it from
 * `country` at the read boundary so legacy rows don't need a backfill migration
 * to populate the dashboard's geography pie. Idempotent: profiles already
 * carrying a region pass through unchanged.
 */
function fillRegion(profile: SymbolProfile): SymbolProfile {
  if (profile.region !== undefined) return profile;
  const region = regionFromCountry(profile.country);
  if (region === undefined) return profile;
  return { ...profile, region };
}

type LookupServiceOptions = {
  repo: SymbolProfileRepo;
  fetcher?: FetchLike;
};

/**
 * Read-through cache: DB hit → return immediately; cache miss → fetch upstream,
 * insert into DB, return. Tickers unknown to both DB and upstream land in `unknown`.
 */
export class LookupService {
  readonly #repo: SymbolProfileRepo;
  readonly #fetcher: FetchLike;

  constructor({ repo, fetcher = globalThis.fetch }: LookupServiceOptions) {
    this.#repo = repo;
    this.#fetcher = fetcher;
  }

  async lookup(opts: { tickers: string[] }): Promise<LookupResult> {
    const { tickers } = opts;
    if (tickers.length === 0) return { profiles: [], unknown: [] };

    const cached = await this.#repo.getMany({ tickers });
    const cacheMisses = tickers.filter((t) => !cached.has(t));

    let fetched = 0;
    if (cacheMisses.length > 0) {
      const upstream = USE_FAKE_UPSTREAM
        ? fetchFakeProfiles(cacheMisses)
        : await fetchYahooProfiles(cacheMisses, this.#fetcher);
      fetched = upstream.size;

      if (upstream.size > 0) {
        await this.#repo.upsertMany({ profiles: [...upstream.values()] });
        for (const [ticker, profile] of upstream) {
          cached.set(ticker, profile);
        }
      }

      // Best-effort failover to fill cache misses Yahoo left unresolved; a Finnhub
      // failure is swallowed so those tickers stay unknown.
      const finnhubApiKey = process.env.FINNHUB_API_KEY?.trim() || undefined;
      if (!USE_FAKE_UPSTREAM && finnhubApiKey !== undefined) {
        const stillMissing = cacheMisses.filter((t) => !cached.has(t));
        if (stillMissing.length > 0) {
          try {
            const finnhub = await fetchFinnhubProfiles(stillMissing, finnhubApiKey, this.#fetcher);
            if (finnhub.size > 0) {
              await this.#repo.upsertMany({ profiles: [...finnhub.values()] });
              for (const [ticker, profile] of finnhub) {
                cached.set(ticker, profile);
              }
              fetched += finnhub.size;
            }
          } catch (err) {
            if (!(err instanceof UpstreamUnavailableError)) throw err;
          }
        }
      }
    }

    logger.info(
      {
        event: "symbol-profiles.lookup",
        source: "yahoo",
        requested: tickers.length,
        cached: tickers.length - cacheMisses.length,
        fetched,
      },
      "symbol profile lookup completed",
    );

    const profiles = [];
    const unknown = [];
    for (const ticker of tickers) {
      const profile = cached.get(ticker);
      if (profile !== undefined) {
        profiles.push(fillRegion(profile));
      } else {
        unknown.push(ticker);
      }
    }

    return { profiles, unknown };
  }
}
