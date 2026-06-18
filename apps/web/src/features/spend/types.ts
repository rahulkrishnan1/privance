import type { BillingUnit, SpendCategory, SpendGroup, SpendStatus } from "@privance/core";
import { BILLING_UNITS, KIND_SPEND_ITEM, SPEND_CATEGORIES, SPEND_GROUPS } from "@privance/core";
import { z } from "zod";

export const KIND_SPEND = KIND_SPEND_ITEM;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Lexical positive check: no Number coercion on the money string. The regex
// already constrains the shape, so we only need to reject a zero value.
function isPositiveAmount(s: string): boolean {
  return /[1-9]/.test(s);
}

// Plain boolean predicates (not type guards) so the inferred form type stays
// `string` and the placeholder "" can be the default.
const isBillingUnit = (s: string): boolean => (BILLING_UNITS as readonly string[]).includes(s);
const isSpendCategory = (s: string): boolean => (SPEND_CATEGORIES as readonly string[]).includes(s);

// Form fields are strings so inputs and select placeholders edit freely; the
// mutation layer coerces the validated values to their domain types.
export const spendFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(64, "Name must be 64 characters or fewer"),
  amount: z.string().superRefine((s, ctx) => {
    const t = s.trim();
    if (!t) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount is required" });
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(t)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid amount (e.g. 15.49)" });
      return;
    }
    if (!isPositiveAmount(t)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount must be greater than zero" });
    }
  }),
  intervalCount: z.string().superRefine((s, ctx) => {
    const t = s.trim();
    if (!/^\d+$/.test(t)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a whole number" });
      return;
    }
    const n = Number(t);
    if (n < 1 || n > 99) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be 1 to 99" });
    }
  }),
  intervalUnit: z.string().refine(isBillingUnit, { message: "Select a cadence" }),
  category: z.string().refine(isSpendCategory, { message: "Select a category" }),
  group: z.enum(SPEND_GROUPS),
  // Native date input yields "" or "YYYY-MM-DD"; "" becomes undefined at the
  // mutation boundary.
  nextRenewalAt: z
    .string()
    .refine((s) => s === "" || ISO_DATE_RE.test(s), { message: "Enter a valid date" })
    .optional(),
  status: z.enum(["active", "paused"]).default("active"),
});

export type SpendFormValues = z.infer<typeof spendFormSchema>;

export type LocalSpendItem = {
  id: string;
  name: string;
  amountCents: string;
  intervalCount: number;
  intervalUnit: BillingUnit;
  category: SpendCategory;
  group: SpendGroup;
  nextRenewalAt: string | undefined;
  status: SpendStatus;
  updatedAt: number;
};
