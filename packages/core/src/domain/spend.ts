import type { IsoDateTime, SpendItemId, UserId } from "./types.js";

/**
 * Storage object kind. Frozen once any record is written: the string becomes
 * part of the AEAD AAD, so renaming it would make every existing ciphertext
 * undecryptable. Same constraint as "holding", "account", "plan".
 */
export const KIND_SPEND_ITEM = "spend_item" as const;

// Single source of truth for the spend enums: the union types and the Zod
// schemas (schemas.ts) both derive from these tuples, so a new value is added
// in exactly one place.

/**
 * Billing cadence unit. Paired with `intervalCount` (e.g. count 2 + unit
 * "year" = every two years), this expresses any period without a fixed list.
 */
export const BILLING_UNITS = ["day", "week", "month", "year"] as const;
export type BillingUnit = (typeof BILLING_UNITS)[number];

/** Fixed bundled glyph set; no brand logos. */
export const SPEND_CATEGORIES = [
  "housing",
  "utilities",
  "phone",
  "insurance",
  "health",
  "transport",
  "food",
  "streaming",
  "music",
  "software",
  "cloud_storage",
  "news",
  "fitness",
  "shopping",
  "education",
  "gaming",
  "other",
] as const;
export type SpendCategory = (typeof SPEND_CATEGORIES)[number];

/**
 * Which panel an item lives in. User-chosen (defaulted from the category at the
 * form layer), not derived, so e.g. a restaurant can sit under either panel.
 */
export const SPEND_GROUPS = ["essentials", "subscriptions"] as const;
export type SpendGroup = (typeof SPEND_GROUPS)[number];

/** Paused items remain listed but are excluded from totals. */
export const SPEND_STATUSES = ["active", "paused"] as const;
export type SpendStatus = (typeof SPEND_STATUSES)[number];

/** Server-side metadata, the only fields the server stores in plaintext. */
export interface SpendItemMeta {
  readonly id: SpendItemId;
  readonly userId: UserId;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/**
 * Decrypted spend-item payload. The server stores this as opaque ciphertext;
 * every field below lives only in the encrypted blob.
 */
export interface SpendItemPayload {
  /** User-visible label, e.g. "Rent", "Netflix". Max 64 chars at the form layer. */
  readonly name: string;
  /**
   * Per-cycle amount actually billed, in minor units (whole cents) as an
   * integer decimal string, e.g. "154900" for $1,549.00. Never the monthly
   * equivalent; the monthly-equivalent math lives in the web layer.
   */
  readonly amountCents: string;
  /** How many `intervalUnit`s between charges; >= 1 (e.g. 2 + "year"). */
  readonly intervalCount: number;
  readonly intervalUnit: BillingUnit;
  readonly category: SpendCategory;
  readonly group: SpendGroup;
  /**
   * Next charge date as `YYYY-MM-DD`, optional. Display only ("renews May 1");
   * parsed at local midnight, never used for cadence math.
   */
  readonly nextRenewalAt?: string | undefined;
  readonly status: SpendStatus;
  readonly notes?: string | undefined;
}

/** Fully-decrypted spend item, as held in client memory. */
export interface SpendItem extends SpendItemMeta {
  readonly payload: SpendItemPayload;
}
