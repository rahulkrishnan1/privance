import type { IsoDate, IsoDateTime, NetWorthSnapshotId, UserId } from "./types.js";

/** Sync-row metadata, only fields the server stores in plaintext. */
export interface NetWorthSnapshotMeta {
  readonly id: NetWorthSnapshotId;
  readonly userId: UserId;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/**
 * Decrypted net-worth snapshot payload. The server stores this as opaque
 * ciphertext; every field below lives only in the encrypted blob.
 */
export interface NetWorthSnapshotPayload {
  /** ISO date string (YYYY-MM-DD), the day this snapshot covers. */
  readonly snapshotAt: IsoDate;
  /** Total net worth in cents (minor units). */
  readonly netWorthCents: string;
  /** Total cash across all cash accounts, in cents. */
  readonly cashCents: string;
  /** Total investment value (holdings at market price), in cents. */
  readonly investmentCents: string;
  /** Count of accounts included in this snapshot. */
  readonly accountCount: number;
}

/** Fully-decrypted net-worth snapshot. */
export interface NetWorthSnapshot extends NetWorthSnapshotMeta {
  readonly payload: NetWorthSnapshotPayload;
}
