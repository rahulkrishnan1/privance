/**
 * Pure helpers backing the dashboard's daily net-worth snapshot effect.
 * Extracted from queries.ts so they can be unit-tested without pulling the
 * sync-context module graph (which uses dynamic imports vitest cannot
 * resolve in jsdom).
 */

import type { computeNetWorth, NetWorthSnapshot } from "@privance/core";
import { splitCashAndInvestments } from "./_math";

/** Today's UTC date in YYYY-MM-DD. */
export function utcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** True when no snapshot exists for `date` yet. */
export function shouldWriteSnapshot(snapshots: NetWorthSnapshot[], date: string): boolean {
  return !snapshots.some((s) => s.payload.snapshotAt === date);
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
