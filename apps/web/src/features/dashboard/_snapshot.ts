/** Pure helpers for the dashboard's daily net-worth snapshot effect. */

import type { computeNetWorth, NetWorthSnapshot, NetWorthSnapshotId } from "@privance/core";
import { asId } from "@privance/core";
import { splitCashAndInvestments } from "./_math";

type Breakdown = ReturnType<typeof computeNetWorth>;

/** Today's UTC date in YYYY-MM-DD. */
export function utcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Deterministic objectId for a daily snapshot. Same UTC date returns the same
 * id, so concurrent writes from multiple devices collide on a single row via
 * `ON CONFLICT (kind, object_id) DO UPDATE` instead of producing duplicates.
 */
export function snapshotObjectId(date: string): NetWorthSnapshotId {
  return asId<NetWorthSnapshotId>(`snap-${date}`);
}

/** True when every holding's price is loaded. `currency_mismatch:*` entries are cross-currency warnings, not missing prices. */
export function isBreakdownPriced(breakdown: Breakdown): boolean {
  return breakdown.unknownTickers.every((t) => t.startsWith("currency_mismatch:"));
}

/**
 * Structural signal that today's existing snapshot row was sealed before
 * prices loaded: zero investment cents while the current breakdown reports
 * priced holdings. Robust to cash or sweep changes between seal and heal,
 * which a `cash + investment === pre-prices total` fingerprint is not.
 */
export function existingSnapshotLooksUnpriced(
  existing: NetWorthSnapshot,
  breakdown: Breakdown,
): boolean {
  return existing.payload.investmentCents === "0" && breakdown.byHolding.length > 0;
}

type SnapshotAction =
  | { type: "skip" }
  | { type: "create" }
  | { type: "update"; existingId: NetWorthSnapshotId };

/** Decides create / update / skip for today's snapshot. Update only fires when the existing row carries the structural signal of an unpriced seal (zero investment cents while priced holdings are present, see `existingSnapshotLooksUnpriced`). `alreadyRewroteThisSession` caps the heal to once per session. */
export function nextSnapshotAction(opts: {
  snapshots: NetWorthSnapshot[];
  today: string;
  currentNetWorthCents: string;
  existingLooksUnpriced: boolean;
  alreadyRewroteThisSession: boolean;
}): SnapshotAction {
  const existing = opts.snapshots.find((s) => s.payload.snapshotAt === opts.today);
  if (existing === undefined) return { type: "create" };
  if (existing.payload.netWorthCents === opts.currentNetWorthCents) return { type: "skip" };
  if (!opts.existingLooksUnpriced) return { type: "skip" };
  if (opts.alreadyRewroteThisSession) return { type: "skip" };
  return { type: "update", existingId: existing.id };
}

/** Builds the plaintext payload object for a daily net-worth snapshot. */
export function buildSnapshotPayload(opts: { date: string; breakdown: Breakdown }): {
  snapshotAt: string;
  netWorthCents: string;
  cashCents: string;
  investmentCents: string;
} {
  const { cash, investments } = splitCashAndInvestments(opts.breakdown);
  return {
    snapshotAt: opts.date,
    netWorthCents: opts.breakdown.netWorth.toMinorUnits().toString(),
    cashCents: cash.toMinorUnits().toString(),
    investmentCents: investments.toMinorUnits().toString(),
  };
}
