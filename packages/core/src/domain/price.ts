import type { AssetType, IsoDateTime, PriceId } from "./types.js";

/**
 * The provider that supplied a price record.
 * Designed to be extensible (new sources are additive); do not use exhaustive
 * switches on this type without a default branch.
 */
export type DataSource = "yahoo" | "coingecko" | "manual" | "proxy" | "unknown";

/** Static metadata about a financial instrument. */
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
  /** GICS-style sector classification (e.g. "Technology", "Healthcare").
   *  Populated for individual equities; funds carry `sectorWeightings` instead. */
  readonly sector?: string | undefined;
  /** For funds (ETF / mutual fund): sector composition by weight, each fraction
   *  in [0,1]. Lets a fund's value be split across sectors for allocation views. */
  readonly sectorWeightings?:
    | ReadonlyArray<{ readonly sector: string; readonly weight: number }>
    | undefined;
  /** Sub-sector or industry (e.g. "Software Application", "Biotech"). */
  readonly industry?: string | undefined;
  /** Forward/trailing annual dividend yield as a decimal string (e.g. "0.0137" for 1.37%). */
  readonly dividendYield?: string | undefined;
  /** Yahoo fund category name (e.g. "Intermediate-Term Bond", "Large Blend"). */
  readonly fundCategory?: string | undefined;
  /** ISO 3166-1 alpha-2 country code of issuer / domicile (e.g. "US", "DE"). */
  readonly country?: string | undefined;
  /** Coarser region grouping (e.g. "North America", "Emerging Markets"). */
  readonly region?: string | undefined;
  /** Reporting currency the instrument is denominated in (e.g. "USD", "EUR"). */
  readonly currency?: string | undefined;
  /** Primary exchange MIC (e.g. "XNAS", "XNYS"). */
  readonly exchange?: string | undefined;
}

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
