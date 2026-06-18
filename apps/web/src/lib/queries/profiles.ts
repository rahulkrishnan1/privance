"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
  type LookupProfilesResponse,
  lookupProfiles,
  type SymbolProfileEntry,
} from "@/lib/api/symbol-profiles";

export type ProfilesMap = Map<string, SymbolProfileEntry>;

export type ProfilesQueryResult = {
  profilesByTicker: ProfilesMap;
  isLoading: boolean;
};

// Resolved profiles are static reference data, so the cache lives long and the
// upstream is not re-hit on navigation. But when a lookup leaves any ticker
// unresolved (a transient upstream failure), keep the result stale within the
// hour so the unknown is retried soon instead of being pinned for a full day.
const STALE_TIME_RESOLVED_MS = 24 * 60 * 60 * 1000;
const STALE_TIME_UNRESOLVED_MS = 60 * 60 * 1000;
const GC_TIME_MS = 48 * 60 * 60 * 1000;

export function profileStaleTime(data: LookupProfilesResponse | undefined): number {
  return data && data.unknown.length > 0 ? STALE_TIME_UNRESOLVED_MS : STALE_TIME_RESOLVED_MS;
}

// Module-level profile cache, shared across every consumer of
// useSymbolProfilesQuery. Keeps resolved names on screen across component
// unmounts (navigation) and across query-key changes from add/delete.
const cache = new Map<string, SymbolProfileEntry>();
const listeners = new Set<() => void>();
let snapshot: ProfilesMap = cache;

function notify(): void {
  snapshot = new Map(cache);
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): ProfilesMap {
  return snapshot;
}

function commitFetched(profiles: readonly SymbolProfileEntry[]): void {
  let changed = false;
  for (const p of profiles) {
    if (cache.get(p.ticker) !== p) {
      cache.set(p.ticker, p);
      changed = true;
    }
  }
  if (changed) notify();
}

/** Drop all cached profiles. Called on auth transitions (logout, login)
 *  alongside resetPricesCache so a new user does not see the previous user's
 *  resolved names. */
export function resetProfilesCache(): void {
  if (cache.size === 0) return;
  cache.clear();
  notify();
}

export function useSymbolProfilesQuery(tickers: string[]): ProfilesQueryResult {
  const sorted = [...new Set(tickers)].sort();
  const enabled = sorted.length > 0;

  const profilesByTicker = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const { isFetching } = useQuery({
    queryKey: ["symbol-profiles", ...sorted],
    queryFn: async () => {
      const result = await lookupProfiles(sorted);
      commitFetched(result.profiles);
      return result;
    },
    enabled,
    staleTime: (query) => profileStaleTime(query.state.data),
    gcTime: GC_TIME_MS,
    retry: false,
  });

  return {
    profilesByTicker,
    isLoading: isFetching && profilesByTicker.size === 0,
  };
}
