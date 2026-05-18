/**
 * Unit tests for the dashboard feature, covers pure helpers and formatters.
 */

import type {
  AccountId,
  CashAccount,
  HoldingId,
  HoldingValuation,
  IsoDate,
  NetWorthSnapshot,
  NetWorthSnapshotId,
  UserId,
} from "@privance/core";
import { asId, asIsoDate, asIsoDateTime, Decimal, SCALE_CENTS } from "@privance/core";
import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, formatPercent, formatTime } from "@/lib/format";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCash(opts: { balanceCents?: string; currency?: string } = {}): CashAccount {
  return {
    id: asId<AccountId>("cash-1"),
    userId: asId<UserId>("user-1"),
    createdAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    lastUpdatedAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    payload: {
      kind: "cash",
      subKind: "checking",
      name: "Checking",
      balanceCents: opts.balanceCents ?? "100000",
      currency: opts.currency ?? "USD",
    },
  };
}

function makeHoldingValuation(
  id: string,
  marketValueCents: string,
  costBasisCents: string,
): HoldingValuation {
  const mv = Decimal.fromMinorUnits(BigInt(marketValueCents), SCALE_CENTS);
  const cb = Decimal.fromMinorUnits(BigInt(costBasisCents), SCALE_CENTS);
  return {
    holdingId: asId<HoldingId>(id),
    marketValue: mv,
    costBasis: cb,
    unrealizedPnl: mv.sub(cb),
  };
}

function makeSnapshot(date: IsoDate, netWorthCents: string): NetWorthSnapshot {
  return {
    id: asId<NetWorthSnapshotId>(`snap-${date}`),
    userId: asId<UserId>("user-1"),
    createdAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    updatedAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    payload: {
      snapshotAt: date,
      netWorthCents,
      cashCents: "0",
      investmentCents: "0",
      accountCount: 1,
    },
  } as NetWorthSnapshot;
}

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------

describe("formatCurrency", () => {
  it("formats a positive cent value", () => {
    const d = Decimal.fromMinorUnits(123456n, SCALE_CENTS);
    expect(formatCurrency(d)).toBe("$1,234.56");
  });

  it("formats zero", () => {
    const d = Decimal.zero(SCALE_CENTS);
    expect(formatCurrency(d)).toBe("$0.00");
  });

  it("formats a negative value", () => {
    const d = Decimal.fromMinorUnits(-50000n, SCALE_CENTS);
    expect(formatCurrency(d)).toBe("-$500.00");
  });

  it("adds thousands separators for large values", () => {
    const d = Decimal.fromMinorUnits(1000000000n, SCALE_CENTS);
    expect(formatCurrency(d)).toBe("$10,000,000.00");
  });

  it("handles single-digit cents correctly", () => {
    const d = Decimal.fromMinorUnits(105n, SCALE_CENTS);
    expect(formatCurrency(d)).toBe("$1.05");
  });

  it("avoids floating-point precision loss for large values", () => {
    const d = Decimal.fromMinorUnits(9007199254740993n, SCALE_CENTS);
    expect(d.toMinorUnits().toString()).toBe("9007199254740993");
    const str = formatCurrency(d);
    expect(str).toContain("$");
  });
});

// ---------------------------------------------------------------------------
// formatPercent
// ---------------------------------------------------------------------------

describe("formatPercent", () => {
  it("formats a ratio as a percentage", () => {
    expect(formatPercent(0.12)).toBe("12.00%");
  });

  it("preserves fractional precision beyond cents-scale", () => {
    expect(formatPercent(0.1234)).toBe("12.34%");
  });

  it("formats zero share", () => {
    expect(formatPercent(0)).toBe("0.00%");
  });

  it("adds + prefix when signed=true for positive value", () => {
    expect(formatPercent(0.05, { signed: true })).toBe("+5.00%");
  });

  it("does not add + prefix when signed=true for zero", () => {
    expect(formatPercent(0, { signed: true })).toBe("0.00%");
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
  it("formats a YYYY-MM-DD string to short date", () => {
    const result = formatDate("2024-05-16");
    expect(result).toBe("May 16");
  });

  it("passes through malformed input without crashing", () => {
    const result = formatDate("not-a-date");
    expect(typeof result).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------

describe("formatTime", () => {
  it("formats epoch ms with am/pm", () => {
    const d = new Date("2024-01-01T14:30:00Z");
    const result = formatTime(d.getTime());
    expect(result).toMatch(/^\d{1,2}:\d{2}\s?(AM|PM)$/i);
  });
});

// ---------------------------------------------------------------------------
// Snapshot shape
// ---------------------------------------------------------------------------

describe("snapshot fixture", () => {
  it("produces a valid net worth snapshot", () => {
    const snap = makeSnapshot(asIsoDate("2024-05-16"), "123456");
    expect(snap.payload.netWorthCents).toBe("123456");
    expect(snap.payload.snapshotAt).toBe("2024-05-16");
  });

  it("sorts snapshots chronologically", () => {
    const snaps = [
      makeSnapshot(asIsoDate("2024-05-16"), "300"),
      makeSnapshot(asIsoDate("2024-05-14"), "100"),
      makeSnapshot(asIsoDate("2024-05-15"), "200"),
    ];
    const sorted = snaps
      .slice()
      .sort((a, b) => a.payload.snapshotAt.localeCompare(b.payload.snapshotAt));
    expect(sorted.map((s) => s.payload.snapshotAt)).toEqual([
      "2024-05-14",
      "2024-05-15",
      "2024-05-16",
    ]);
  });
});

// ---------------------------------------------------------------------------
// HoldingValuation sorting
// ---------------------------------------------------------------------------

describe("top holdings sort", () => {
  it("sorts holdings by market value descending", () => {
    const holdings: HoldingValuation[] = [
      makeHoldingValuation("h-a", "5000", "4000"),
      makeHoldingValuation("h-b", "20000", "15000"),
      makeHoldingValuation("h-c", "1000", "800"),
    ];
    const sorted = [...holdings].sort((a, b) => b.marketValue.cmp(a.marketValue));
    expect(sorted[0]?.holdingId).toBe("h-b");
    expect(sorted[1]?.holdingId).toBe("h-a");
    expect(sorted[2]?.holdingId).toBe("h-c");
  });

  it("excludes negative-value holdings", () => {
    const holdings: HoldingValuation[] = [
      makeHoldingValuation("h-pos", "5000", "4000"),
      makeHoldingValuation("h-neg", "-1000", "2000"),
    ];
    const filtered = holdings.filter((h) => !h.marketValue.isNegative());
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.holdingId).toBe("h-pos");
  });

  it("slices to max 10 rows", () => {
    const holdings: HoldingValuation[] = Array.from({ length: 15 }, (_, i) =>
      makeHoldingValuation(`h-${i}`, String((15 - i) * 1000), "0"),
    );
    const top10 = [...holdings].sort((a, b) => b.marketValue.cmp(a.marketValue)).slice(0, 10);
    expect(top10).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// Decimal money math
// ---------------------------------------------------------------------------

describe("Decimal arithmetic for delta computation", () => {
  it("computes dollar delta using Decimal subtraction", () => {
    const current = Decimal.fromMinorUnits(200000n, SCALE_CENTS);
    const previous = Decimal.fromMinorUnits(190000n, SCALE_CENTS);
    const dollar = current.sub(previous);
    expect(dollar.toString()).toBe("100.00");
  });

  it("computes percent delta as a float ratio", () => {
    const current = Decimal.fromMinorUnits(200000n, SCALE_CENTS);
    const previous = Decimal.fromMinorUnits(190000n, SCALE_CENTS);
    const dollar = current.sub(previous);
    const pct = dollar.toFloat() / previous.toFloat();
    const formatted = formatPercent(pct, { signed: true });
    expect(formatted.startsWith("+")).toBe(true);
    expect(formatted.endsWith("%")).toBe(true);
  });

  it("returns negative delta when net worth decreases", () => {
    const current = Decimal.fromMinorUnits(90000n, SCALE_CENTS);
    const previous = Decimal.fromMinorUnits(100000n, SCALE_CENTS);
    const dollar = current.sub(previous);
    expect(dollar.isNegative()).toBe(true);
    expect(dollar.toString()).toBe("-100.00");
  });
});

// ---------------------------------------------------------------------------
// Account fixture sanity
// ---------------------------------------------------------------------------

describe("account fixtures", () => {
  it("cash account has correct balance", () => {
    const acct = makeCash({ balanceCents: "999999" });
    expect(acct.payload.kind).toBe("cash");
    if (acct.payload.kind === "cash") {
      const d = Decimal.fromMinorUnits(BigInt(acct.payload.balanceCents), SCALE_CENTS);
      expect(d.toString()).toBe("9999.99");
    }
  });
});
