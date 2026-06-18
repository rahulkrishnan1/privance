import { z } from "zod";
import { BILLING_UNITS, SPEND_CATEGORIES, SPEND_GROUPS, SPEND_STATUSES } from "./spend.js";

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

// Sign checks stay lexical for the same reason as isValidDecimalString:
// no Number coercion on money strings, and no scale assumption.
function hasNonzeroDigit(s: string): boolean {
  return /[1-9]/.test(s);
}
function isPositiveDecimalString(s: string): boolean {
  const t = s.trim();
  return !t.startsWith("-") && hasNonzeroDigit(t);
}
function isNonNegativeDecimalString(s: string): boolean {
  const t = s.trim();
  return !t.startsWith("-") || !hasNonzeroDigit(t);
}

// Cents fields in the plan payload are always integer (whole cents). A fractional
// string like "2000.50" would cause BigInt() to throw in sim-input.ts, so we
// reject it here at validation time.
const INTEGER_STRING_RE = /^-?\d+$/;
function isIntegerString(s: string): boolean {
  return INTEGER_STRING_RE.test(s.trim());
}
const nonNegativeIntegerCentsString = z
  .string()
  .refine(isIntegerString, { message: "Must be a whole-number string (no decimal point)" })
  .refine((s) => isNonNegativeDecimalString(s), {
    message: "Must be 0 or greater",
  });

export const CashAccountPayloadSchema = z.object({
  kind: z.literal("cash"),
  subKind: z.enum(["checking", "savings", "money_market", "cd", "other_cash"]),
  name: z.string(),
  institutionName: z.string().optional(),
  balanceCents: decimalString,
  currency: z.string(),
  apy: decimalString.optional(),
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
    "after_tax_401k",
    "403b",
    "sep_solo_401k",
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
  apy: decimalString.optional(),
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
  termYearsRemaining: decimalString.optional(),
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
  valuedAt: z.string().optional(),
  notes: z.string().optional(),
});

export const AccountPayloadSchema = z.discriminatedUnion("kind", [
  CashAccountPayloadSchema,
  InvestmentAccountPayloadSchema,
  LiabilityAccountPayloadSchema,
  ManualAssetAccountPayloadSchema,
]);

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

export const SpendItemPayloadSchema = z.object({
  name: z.string().min(1).max(64),
  // Per-cycle amount in whole cents; must be a positive integer string.
  amountCents: nonNegativeIntegerCentsString.refine(isPositiveDecimalString, {
    message: "Amount must be greater than 0",
  }),
  intervalCount: z.number().int().min(1).max(99),
  intervalUnit: z.enum(BILLING_UNITS),
  category: z.enum(SPEND_CATEGORIES),
  group: z.enum(SPEND_GROUPS),
  nextRenewalAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z.enum(SPEND_STATUSES),
  notes: z.string().optional(),
});

export const NetWorthSnapshotPayloadSchema = z.object({
  snapshotAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date YYYY-MM-DD"),
  netWorthCents: decimalString,
  cashCents: decimalString,
  investmentCents: decimalString,
});

const planPayloadBase = z.object({
  // v1 records (no manualStartingPotCents) and v2 records both parse.
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  currentAge: z.number().int().min(16).max(100),
  planUntilAge: z.number().int().max(110),
  monthlyContributionCents: nonNegativeIntegerCentsString,
  annualSpendCents: nonNegativeIntegerCentsString,
  manualStartingPotCents: nonNegativeIntegerCentsString.optional(),
  swrBps: z.number().int().min(50).max(1000),
  // seed is a PRNG seed string, not a monetary value; accept any non-empty string
  // so that both hex and decimal seeds (from different generator versions) parse.
  seed: z.string().min(1),
});

const planPayloadCustom = planPayloadBase.extend({
  preset: z.literal("custom"),
  muBps: z.number().int().min(-500).max(1500),
  sigmaBps: z.number().int().min(100).max(4000),
  stockWeightBps: z.number().int().min(0).max(10000),
});

export const PlanPayloadSchema = z
  .discriminatedUnion("preset", [
    planPayloadBase.extend({ preset: z.literal("conservative") }),
    planPayloadBase.extend({ preset: z.literal("balanced") }),
    planPayloadBase.extend({ preset: z.literal("aggressive") }),
    planPayloadCustom,
  ])
  .refine((v) => v.planUntilAge > v.currentAge, {
    message: "planUntilAge must be greater than currentAge",
    path: ["planUntilAge"],
  })
  .refine((v) => isPositiveDecimalString(v.annualSpendCents), {
    message: "annualSpendCents must be greater than 0",
    path: ["annualSpendCents"],
  })
  .refine((v) => isNonNegativeDecimalString(v.monthlyContributionCents), {
    message: "monthlyContributionCents must be 0 or greater",
    path: ["monthlyContributionCents"],
  });
