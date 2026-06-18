import { z } from "zod";
import { apiFetch, parseJson } from "./client";

// Wire schemas -- mirror server/src/symbol-profiles/wire.ts exactly.

const SymbolProfileEntrySchema = z.object({
  ticker: z.string(),
  assetType: z.enum(["stock", "crypto"]),
  displayName: z.string().optional(),
  assetClass: z.string().optional(),
  assetSubClass: z.string().optional(),
  sector: z.string().optional(),
  /** For funds: sector composition by weight (fractions in [0,1]). */
  sectorWeightings: z.array(z.object({ sector: z.string(), weight: z.number() })).optional(),
  industry: z.string().optional(),
  dividendYield: z.string().optional(),
  fundCategory: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  currency: z.string().optional(),
  exchange: z.string().optional(),
});
export type SymbolProfileEntry = z.infer<typeof SymbolProfileEntrySchema>;

const LookupProfilesResponseSchema = z.object({
  profiles: z.array(SymbolProfileEntrySchema),
  unknown: z.array(z.string()),
});
export type LookupProfilesResponse = z.infer<typeof LookupProfilesResponseSchema>;

export async function lookupProfiles(tickers: string[]): Promise<LookupProfilesResponse> {
  if (tickers.length === 0) return { profiles: [], unknown: [] };
  const res = await apiFetch("/api/symbol-profiles/lookup", {
    method: "POST",
    body: JSON.stringify({ tickers }),
  });
  return parseJson(res, LookupProfilesResponseSchema);
}
