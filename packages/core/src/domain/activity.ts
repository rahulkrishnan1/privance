import type { AccountId, ActivityId, HoldingId, IsoDateTime } from "./types.js";

// ---------------------------------------------------------------------------
// ActivityKind: 14-type transaction taxonomy. Schema-only in v1; the UI is
// read-only and activity-driven holdings derivation is a later phase.
// ---------------------------------------------------------------------------

/**
 * The complete activity taxonomy.
 *
 * Side-effect semantics (documented per kind for future activity-driven
 * holdings derivation, v1 schema is stubbed, UI is read-only):
 *
 * - BUY:           decreases cash, increases holding shares + cost basis
 * - SELL:          increases cash, decreases holding shares (realises gain/loss)
 * - SPLIT:         multiplies holding shares by ratio; adjusts cost basis per share
 * - DEPOSIT:       increases cash balance (net contribution)
 * - WITHDRAWAL:    decreases cash balance (net contribution)
 * - TRANSFER_IN:   increases holding shares; moves assets in from external
 * - TRANSFER_OUT:  decreases holding shares; moves assets out to external
 * - DIVIDEND:      increases cash balance; not a net contribution
 * - INTEREST:      increases cash balance; not a net contribution
 * - CREDIT:        increases cash balance; misc credit / rebate
 * - FEE:           decreases cash balance; advisory / platform / custody fee
 * - TAX:           decreases cash balance; withholding or estimated tax payment
 * - ADJUSTMENT:    arbitrary manual correction to cash or holding
 * - UNKNOWN:       imported activity with unrecognised type; treated as no-op
 */
export type ActivityKind =
  | "BUY"
  | "SELL"
  | "SPLIT"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "DIVIDEND"
  | "INTEREST"
  | "CREDIT"
  | "FEE"
  | "TAX"
  | "ADJUSTMENT"
  | "UNKNOWN";

/** All 14 activity kinds in canonical order. */
export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  "BUY",
  "SELL",
  "SPLIT",
  "DEPOSIT",
  "WITHDRAWAL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "DIVIDEND",
  "INTEREST",
  "CREDIT",
  "FEE",
  "TAX",
  "ADJUSTMENT",
  "UNKNOWN",
] as const;

// ---------------------------------------------------------------------------
// Activity, server-side metadata
// ---------------------------------------------------------------------------

/** Server metadata for an activity record. */
export interface ActivityMeta {
  readonly id: ActivityId;
  readonly accountId: AccountId;
  /** The holding this activity affects, if any (null for cash-only activities). */
  readonly holdingId: HoldingId | null;
  readonly kind: ActivityKind;
  readonly settledAt: IsoDateTime;
  readonly createdAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Decrypted payload
// ---------------------------------------------------------------------------

/** Decrypted financial payload for an activity. */
export interface ActivityPayload {
  /** Amount in cents (minor units). Always positive; direction implied by kind. */
  readonly amountCents: string;
  /**
   * Quantity of shares/units (as decimal string) for BUY, SELL, SPLIT,
   * TRANSFER_IN, TRANSFER_OUT. Absent for cash-only activities.
   */
  readonly quantity?: string | undefined;
  /** Price per unit at time of activity (decimal string). */
  readonly pricePerUnit?: string | undefined;
  /** Split ratio numerator (e.g. 2 for a 2-for-1 split). SPLIT only. */
  readonly splitNumerator?: number | undefined;
  /** Split ratio denominator. SPLIT only. */
  readonly splitDenominator?: number | undefined;
  /** Free-text description / memo. */
  readonly description?: string | undefined;
}

/** Fully-decrypted activity record. */
export interface Activity extends ActivityMeta {
  readonly payload: ActivityPayload;
}
