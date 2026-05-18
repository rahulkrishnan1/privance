import { Decimal, SCALE_CRYPTO } from "@privance/core";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod helpers for Decimal-safe fields
//
// We parse at SCALE_CRYPTO (8 dp) so fractional shares, mutual-fund NAVs and
// crypto-style precision all validate. The submission layer converts to the
// storage scale it actually needs (cents for cost basis, etc.).
// ---------------------------------------------------------------------------

function fractionDigits(s: string): number {
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

function decimalPositiveCapped(maxFractionDigits: number, fieldLabel: string) {
  return z.string().superRefine((s, ctx) => {
    const t = s.trim();
    if (!t) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldLabel} is required` });
      return;
    }
    if (fractionDigits(t) > maxFractionDigits) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldLabel} can have at most ${maxFractionDigits} decimal places`,
      });
      return;
    }
    try {
      const d = Decimal.fromString(t, SCALE_CRYPTO);
      if (d.isNegative() || d.isZero()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldLabel} must be greater than zero`,
        });
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldLabel} must be a number` });
    }
  });
}

function decimalNonNegativeCapped(maxFractionDigits: number, fieldLabel: string) {
  return z.string().superRefine((s, ctx) => {
    const t = s.trim();
    if (!t) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldLabel} is required` });
      return;
    }
    if (fractionDigits(t) > maxFractionDigits) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldLabel} can have at most ${maxFractionDigits} decimal places`,
      });
      return;
    }
    try {
      const d = Decimal.fromString(t, SCALE_CRYPTO);
      if (d.isNegative()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldLabel} cannot be negative`,
        });
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldLabel} must be a number` });
    }
  });
}

// Ticker validation accepts both stock symbols (uppercase: AAPL, VOO, BRK.B)
// and CoinGecko slugs (lowercase: bitcoin, ethereum). The submit handler
// normalizes case per assetType.
const tickerField = z
  .string()
  .min(1, "Ticker is required")
  .max(64, "Ticker must be 64 characters or fewer")
  .regex(/^[A-Za-z0-9.-]+$/, "Ticker may only contain letters, digits, dots, or dashes");

// ---------------------------------------------------------------------------
// Holding form schema
// ---------------------------------------------------------------------------

export const holdingFormSchema = z.object({
  assetType: z.enum(["stock", "crypto"]),
  ticker: tickerField,
  accountId: z.string().min(1, "Account is required"),
  shares: decimalPositiveCapped(4, "Shares"),
  avgCostPerShare: decimalNonNegativeCapped(2, "Avg cost per share"),
  proxyTicker: z
    .string()
    .max(16, "Proxy ticker must be 16 characters or fewer")
    .regex(/^([A-Za-z0-9.-]+)?$/, "Proxy ticker may only contain letters, digits, dots, or dashes")
    .optional()
    .transform((s) => (s?.trim() ? s.trim().toUpperCase() : undefined)),
  nav: z
    .string()
    .optional()
    .superRefine((s, ctx) => {
      if (s === undefined || s.trim() === "") return;
      const t = s.trim();
      if (fractionDigits(t) > 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Current price can have at most 2 decimal places",
        });
        return;
      }
      try {
        const d = Decimal.fromString(t, SCALE_CRYPTO);
        if (d.isNegative() || d.isZero()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Current price must be greater than zero",
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Current price must be a number",
        });
      }
    }),
  groupId: z.string().optional(),
});

export type HoldingFormValues = {
  assetType: "stock" | "crypto";
  ticker: string;
  accountId: string;
  shares: string;
  avgCostPerShare: string;
  proxyTicker?: string | undefined;
  /** Current price per share of the real asset, used to anchor a proxy holding. */
  nav?: string | undefined;
  groupId?: string | undefined;
};

// ---------------------------------------------------------------------------
// Group form schema
// ---------------------------------------------------------------------------

export const groupFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(64, "Name must be 64 characters or fewer"),
});

export type GroupFormValues = z.infer<typeof groupFormSchema>;

// ---------------------------------------------------------------------------
// Local model, fully decrypted holding record held in React state
// ---------------------------------------------------------------------------

export type LocalHolding = {
  id: string;
  accountId: string;
  groupId: string | null;
  ticker: string;
  assetType: "stock" | "crypto";
  proxyTicker: string | null;
  sharesMajor: string;
  sharesScale: number;
  costBasisCents: string;
  scaleFactor: string | undefined;
  proxyAnchoredAt: string | undefined;
  name: string | undefined;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Local model, fully decrypted holding group held in React state
// ---------------------------------------------------------------------------

export type LocalGroup = {
  id: string;
  name: string;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Sort state
// ---------------------------------------------------------------------------

export const SORT_COLUMNS = [
  "ticker",
  "account",
  "shares",
  "avgCost",
  "currentPrice",
  "marketValue",
  "gainDollar",
  "gainPct",
] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export type SortState = {
  column: SortColumn;
  direction: SortDirection;
};

export const DEFAULT_SORT: SortState = { column: "marketValue", direction: "desc" };

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

export type FilterState =
  | { kind: "all" }
  | { kind: "account"; accountId: string }
  | { kind: "group"; groupId: string };

// Storage object kind constants
export const KIND_HOLDING = "holding" as const;
export const KIND_GROUP = "holding_group" as const;
