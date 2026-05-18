import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared refinements
// ---------------------------------------------------------------------------

/**
 * Validates the lexical shape of a decimal string. The actual storage scale
 * lives on a sibling field (e.g. `sharesScale` for `sharesMajor`), so we don't
 * enforce scale here, `Decimal.fromString(s)` defaults to SCALE_CENTS and
 * would reject perfectly valid values like "1.234" shares or "1.005" scale
 * factors. Use a generous parse-scale just to confirm the digits are sane.
 */
const DECIMAL_STRING_RE = /^-?\d+(\.\d+)?$/;
function isValidDecimalString(s: string): boolean {
  return DECIMAL_STRING_RE.test(s.trim());
}

const decimalString = z.string().refine(isValidDecimalString, {
  message: "Must be a valid decimal string",
});

// ---------------------------------------------------------------------------
// Account payload schemas
// ---------------------------------------------------------------------------

export const CashAccountPayloadSchema = z.object({
  kind: z.literal("cash"),
  subKind: z.enum(["checking", "savings", "money_market", "cd", "other_cash"]),
  name: z.string(),
  institutionName: z.string().optional(),
  balanceCents: decimalString,
  currency: z.string(),
  notes: z.string().optional(),
});

export const InvestmentAccountPayloadSchema = z.object({
  kind: z.literal("investment"),
  subKind: z.enum([
    "brokerage",
    "ira",
    "roth_ira",
    "401k",
    "roth_401k",
    "403b",
    "hsa",
    "529",
    "crypto_wallet",
    "other_investment",
  ]),
  name: z.string(),
  institutionName: z.string().optional(),
  cashBalanceCents: decimalString,
  currency: z.string(),
  assetType: z.string(),
  notes: z.string().optional(),
});

export const LiabilityAccountPayloadSchema = z.object({
  kind: z.literal("liability"),
  subKind: z.enum([
    "mortgage",
    "auto_loan",
    "student_loan",
    "personal_loan",
    "credit_card",
    "line_of_credit",
    "other_debt",
  ]),
  name: z.string(),
  institutionName: z.string().optional(),
  balanceCents: decimalString,
  currency: z.string(),
  interestRate: decimalString.optional(),
  originalPrincipalCents: decimalString.optional(),
  notes: z.string().optional(),
});

export const ManualAssetAccountPayloadSchema = z.object({
  kind: z.literal("manual_asset"),
  subKind: z.enum([
    "real_estate",
    "vehicle",
    "collectible",
    "private_equity",
    "precious_metal",
    "other_asset",
  ]),
  name: z.string(),
  identifier: z.string().optional(),
  valueCents: decimalString,
  currency: z.string(),
  costBasisCents: decimalString.optional(),
  acquiredAt: z.string().optional(),
  notes: z.string().optional(),
});

export const AccountPayloadSchema = z.discriminatedUnion("kind", [
  CashAccountPayloadSchema,
  InvestmentAccountPayloadSchema,
  LiabilityAccountPayloadSchema,
  ManualAssetAccountPayloadSchema,
]);

// ---------------------------------------------------------------------------
// Holding payload schemas
// ---------------------------------------------------------------------------

export const HoldingPayloadSchema = z.object({
  accountId: z.string(),
  groupId: z.string().nullable(),
  ticker: z.string(),
  assetType: z.enum(["stock", "crypto"]),
  proxyTicker: z.string().nullable(),
  name: z.string().optional(),
  sharesMajor: decimalString,
  sharesScale: z.number().int().nonnegative(),
  costBasisCents: decimalString,
  scaleFactor: decimalString.optional(),
  proxyAnchoredAt: z.string().optional(),
  notes: z.string().optional(),
});

export const HoldingGroupPayloadSchema = z.object({
  name: z.string(),
  notes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Net-worth snapshot payload schema
// ---------------------------------------------------------------------------

export const NetWorthSnapshotPayloadSchema = z.object({
  snapshotAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date YYYY-MM-DD"),
  netWorthCents: decimalString,
  cashCents: decimalString,
  investmentCents: decimalString,
  accountCount: z.number().int().nonnegative(),
});
