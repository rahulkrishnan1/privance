"use client";

import type { SymbolProfile } from "@privance/core";
import { useQuery } from "@tanstack/react-query";
import { lookupProfiles } from "@/lib/api/profiles";

export type ProfilesMap = Map<string, SymbolProfile>;

export type ProfilesQueryResult = {
  profiles: ProfilesMap;
  isLoading: boolean;
  isError: boolean;
};

// Symbol metadata (asset class, region, sector) changes rarely; cache for a day.
const STALE_TIME_MS = 24 * 60 * 60 * 1000;
const GC_TIME_MS = 7 * 24 * 60 * 60 * 1000;

// Stable empty fallback, see prices.ts for rationale.
const EMPTY_PROFILES: ProfilesMap = new Map();

/**
 * Look up symbol-profile metadata (assetClass, region, sector, name) for the
 * given tickers. Server returns whatever profiles it already has cached;
 * missing profiles silently drop out (the caller treats them as "Unknown").
 *
 * Used by the dashboard's "By Asset Class" / "By Geography" allocation pies.
 */
export function useProfilesQuery(tickers: string[]): ProfilesQueryResult {
  const sorted = [...new Set(tickers)].sort();
  const enabled = sorted.length > 0;

  const { data, isFetching, isError } = useQuery({
    queryKey: ["symbol-profiles", ...sorted],
    queryFn: async () => {
      const response = await lookupProfiles(sorted);
      const map: ProfilesMap = new Map();
      for (const profile of response.profiles) {
        map.set(profile.ticker, profile);
      }
      return map;
    },
    enabled,
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    refetchOnWindowFocus: false,
    retry: false,
    placeholderData: (prev) => prev,
  });

  return {
    profiles: data ?? EMPTY_PROFILES,
    isLoading: isFetching && data === undefined,
    isError,
  };
}
