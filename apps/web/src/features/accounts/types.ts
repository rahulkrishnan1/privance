import type { AccountKind, CashAccountSubKind } from "@privance/core";
import { z } from "zod";

const accountKindValues: [AccountKind, ...AccountKind[]] = [
  "cash",
  "investment",
  "liability",
  "manual_asset",
];

export const accountFormSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(64, "Name must be 64 characters or fewer"),
    kind: z.enum(accountKindValues),
    currency: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code"),
    balance: z
      .string()
      // Blank balance == 0; users adding a fresh account shouldn't have to type "0".
      .transform((s) => (s.trim() === "" ? "0" : s.trim()))
      .refine(
        (s) => {
          const unsigned = s.startsWith("-") ? s.slice(1) : s;
          return /^\d+(\.\d{1,2})?$/.test(unsigned);
        },
        { message: "Invalid amount" },
      ),
    subKind: z
      .enum([
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
        "checking",
        "savings",
        "money_market",
        "cd",
        "other_cash",
      ])
      .optional(),
    /** APY as typed by the user (percent string, e.g. "4.10"). Converted to fraction on submit. */
    apy: z.string().optional(),
    /** Interest rate as typed by the user (percent string, e.g. "6.25"). Converted to fraction on submit. */
    interestRate: z.string().optional(),
    /** Remaining term in years as typed by the user (e.g. "22"). */
    termYears: z.string().optional(),
    /** Date the asset was last valued (ISO yyyy-mm-dd). */
    valuedAt: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    // Cash and investment accounts must pick a type; the placeholder starts blank.
    if ((values.kind === "cash" || values.kind === "investment") && !values.subKind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subKind"],
        message: "Select an account type",
      });
    }
  });

export type AccountFormValues = z.infer<typeof accountFormSchema>;

/** The cash subKind value typed for use in the form. */
export type CashSubKindValue = CashAccountSubKind;

/** The display order of sections: investments first, then cash, assets, liabilities. */
export const SECTION_ORDER: AccountKind[] = ["investment", "cash", "manual_asset", "liability"];
