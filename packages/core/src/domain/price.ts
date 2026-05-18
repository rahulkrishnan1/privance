import type { AssetType, IsoDateTime, PriceId } from "./types.js";

// ---------------------------------------------------------------------------
// DataSource, mirrors v0's "source" column on price_snapshots
// ---------------------------------------------------------------------------

/**
 * The provider that supplied a price record.
 * Designed to be extensible (new sources are additive); do not use exhaustive
 * switches on this type without a default branch.
 */
export type DataSource = "yahoo" | "coingecko" | "manual" | "proxy" | "unknown";

// ---------------------------------------------------------------------------
// SymbolProfile, instrument metadata (independent of per-user holdings)
// ---------------------------------------------------------------------------

/**
 * Static metadata about a financial instrument.
 * Corresponds to the v0 SymbolProfile concept (ticker, identifiers, class).
 */
export interface SymbolProfile {
  readonly ticker: string;
  readonly assetType: AssetType;
  /** FIGI identifier, if available. */
  readonly figi?: string | undefined;
  /** CUSIP identifier, if available. */
  readonly cusip?: string | undefined;
  /** ISIN identifier, if available. */
  readonly isin?: string | undefined;
  /** Human-readable name (e.g. "Apple Inc."). */
  readonly displayName?: string | undefined;
  /** Asset class (e.g. "equity", "etf", "mutual_fund", "fixed_income"). */
  readonly assetClass?: string | undefined;
  /** Asset sub-class (e.g. "large_cap_growth", "index"). */
  readonly assetSubClass?: string | undefined;
  /** GICS-style sector classification (e.g. "Technology", "Healthcare"). */
  readonly sector?: string | undefined;
  /** Sub-sector or industry (e.g. "Software Application", "Biotech"). */
  readonly industry?: string | undefined;
  /** ISO 3166-1 alpha-2 country code of issuer / domicile (e.g. "US", "DE"). */
  readonly country?: string | undefined;
  /** Coarser region grouping (e.g. "North America", "Emerging Markets"). */
  readonly region?: string | undefined;
  /** Reporting currency the instrument is denominated in (e.g. "USD", "EUR"). */
  readonly currency?: string | undefined;
  /** Primary exchange MIC (e.g. "XNAS", "XNYS"). */
  readonly exchange?: string | undefined;
}

// ---------------------------------------------------------------------------
// Price, a single price record for a ticker at a point in time
// ---------------------------------------------------------------------------

/**
 * A price snapshot for a single ticker.
 * Price is stored as a string (decimal, 6 decimal places) to avoid
 * floating-point serialisation issues.
 */
export interface Price {
  readonly id: PriceId;
  readonly ticker: string;
  readonly assetType: AssetType;
  /**
   * Price in major units with up to 6 decimal places (e.g. "123.456789").
   * Use `Decimal.fromString(price, SCALE_CRYPTO)` for arithmetic.
   */
  readonly price: string;
  readonly fetchedAt: IsoDateTime;
  readonly source: DataSource;
}
