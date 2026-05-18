import type { AccountKind } from "@privance/core";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schema for the add/edit form
// ---------------------------------------------------------------------------

export const accountKindValues: [AccountKind, ...AccountKind[]] = [
  "cash",
  "investment",
  "liability",
  "manual_asset",
];

export const accountFormSchema = z.object({
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
});

export type AccountFormValues = z.infer<typeof accountFormSchema>;

// ---------------------------------------------------------------------------
// Kind display metadata
// ---------------------------------------------------------------------------

export type KindMeta = {
  label: string;
  /** Label used on the section "add" ghost button. */
  addLabel: string;
};

export const KIND_META: Record<AccountKind, KindMeta> = {
  cash: { label: "Cash", addLabel: "Add cash account" },
  investment: { label: "Investment", addLabel: "Add investment account" },
  manual_asset: { label: "Manual Asset", addLabel: "Add manual asset" },
  liability: { label: "Liability", addLabel: "Add liability account" },
};

/** The display order of sections on the accounts screen. */
export const SECTION_ORDER: AccountKind[] = ["cash", "investment", "manual_asset", "liability"];
