import type { Decimal } from "@privance/core";
import { formatCurrency, formatCurrencyWhole } from "@/lib/format";
import type { LocalSpendItem } from "../types";
import { nextBillDate } from "./_spend-math";

export function formatSpendAmount(value: Decimal): string {
  return value.toMinorUnits() % 100n === 0n ? formatCurrencyWhole(value) : formatCurrency(value);
}

export function formatSpendDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function spendScheduleLine(item: LocalSpendItem, now: Date): string {
  if (item.status === "paused") return "resumes when you do";
  if (!item.nextRenewalAt) return "";
  const verb = item.group === "essentials" ? "due" : "renews";
  const next = nextBillDate(item.nextRenewalAt, item.intervalCount, item.intervalUnit, now);
  return `${verb} ${formatSpendDate(next)}`;
}
