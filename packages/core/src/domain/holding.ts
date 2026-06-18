import type {
  AccountId,
  AssetType,
  HoldingGroupId,
  HoldingId,
  IsoDateTime,
  UserId,
} from "./types.js";

// Frozen: part of the AEAD AAD, so renaming breaks decryption of existing records.
export const KIND_HOLDING = "holding" as const;
export const KIND_HOLDING_GROUP = "holding_group" as const;

/** Server-side metadata for a holding group. */
export interface HoldingGroupMeta {
  readonly id: HoldingGroupId;
  readonly userId: UserId;
  readonly createdAt: IsoDateTime;
}

/** Decrypted payload for a holding group. */
export interface HoldingGroupPayload {
  readonly name: string;
  readonly notes?: string | undefined;
}

/** Fully-decrypted holding group. */
export interface HoldingGroup extends HoldingGroupMeta {
  readonly payload: HoldingGroupPayload;
}

/** Sync-row metadata, only fields the server stores in plaintext. */
export interface HoldingMeta {
  readonly id: HoldingId;
  readonly userId: UserId;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/**
 * Decrypted holding payload. The server stores this as opaque ciphertext;
 * every field below lives only in the encrypted blob.
 */
export interface HoldingPayload {
  readonly accountId: AccountId;
  readonly groupId: HoldingGroupId | null;
  /** Primary ticker, used for price fetching. */
  readonly ticker: string;
  readonly assetType: AssetType;
  /**
   * Optional proxy ticker: price for an unfetchable asset (e.g., a 401(k) CIT)
   * is fetched using this ticker and then scaled by `scaleFactor`.
   */
  readonly proxyTicker: string | null;
  readonly name?: string | undefined;
  /** Number of shares/units in minor units at `sharesScale`. */
  readonly sharesMajor: string;
  /** Decimal scale for shares (typically 8 for crypto, 4 for stocks). */
  readonly sharesScale: number;
  /** Total cost basis in cents (minor units). */
  readonly costBasisCents: string;
  /**
   * Scale factor for proxy-priced assets. The price of `proxyTicker` is
   * multiplied by this value (expressed as a decimal string) to get the
   * actual price of the holding.
   */
  readonly scaleFactor?: string | undefined;
  /** ISO date when scaleFactor was last anchored (set or re-anchored). */
  readonly proxyAnchoredAt?: string | undefined;
  readonly notes?: string | undefined;
}

/** Fully-decrypted holding record. */
export interface Holding extends HoldingMeta {
  readonly payload: HoldingPayload;
}
