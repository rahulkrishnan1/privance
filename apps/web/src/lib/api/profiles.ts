import type { SymbolProfile } from "@privance/core";
import { apiFetch } from "./client";

// ---------------------------------------------------------------------------
// Wire types, mirror server/src/symbol-profiles/wire.ts exactly
// ---------------------------------------------------------------------------

export type LookupProfilesRequest = {
  tickers: string[];
};

export type LookupProfilesResponse = {
  profiles: SymbolProfile[];
  unknown: string[];
};

export type RefreshProfilesRequest = {
  tickers: string[];
};

export type RefreshProfilesResponse = {
  profiles: SymbolProfile[];
  unknown: string[];
};

// ---------------------------------------------------------------------------
// Typed wrappers
// ---------------------------------------------------------------------------

export async function lookupProfiles(tickers: string[]): Promise<LookupProfilesResponse> {
  const res = await apiFetch("/api/symbol-profiles/lookup", {
    method: "POST",
    body: JSON.stringify({ tickers } satisfies LookupProfilesRequest),
  });
  return res.json() as Promise<LookupProfilesResponse>;
}

export async function refreshProfile(tickers: string[]): Promise<RefreshProfilesResponse> {
  const res = await apiFetch("/api/symbol-profiles/refresh", {
    method: "POST",
    body: JSON.stringify({ tickers } satisfies RefreshProfilesRequest),
  });
  return res.json() as Promise<RefreshProfilesResponse>;
}
