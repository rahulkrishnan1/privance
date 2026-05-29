/**
 * Pure helpers backing the dashboard's daily net-worth snapshot effect.
 * Extracted from queries.ts so they can be unit-tested without pulling the
 * sync-context module graph (which uses dynamic imports vitest cannot
 * resolve in jsdom).
 */

import type { computeNetWorth, NetWorthSnapshot, NetWorthSnapshotId } from "@privance/core";
import { splitCashAndInvestments } from "./_math";

/** Today's UTC date in YYYY-MM-DD. */
export function utcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** True when no priced holding is missing a price. `currency_mismatch:*` entries are cross-currency warnings, not missing prices. */
export function isBreakdownPriced(breakdown: ReturnType<typeof computeNetWorth>): boolean {
  return breakdown.unknownTickers.every((t) => t.startsWith("currency_mismatch:"));
}

export type SnapshotAction =
  | { type: "skip" }
  | { type: "create" }
  | { type: "update"; existingId: NetWorthSnapshotId };

/** Decides create / update / skip for today's snapshot. Update heals a row sealed before prices loaded; `alreadyRewroteThisSession` caps that to once per session so intraday drift doesn't churn the row. */
export function nextSnapshotAction(opts: {
  snapshots: NetWorthSnapshot[];
  today: string;
  currentNetWorthCents: string;
  alreadyRewroteThisSession: boolean;
}): SnapshotAction {
  const existing = opts.snapshots.find((s) => s.payload.snapshotAt === opts.today);
  if (existing === undefined) return { type: "create" };
  if (existing.payload.netWorthCents === opts.currentNetWorthCents) return { type: "skip" };
  if (opts.alreadyRewroteThisSession) return { type: "skip" };
  return { type: "update", existingId: existing.id };
}

/** Builds the plaintext payload object for a daily net-worth snapshot. */
export function buildSnapshotPayload(opts: {
  date: string;
  breakdown: ReturnType<typeof computeNetWorth>;
  accountCount: number;
}): {
  snapshotAt: string;
  netWorthCents: string;
  cashCents: string;
  investmentCents: string;
  accountCount: number;
} {
  const { cash, investments } = splitCashAndInvestments(opts.breakdown);
  return {
    snapshotAt: opts.date,
    netWorthCents: opts.breakdown.netWorth.toMinorUnits().toString(),
    cashCents: cash.toMinorUnits().toString(),
    investmentCents: investments.toMinorUnits().toString(),
    accountCount: opts.accountCount,
  };
}
