import { Decimal, SCALE_CENTS } from "../decimal/index.js";
import type { Holding, HoldingGroup, SymbolProfile } from "../domain/index.js";
import { holdingMarketValue } from "./compute.js";
import type { AllocationSlice } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildSlices(buckets: Map<string, Decimal>, total: Decimal): AllocationSlice[] {
  const slices: AllocationSlice[] = [];
  const totalFloat = total.toFloat();

  for (const [label, value] of buckets) {
    const share = total.isZero() ? 0 : value.toFloat() / totalFloat;
    slices.push({ label, value, share });
  }

  slices.sort((a, b) => b.value.cmp(a.value));
  return slices;
}

/**
 * Build a label → accumulated-value map from holdings, using a key function
 * that derives the allocation label from a holding's SymbolProfile.
 * Holdings with no label from the key function fall into "Unknown".
 *
 * O(n), computes each holding's market value once and accumulates both the
 * per-bucket total and the grand total in the same pass.
 */
function groupHoldingsByLabel(
  holdings: Holding[],
  prices: Map<string, Decimal>,
  keyFn: (profile: SymbolProfile | undefined) => string | undefined,
  profiles: Map<string, SymbolProfile> | undefined,
): { buckets: Map<string, Decimal>; total: Decimal } {
  const buckets = new Map<string, Decimal>();
  let total = Decimal.zero(SCALE_CENTS);

  for (const holding of holdings) {
    const { value } = holdingMarketValue(holding, prices);
    total = total.add(value);

    const profile = profiles?.get(holding.payload.ticker);
    const label = keyFn(profile) ?? "Unknown";
    const existing = buckets.get(label) ?? Decimal.zero(SCALE_CENTS);
    buckets.set(label, existing.add(value));
  }

  return { buckets, total };
}

// ---------------------------------------------------------------------------
// Public allocation views
// ---------------------------------------------------------------------------

/**
 * Allocation breakdown by asset class (e.g. "equity", "etf", "fixed_income").
 * Requires symbolProfiles to be meaningful; falls back to "Unknown" when absent.
 */
export function allocationByAssetClass(
  holdings: Holding[],
  prices: Map<string, Decimal>,
  profiles?: Map<string, SymbolProfile> | undefined,
): AllocationSlice[] {
  const { buckets, total } = groupHoldingsByLabel(holdings, prices, (p) => p?.assetClass, profiles);
  return buildSlices(buckets, total);
}

/**
 * Allocation breakdown by GICS-style sector (e.g. "Technology", "Healthcare").
 */
export function allocationBySector(
  holdings: Holding[],
  prices: Map<string, Decimal>,
  profiles?: Map<string, SymbolProfile> | undefined,
): AllocationSlice[] {
  const { buckets, total } = groupHoldingsByLabel(holdings, prices, (p) => p?.sector, profiles);
  return buildSlices(buckets, total);
}

/**
 * Allocation breakdown by country (ISO 3166-1 alpha-2, e.g. "US", "DE").
 */
export function allocationByCountry(
  holdings: Holding[],
  prices: Map<string, Decimal>,
  profiles?: Map<string, SymbolProfile> | undefined,
): AllocationSlice[] {
  const { buckets, total } = groupHoldingsByLabel(holdings, prices, (p) => p?.country, profiles);
  return buildSlices(buckets, total);
}

/**
 * Allocation breakdown by region (e.g. "North America", "Emerging Markets").
 */
export function allocationByRegion(
  holdings: Holding[],
  prices: Map<string, Decimal>,
  profiles?: Map<string, SymbolProfile> | undefined,
): AllocationSlice[] {
  const { buckets, total } = groupHoldingsByLabel(holdings, prices, (p) => p?.region, profiles);
  return buildSlices(buckets, total);
}

/**
 * Allocation breakdown by user-defined HoldingGroup.
 * Holdings with no group (groupId === null) fall into "Ungrouped".
 */
export function allocationByGroup(
  holdings: Holding[],
  prices: Map<string, Decimal>,
  groups: HoldingGroup[],
): AllocationSlice[] {
  const groupById = new Map<string, string>(groups.map((g) => [g.id, g.payload.name]));

  const buckets = new Map<string, Decimal>();
  let total = Decimal.zero(SCALE_CENTS);

  for (const holding of holdings) {
    const { value } = holdingMarketValue(holding, prices);
    total = total.add(value);

    const label =
      holding.payload.groupId !== null
        ? (groupById.get(holding.payload.groupId) ?? "Unknown")
        : "Ungrouped";
    const existing = buckets.get(label) ?? Decimal.zero(SCALE_CENTS);
    buckets.set(label, existing.add(value));
  }

  return buildSlices(buckets, total);
}
