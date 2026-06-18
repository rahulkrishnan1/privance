import type { Decimal } from "../decimal/index.js";
import type {
  Account,
  AccountId,
  AccountKind,
  Holding,
  HoldingGroup,
  HoldingId,
  SymbolProfile,
} from "../domain/index.js";

export interface NetWorthInput {
  /** All user accounts (cash / investment / liability / manual_asset). */
  accounts: Account[];
  /** All investment holdings. */
  holdings: Holding[];
  /**
   * ticker → current price in major units (e.g. Decimal("123.45")).
   * Missing tickers are treated as unknown (contribute $0, surfaced in
   * `unknownTickers`).
   */
  prices: Map<string, Decimal>;
  /** Optional instrument metadata, needed for allocation views. */
  symbolProfiles?: Map<string, SymbolProfile> | undefined;
  /** Optional user-defined groups, needed for by-group rollup. */
  groups?: HoldingGroup[] | undefined;
  /** Epoch ms stamped onto the breakdown; supplied by the caller so the
   *  function stays pure. */
  asOf: number;
}

export interface HoldingValuation {
  readonly holdingId: HoldingId;
  /** Market value in cents. */
  readonly marketValue: Decimal;
  /** Cost basis in cents. */
  readonly costBasis: Decimal;
  /** marketValue - costBasis (can be negative). */
  readonly unrealizedPnl: Decimal;
}

export interface AccountValuation {
  readonly accountId: AccountId;
  /** Total value of this account in cents. */
  readonly value: Decimal;
  readonly kind: AccountKind;
}

export interface NetWorthBreakdown {
  /** Cash + investments (cash sweep + holdings at market) + manual_asset values. */
  readonly totalAssets: Decimal;
  /** Sum of liability account balances. */
  readonly totalLiabilities: Decimal;
  /** totalAssets - totalLiabilities. */
  readonly netWorth: Decimal;
  readonly byAccountKind: {
    readonly cash: Decimal;
    /** Cash sweep in investment accounts + holdings at market. */
    readonly investment: Decimal;
    readonly liability: Decimal;
    readonly manualAsset: Decimal;
  };
  readonly byAccount: readonly AccountValuation[];
  readonly byHolding: readonly HoldingValuation[];
  /**
   * Tickers (primary or proxy) with no price entry, those holdings
   * contributed $0 to totals.  Also contains "currency_mismatch:<accountId>"
   * for any account whose currency differs from the primary currency.
   */
  readonly unknownTickers: readonly string[];
  /** ms epoch when the breakdown was computed. */
  readonly asOf: number;
}

export interface AllocationSlice {
  /** Human-readable label (asset class, sector, country, region, or group name). */
  readonly label: string;
  /** Absolute value of this slice in cents. */
  readonly value: Decimal;
  /** Fractional share in [0, 1] of total investment value. Float because two
   *  cents-scale Decimals divide to only whole-percent precision. */
  readonly share: number;
}
