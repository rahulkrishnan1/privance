import type { AccountId, AssetType, IsoDateTime, UserId } from "./types.js";

// Frozen: part of the AEAD AAD, so renaming breaks decryption of existing records.
export const KIND_ACCOUNT = "account" as const;

/** The broad classification of an account. */
export type AccountKind = "cash" | "investment" | "liability" | "manual_asset";

/**
 * Cash account sub-kinds, maps to the name stored in encrypted payload.
 * Server only stores ciphertext; sub-kind is client-only metadata.
 */
export type CashAccountSubKind = "checking" | "savings" | "money_market" | "cd" | "other_cash";

/**
 * Investment account sub-kinds.
 */
export type InvestmentAccountSubKind =
  | "brokerage"
  | "ira"
  | "roth_ira"
  | "401k"
  | "roth_401k"
  | "after_tax_401k"
  | "403b"
  | "sep_solo_401k"
  | "hsa"
  | "529"
  | "crypto_wallet"
  | "other_investment";

/**
 * Liability sub-kinds, represented as positive balances; sign is implied by
 * the kind and applied at net-worth aggregation time.
 */
export type LiabilityAccountSubKind =
  | "mortgage"
  | "auto_loan"
  | "student_loan"
  | "personal_loan"
  | "credit_card"
  | "line_of_credit"
  | "other_debt";

/**
 * Manual asset sub-kinds, non-securities holdings whose value is user-supplied
 * (no price feed). The balance is the user's current estimate of the asset value.
 */
export type ManualAssetSubKind =
  | "real_estate"
  | "vehicle"
  | "collectible"
  | "private_equity"
  | "precious_metal"
  | "other_asset";

/** Fields the server stores for every account row (all plaintext-safe). */
export interface AccountMeta {
  readonly id: AccountId;
  readonly userId: UserId;
  readonly createdAt: IsoDateTime;
  readonly lastUpdatedAt: IsoDateTime;
}

/** Decrypted payload for a cash account. */
export interface CashAccountPayload {
  readonly kind: "cash";
  readonly subKind: CashAccountSubKind;
  readonly name: string;
  readonly institutionName?: string | undefined;
  /** Balance in minor units (cents). Stored as string for JSON safety. */
  readonly balanceCents: string;
  readonly currency: string;
  /** Annual percentage yield as a decimal fraction string (e.g. "0.041" = 4.1%). Feeds the estimated-income calc. */
  readonly apy?: string | undefined;
  readonly notes?: string | undefined;
}

/** Decrypted payload for an investment account. */
export interface InvestmentAccountPayload {
  readonly kind: "investment";
  readonly subKind: InvestmentAccountSubKind;
  readonly name: string;
  readonly institutionName?: string | undefined;
  /** Cash/sweep balance in minor units (cents). */
  readonly cashBalanceCents: string;
  readonly currency: string;
  readonly assetType: AssetType;
  /** Annual percentage yield on the cash sweep as a decimal fraction string (e.g. "0.041" = 4.1%). Feeds the estimated-income calc. */
  readonly apy?: string | undefined;
  readonly notes?: string | undefined;
}

/**
 * Decrypted payload for a liability account.
 * Balance is the *outstanding* debt, stored as a positive value. Net-worth
 * aggregation subtracts liabilities from assets.
 */
export interface LiabilityAccountPayload {
  readonly kind: "liability";
  readonly subKind: LiabilityAccountSubKind;
  readonly name: string;
  readonly institutionName?: string | undefined;
  /** Outstanding balance in minor units (positive). */
  readonly balanceCents: string;
  readonly currency: string;
  /** Optional annual interest rate as a decimal string (e.g. "0.0625" for 6.25%). */
  readonly interestRate?: string | undefined;
  /** Optional remaining term in years as a decimal string (e.g. "22"). Display-only. */
  readonly termYearsRemaining?: string | undefined;
  /** Optional original principal in minor units, useful for amortisation views. */
  readonly originalPrincipalCents?: string | undefined;
  readonly notes?: string | undefined;
}

/**
 * Decrypted payload for a manual asset (non-securities holding).
 * Balance is the user's current valuation estimate; no price feed.
 */
export interface ManualAssetAccountPayload {
  readonly kind: "manual_asset";
  readonly subKind: ManualAssetSubKind;
  readonly name: string;
  /** Optional descriptor (e.g. property address, vehicle VIN). */
  readonly identifier?: string | undefined;
  /** Estimated current value in minor units. */
  readonly valueCents: string;
  readonly currency: string;
  /** Optional acquisition cost basis in minor units. */
  readonly costBasisCents?: string | undefined;
  readonly acquiredAt?: IsoDateTime | undefined;
  /** Date the asset was last valued by the user, as an ISO date string (yyyy-mm-dd). Display-only. */
  readonly valuedAt?: IsoDateTime | undefined;
  readonly notes?: string | undefined;
}

/** A fully-decrypted cash account, as held in client memory. */
export interface CashAccount extends AccountMeta {
  readonly payload: CashAccountPayload;
}

/** A fully-decrypted investment account, as held in client memory. */
export interface InvestmentAccount extends AccountMeta {
  readonly payload: InvestmentAccountPayload;
}

/** A fully-decrypted liability account. */
export interface LiabilityAccount extends AccountMeta {
  readonly payload: LiabilityAccountPayload;
}

/** A fully-decrypted manual asset account. */
export interface ManualAssetAccount extends AccountMeta {
  readonly payload: ManualAssetAccountPayload;
}

/** Discriminated union of all account types. */
export type Account = CashAccount | InvestmentAccount | LiabilityAccount | ManualAssetAccount;
