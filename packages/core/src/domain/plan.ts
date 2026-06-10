import type { IsoDateTime, PlanId, UserId } from "./types.js";

/**
 * KIND_PLAN is the encrypted-record kind string for the FIRE plan.
 * Frozen like HKDF labels: bumping this value is a migration, not a code change.
 */
export const KIND_PLAN = "plan" as const;

/**
 * Deterministic singleton objectId for the plan record. All devices write this
 * same id so LWW conflict handling converges to one row per user.
 */
export const PLAN_OBJECT_ID = "plan-singleton" as const;

/** Sync-row metadata, only fields the server stores in plaintext. */
export interface PlanMeta {
  readonly id: PlanId;
  readonly userId: UserId;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** Preset allocation ids. "custom" unlocks the override fields. */
export type PlanPreset = "conservative" | "balanced" | "aggressive" | "custom";

/** Base payload fields present for every preset. */
interface PlanPayloadBase {
  readonly schemaVersion: 1;
  readonly currentAge: number;
  readonly planUntilAge: number;
  /** Monthly contribution in cents as a decimal string. */
  readonly monthlyContributionCents: string;
  /** Annual retirement spend in cents as a decimal string. */
  readonly annualSpendCents: string;
  /** Safe withdrawal rate in basis points (e.g. 400 = 4%). */
  readonly swrBps: number;
  /** PRNG seed for the Monte Carlo run, stored as a hex string (16 random bytes, 32 hex chars). Any non-empty string is accepted for forward compatibility with other seed encodings. */
  readonly seed: string;
}

/** Payload when using a named preset. */
export interface PlanPayloadPreset extends PlanPayloadBase {
  readonly preset: Exclude<PlanPreset, "custom">;
}

/** Payload when using custom overrides. */
export interface PlanPayloadCustom extends PlanPayloadBase {
  readonly preset: "custom";
  /** Expected annual real return in basis points. */
  readonly muBps: number;
  /** Annual return standard deviation in basis points. */
  readonly sigmaBps: number;
  /** Stock allocation weight in basis points (e.g. 6000 = 60%). */
  readonly stockWeightBps: number;
}

/**
 * Decrypted FIRE plan payload. The server stores this as opaque ciphertext;
 * every field below lives only in the encrypted blob.
 */
export type PlanPayload = PlanPayloadPreset | PlanPayloadCustom;

/** Fully-decrypted FIRE plan record. */
export interface Plan extends PlanMeta {
  readonly payload: PlanPayload;
}
