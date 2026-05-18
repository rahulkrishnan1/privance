import { logger } from "../core/logger.js";
import { regionFromCountry } from "./_region.js";
import type { SymbolProfileRepo } from "./repo.js";
import type { FetchLike, LookupResult, SymbolProfile } from "./types.js";
import { fetchFakeProfiles } from "./upstream-fake.js";
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

export type LookupServiceOptions = {
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

    // Phase 1: DB hit.
    const cached = await this.#repo.getMany({ tickers });
    const cacheMisses = tickers.filter((t) => !cached.has(t));

    let fetched = 0;
    if (cacheMisses.length > 0) {
      // Phase 2: upstream fetch for misses only.
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
