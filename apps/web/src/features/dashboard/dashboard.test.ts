/**
 * Unit tests for the dashboard feature, covers pure helpers and formatters.
 */

import type {
  AccountId,
  CashAccount,
  Holding,
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
import { computeDayChangeByHoldingId, deriveAggregateDeltas } from "./_math";
import {
  buildSnapshotPayload,
  existingSnapshotLooksUnpriced,
  isBreakdownPriced,
  nextSnapshotAction,
  snapshotObjectId,
  utcDateString,
} from "./_snapshot";

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

function makeSnapshot(
  date: IsoDate,
  netWorthCents: string,
  opts: { cashCents?: string; investmentCents?: string } = {},
): NetWorthSnapshot {
  return {
    id: asId<NetWorthSnapshotId>(`snap-${date}`),
    userId: asId<UserId>("user-1"),
    createdAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    updatedAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    payload: {
      snapshotAt: date,
      netWorthCents,
      cashCents: opts.cashCents ?? "0",
      investmentCents: opts.investmentCents ?? "0",
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
// Snapshot creation helpers (used by the dashboard's daily-write effect)
// ---------------------------------------------------------------------------

describe("utcDateString", () => {
  it("returns the UTC YYYY-MM-DD slice of the given Date", () => {
    expect(utcDateString(new Date("2026-05-29T15:30:00.000Z"))).toBe("2026-05-29");
  });

  it("uses UTC, not local time, on the day boundary", () => {
    // 2026-05-29 23:30 in UTC-8 = 2026-05-30 07:30 UTC, snapshot date is May 30.
    expect(utcDateString(new Date("2026-05-30T07:30:00.000Z"))).toBe("2026-05-30");
  });
});

describe("isBreakdownPriced", () => {
  function makeBreakdown(unknownTickers: string[]): Parameters<typeof isBreakdownPriced>[0] {
    return {
      totalAssets: Decimal.zero(SCALE_CENTS),
      totalLiabilities: Decimal.zero(SCALE_CENTS),
      netWorth: Decimal.zero(SCALE_CENTS),
      byAccountKind: {
        cash: Decimal.zero(SCALE_CENTS),
        investment: Decimal.zero(SCALE_CENTS),
        liability: Decimal.zero(SCALE_CENTS),
        manualAsset: Decimal.zero(SCALE_CENTS),
      },
      byAccount: [],
      byHolding: [],
      unknownTickers,
      asOf: 0,
    };
  }

  it("is true when no tickers are missing", () => {
    expect(isBreakdownPriced(makeBreakdown([]))).toBe(true);
  });

  it("is true when only currency_mismatch warnings are present", () => {
    expect(isBreakdownPriced(makeBreakdown(["currency_mismatch:acct-1"]))).toBe(true);
  });

  it("is false when a real ticker is missing a price", () => {
    expect(isBreakdownPriced(makeBreakdown(["AAPL"]))).toBe(false);
  });

  it("is false when both a missing ticker and a currency warning are present", () => {
    expect(isBreakdownPriced(makeBreakdown(["currency_mismatch:a", "BTC"]))).toBe(false);
  });
});

describe("existingSnapshotLooksUnpriced", () => {
  function makeBreakdown(byHoldingCount: number): Parameters<typeof isBreakdownPriced>[0] {
    const byHolding = Array.from({ length: byHoldingCount }, (_, i) => ({
      holdingId: asId<HoldingId>(`h-${i}`),
      marketValue: Decimal.zero(SCALE_CENTS),
    })) as unknown as Parameters<typeof isBreakdownPriced>[0]["byHolding"];
    return {
      totalAssets: Decimal.zero(SCALE_CENTS),
      totalLiabilities: Decimal.zero(SCALE_CENTS),
      netWorth: Decimal.zero(SCALE_CENTS),
      byAccountKind: {
        cash: Decimal.zero(SCALE_CENTS),
        investment: Decimal.zero(SCALE_CENTS),
        liability: Decimal.zero(SCALE_CENTS),
        manualAsset: Decimal.zero(SCALE_CENTS),
      },
      byAccount: [],
      byHolding,
      unknownTickers: [],
      asOf: 0,
    };
  }

  it("flags a zero-investment row when holdings are present (heal allowed)", () => {
    const existing = makeSnapshot(asIsoDate("2026-05-29"), "50000", { investmentCents: "0" });
    expect(existingSnapshotLooksUnpriced(existing, makeBreakdown(2))).toBe(true);
  });

  it("does not flag a zero-investment row when no holdings exist (account closure)", () => {
    const existing = makeSnapshot(asIsoDate("2026-05-29"), "50000", { investmentCents: "0" });
    expect(existingSnapshotLooksUnpriced(existing, makeBreakdown(0))).toBe(false);
  });

  it("does not flag a non-zero-investment row even with holdings present", () => {
    const existing = makeSnapshot(asIsoDate("2026-05-29"), "150000", { investmentCents: "100000" });
    expect(existingSnapshotLooksUnpriced(existing, makeBreakdown(2))).toBe(false);
  });
});

describe("snapshotObjectId", () => {
  it("returns the same id for the same UTC date", () => {
    expect(snapshotObjectId("2026-05-29")).toBe(snapshotObjectId("2026-05-29"));
  });

  it("returns distinct ids for different UTC dates", () => {
    expect(snapshotObjectId("2026-05-29")).not.toBe(snapshotObjectId("2026-05-30"));
  });

  it("encodes the date in the id so collisions are date-keyed", () => {
    expect(snapshotObjectId("2026-05-29")).toBe("snap-2026-05-29");
  });
});

describe("nextSnapshotAction", () => {
  it("creates when no snapshot exists for today", () => {
    expect(
      nextSnapshotAction({
        snapshots: [],
        today: "2026-05-29",
        currentNetWorthCents: "100000",
        existingLooksUnpriced: false,
        alreadyRewroteThisSession: false,
      }),
    ).toEqual({ type: "create" });
  });

  it("creates when only older snapshots exist", () => {
    expect(
      nextSnapshotAction({
        snapshots: [makeSnapshot(asIsoDate("2026-05-28"), "90000")],
        today: "2026-05-29",
        currentNetWorthCents: "100000",
        existingLooksUnpriced: false,
        alreadyRewroteThisSession: false,
      }),
    ).toEqual({ type: "create" });
  });

  it("skips when today's snapshot matches the current net worth", () => {
    expect(
      nextSnapshotAction({
        snapshots: [makeSnapshot(asIsoDate("2026-05-29"), "100000")],
        today: "2026-05-29",
        currentNetWorthCents: "100000",
        existingLooksUnpriced: false,
        alreadyRewroteThisSession: false,
      }),
    ).toEqual({ type: "skip" });
  });

  it("updates today's snapshot when it was sealed unpriced and now diverges", () => {
    // Day-1 race: snapshot was written before prices loaded, so investmentCents
    // contributed $0 to netWorth. Now prices have arrived and the breakdown
    // shows the true value; rewrite today's row.
    const action = nextSnapshotAction({
      snapshots: [makeSnapshot(asIsoDate("2026-05-29"), "50000")],
      today: "2026-05-29",
      currentNetWorthCents: "150000",
      existingLooksUnpriced: true,
      alreadyRewroteThisSession: false,
    });
    expect(action).toEqual({ type: "update", existingId: "snap-2026-05-29" });
  });

  it("skips when an already-priced row diverges (intraday price drift)", () => {
    // Existing row has real prices baked in; net worth ticks by a few cents
    // from market movement. Not a heal target, the rewrite token stays unused.
    expect(
      nextSnapshotAction({
        snapshots: [makeSnapshot(asIsoDate("2026-05-29"), "150000")],
        today: "2026-05-29",
        currentNetWorthCents: "150001",
        existingLooksUnpriced: false,
        alreadyRewroteThisSession: false,
      }),
    ).toEqual({ type: "skip" });
  });

  it("skips the rewrite once the session has already healed today's row", () => {
    // Intraday price drift keeps changing currentNetWorthCents, but we limit
    // self-heal to once per session to avoid churning the snapshot.
    expect(
      nextSnapshotAction({
        snapshots: [makeSnapshot(asIsoDate("2026-05-29"), "50000")],
        today: "2026-05-29",
        currentNetWorthCents: "150000",
        existingLooksUnpriced: true,
        alreadyRewroteThisSession: true,
      }),
    ).toEqual({ type: "skip" });
  });
});

describe("buildSnapshotPayload", () => {
  // Minimal breakdown for the helper. splitCashAndInvestments derives the
  // investments total from byHolding.marketValue and treats the residual
  // inside byAccountKind.investment as a cash sweep; the holding value must
  // equal investmentCents so the split returns the input cents directly.
  function makeBreakdown(opts: {
    netWorthCents: bigint;
    cashCents: bigint;
    investmentCents: bigint;
  }) {
    const holding =
      opts.investmentCents > 0n
        ? [
            {
              holdingId: asId<HoldingId>("h-1"),
              marketValue: Decimal.fromMinorUnits(opts.investmentCents, SCALE_CENTS),
            } as unknown as HoldingValuation,
          ]
        : [];
    return {
      totalAssets: Decimal.zero(SCALE_CENTS),
      totalLiabilities: Decimal.zero(SCALE_CENTS),
      netWorth: Decimal.fromMinorUnits(opts.netWorthCents, SCALE_CENTS),
      byAccountKind: {
        cash: Decimal.fromMinorUnits(opts.cashCents, SCALE_CENTS),
        investment: Decimal.fromMinorUnits(opts.investmentCents, SCALE_CENTS),
        liability: Decimal.zero(SCALE_CENTS),
        manualAsset: Decimal.zero(SCALE_CENTS),
      },
      byAccount: [],
      byHolding: holding,
      unknownTickers: [],
      asOf: 0,
    } as unknown as Parameters<typeof buildSnapshotPayload>[0]["breakdown"];
  }

  it("serialises decimals as bigint-cents strings (no floating point)", () => {
    const payload = buildSnapshotPayload({
      date: "2026-05-29",
      breakdown: makeBreakdown({
        netWorthCents: 3_297_285n,
        cashCents: 1_250_000n,
        investmentCents: 2_047_285n,
      }),
    });

    expect(payload.snapshotAt).toBe("2026-05-29");
    expect(payload.netWorthCents).toBe("3297285");
    expect(payload.cashCents).toBe("1250000");
    expect(payload.investmentCents).toBe("2047285");
  });

  it("returns a payload that JSON-serialises cleanly", () => {
    const payload = buildSnapshotPayload({
      date: "2026-05-29",
      breakdown: makeBreakdown({
        netWorthCents: 0n,
        cashCents: 0n,
        investmentCents: 0n,
      }),
    });

    const json = JSON.stringify(payload);
    expect(json).toBe(
      '{"snapshotAt":"2026-05-29","netWorthCents":"0","cashCents":"0","investmentCents":"0"}',
    );
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

// ---------------------------------------------------------------------------
// deriveAggregateDeltas: math the dashboard depends on
// ---------------------------------------------------------------------------

type BreakdownLike = Parameters<typeof deriveAggregateDeltas>[0];

function mockBreakdown(opts: {
  byHolding: ReadonlyArray<{ id: string; marketValueCents: string }>;
  netWorthCents: string;
}): BreakdownLike {
  return {
    netWorth: Decimal.fromMinorUnits(BigInt(opts.netWorthCents), SCALE_CENTS),
    byHolding: opts.byHolding.map((h) =>
      makeHoldingValuation(h.id, h.marketValueCents, "0"),
    ) as BreakdownLike["byHolding"],
    // Fields below aren't read by deriveAggregateDeltas; cast keeps the shape.
  } as BreakdownLike;
}

function dayChangeMap(entries: Array<[string, string]>): Map<HoldingId, Decimal> {
  const m = new Map<HoldingId, Decimal>();
  for (const [id, cents] of entries) {
    m.set(asId<HoldingId>(id), Decimal.fromMinorUnits(BigInt(cents), SCALE_CENTS));
  }
  return m;
}

describe("deriveAggregateDeltas", () => {
  it("returns null deltas when no holdings have prior-price data", () => {
    const breakdown = mockBreakdown({
      byHolding: [{ id: "h1", marketValueCents: "1000000" }],
      netWorthCents: "1500000",
    });
    const { investments, netWorth } = deriveAggregateDeltas(breakdown, new Map());
    expect(investments).toBeNull();
    expect(netWorth).toBeNull();
  });

  it("computes %s only over the SUBSET with prior-price data (regression: partial coverage)", () => {
    // h1: today 100, dayChange +1.50 → yesterday 98.50, +1.5234% on h1
    // h2 has no prior price, so it must NOT contribute to either numerator or denominator.
    const breakdown = mockBreakdown({
      byHolding: [
        { id: "h1", marketValueCents: "10000" }, // $100.00
        { id: "h2", marketValueCents: "5000" }, // $50.00, no prev
      ],
      netWorthCents: "15000", // = $150.00 total investments, no cash
    });
    const dc = dayChangeMap([["h1", "150"]]); // +$1.50 on h1
    const { investments, netWorth } = deriveAggregateDeltas(breakdown, dc);

    expect(investments).not.toBeNull();
    expect(investments?.dollar.toString()).toBe("1.50");
    // Investments % = 1.50 / 98.50 = 0.01522843…
    expect(investments?.pct).toBeCloseTo(1.5 / 98.5, 10);
    // The wrong (full-portfolio) denominator would give 1.5 / 148.5 = 0.0101…
    expect(investments?.pct).not.toBeCloseTo(1.5 / 148.5, 5);

    // NetWorth dollar same as Investments dollar (only investments moved).
    // NetWorth denominator = prev-of-subset ($98.50) + non-subset MV ($50.00) = $148.50.
    expect(netWorth?.dollar.toString()).toBe("1.50");
    expect(netWorth?.pct).toBeCloseTo(1.5 / 148.5, 10);
  });

  it("handles a red day (negative aggregate)", () => {
    const breakdown = mockBreakdown({
      byHolding: [{ id: "h1", marketValueCents: "10000" }],
      netWorthCents: "10000",
    });
    const dc = dayChangeMap([["h1", "-200"]]); // -$2.00 on h1; yesterday was $102
    const { investments, netWorth } = deriveAggregateDeltas(breakdown, dc);

    expect(investments?.dollar.isNegative()).toBe(true);
    expect(investments?.pct).toBeLessThan(0);
    expect(investments?.pct).toBeCloseTo(-2 / 102, 10);
    expect(netWorth?.pct).toBeCloseTo(-2 / 102, 10);
  });

  it("net worth %'s denominator includes non-market kinds at today's value", () => {
    // Investments $100 (with prev $98.50), Cash $1000 (no intraday move).
    // Net Worth = $1100, NetWorth_yesterday = $98.50 + $1000 = $1098.50.
    const breakdown = mockBreakdown({
      byHolding: [{ id: "h1", marketValueCents: "10000" }],
      netWorthCents: "110000",
    });
    const dc = dayChangeMap([["h1", "150"]]);
    const { netWorth } = deriveAggregateDeltas(breakdown, dc);

    expect(netWorth?.pct).toBeCloseTo(1.5 / 1098.5, 10);
  });

  it("returns null when prior-investments computes to zero (would div-by-zero)", () => {
    // Pathological: today's investments = today's change (yesterday was 0).
    const breakdown = mockBreakdown({
      byHolding: [{ id: "h1", marketValueCents: "10000" }],
      netWorthCents: "10000",
    });
    const dc = dayChangeMap([["h1", "10000"]]); // mvCovered − dollar = 0
    const { investments, netWorth } = deriveAggregateDeltas(breakdown, dc);
    expect(investments).toBeNull();
    expect(netWorth).toBeNull();
  });

  it("returns null investments when prior-investments would be negative", () => {
    // Today MV $100; today's change +$150 means yesterday MV = -$50.
    // Sign-flipped denominator must not produce a negative pct.
    const breakdown = mockBreakdown({
      byHolding: [{ id: "h1", marketValueCents: "10000" }],
      netWorthCents: "10000",
    });
    const dc = dayChangeMap([["h1", "15000"]]);
    const { investments, netWorth } = deriveAggregateDeltas(breakdown, dc);
    expect(investments).toBeNull();
    expect(netWorth).toBeNull();
  });

  it("returns null netWorth but valid investments when prevNetWorth is negative", () => {
    // Investments: today $100, yesterday $99 (positive prev). Cash/liabilities
    // bring netWorth to -$50 today; prevNetWorth = $99 + (-$150) = -$51.
    // Investments % is meaningful, netWorth % is not.
    const breakdown = mockBreakdown({
      byHolding: [{ id: "h1", marketValueCents: "10000" }],
      netWorthCents: "-5000",
    });
    const dc = dayChangeMap([["h1", "100"]]);
    const { investments, netWorth } = deriveAggregateDeltas(breakdown, dc);
    expect(investments).not.toBeNull();
    expect(investments?.pct).toBeGreaterThan(0);
    expect(netWorth).toBeNull();
  });

  it("KPI aggregate and top-holdings table see the same set (skips negative-MV)", () => {
    // h1: positive MV with day change; h-neg: negative MV with day change.
    // The aggregate must skip h-neg so the KPI does not include a day delta
    // the top-holdings table excludes (filter parity).
    const breakdown = mockBreakdown({
      byHolding: [
        { id: "h1", marketValueCents: "10000" },
        { id: "h-neg", marketValueCents: "-2000" },
      ],
      netWorthCents: "8000",
    });
    const dc = dayChangeMap([
      ["h1", "150"],
      ["h-neg", "50"],
    ]);
    const { investments } = deriveAggregateDeltas(breakdown, dc);
    // Only h1 contributes: $1.50 over prev $98.50.
    expect(investments?.dollar.toString()).toBe("1.50");
    expect(investments?.pct).toBeCloseTo(1.5 / 98.5, 10);
  });
});

// ---------------------------------------------------------------------------
// computeDayChangeByHoldingId: verifies proxy + scaleFactor + missing prev
// ---------------------------------------------------------------------------

type HoldingMinPayload = {
  ticker: string;
  proxyTicker: string | null;
  sharesMajor: string;
  sharesScale: number;
  scaleFactor: string | undefined;
};

function makeStockHolding(id: string, p: HoldingMinPayload): Holding {
  const ts = asIsoDateTime(new Date(0).toISOString());
  // Cast through unknown: payload shape is broader (cost basis, asset type,
  // groupId, etc.) but computeDayChangeByHoldingId only reads ticker/proxy/
  // shares/scaleFactor, so we keep the fixture minimal.
  return {
    id: asId<HoldingId>(id),
    userId: asId<UserId>("user-1"),
    createdAt: ts,
    updatedAt: ts,
    payload: p,
  } as unknown as Holding;
}

// ---------------------------------------------------------------------------
// buildKindSlices negative-bucket exclusion
// buildKindSlices is private to queries.ts (not exported to avoid leaking
// hook internals). The filter it applies is:
//   .filter((c) => !c.value.isZero() && !c.value.isNegative())
// These tests verify the Decimal predicate so regressions surface here rather
// than only in manual/e2e runs.
// ---------------------------------------------------------------------------

describe("buildKindSlices negative-filter predicate", () => {
  it("retains a positive bucket", () => {
    const pos = Decimal.fromMinorUnits(50000n, SCALE_CENTS);
    expect(pos.isZero()).toBe(false);
    expect(pos.isNegative()).toBe(false);
  });

  it("excludes a zero bucket", () => {
    const zero = Decimal.zero(SCALE_CENTS);
    expect(zero.isZero()).toBe(true);
  });

  it("excludes a negative bucket (liability / short position)", () => {
    const neg = Decimal.fromMinorUnits(-30000n, SCALE_CENTS);
    expect(neg.isNegative()).toBe(true);
  });

  it("filter keeps positives only, mirrors the filter in buildKindSlices", () => {
    const candidates = [
      { label: "Cash", value: Decimal.fromMinorUnits(100000n, SCALE_CENTS) },
      { label: "Investments", value: Decimal.fromMinorUnits(200000n, SCALE_CENTS) },
      { label: "Manual assets", value: Decimal.fromMinorUnits(-50000n, SCALE_CENTS) },
      { label: "Empty", value: Decimal.zero(SCALE_CENTS) },
    ];
    const kept = candidates.filter((c) => !c.value.isZero() && !c.value.isNegative());
    expect(kept.map((c) => c.label)).toEqual(["Cash", "Investments"]);
  });
});

describe("computeDayChangeByHoldingId", () => {
  it("non-proxy stock: shares × (cur − prev)", () => {
    const h = makeStockHolding("h1", {
      ticker: "AAPL",
      proxyTicker: null,
      sharesMajor: "10",
      sharesScale: 4,
      scaleFactor: undefined,
    });
    const cur = new Map([["AAPL", Decimal.fromString("180.00", 8)]]);
    const prev = new Map([["AAPL", Decimal.fromString("178.50", 8)]]);
    const out = computeDayChangeByHoldingId([h], cur, prev);
    // 10 × (180 − 178.50) = 15.00
    expect(out.get(asId<HoldingId>("h1"))?.toString()).toBe("15.00");
  });

  it("proxy holding: scaleFactor applied at SCALE_CRYPTO before shares mul", () => {
    // COMPANY401K tracks VOO with scale 0.07253775 (= NAV $50 / VOO $689.20)
    const h = makeStockHolding("h2", {
      ticker: "COMPANY401K",
      proxyTicker: "VOO",
      sharesMajor: "100",
      sharesScale: 4,
      scaleFactor: "0.07253775",
    });
    const cur = new Map([["VOO", Decimal.fromString("689.20", 8)]]);
    const prev = new Map([["VOO", Decimal.fromString("689.99", 8)]]);
    const out = computeDayChangeByHoldingId([h], cur, prev);
    // 100 × (689.20 − 689.99) × 0.07253775 = 100 × -0.79 × 0.07253775 = -5.7305
    // Rounded to cents = -5.73
    expect(out.get(asId<HoldingId>("h2"))?.toString()).toBe("-5.73");
  });

  it("omits holdings without a prior price (renders em-dash on the row)", () => {
    const h = makeStockHolding("h3", {
      ticker: "NEWLY_ADDED",
      proxyTicker: null,
      sharesMajor: "5",
      sharesScale: 4,
      scaleFactor: undefined,
    });
    const cur = new Map([["NEWLY_ADDED", Decimal.fromString("100.00", 8)]]);
    const prev = new Map<string, Decimal>(); // no prior
    const out = computeDayChangeByHoldingId([h], cur, prev);
    expect(out.has(asId<HoldingId>("h3"))).toBe(false);
  });

  it("crypto holding (uses .ticker, no proxy): full fractional shares", () => {
    const h = makeStockHolding("h4", {
      ticker: "bitcoin",
      proxyTicker: null,
      sharesMajor: "0.5",
      sharesScale: 8,
      scaleFactor: undefined,
    });
    const cur = new Map([["bitcoin", Decimal.fromString("72792.00", 8)]]);
    const prev = new Map([["bitcoin", Decimal.fromString("74972.16", 8)]]);
    const out = computeDayChangeByHoldingId([h], cur, prev);
    // 0.5 × (72792 − 74972.16) = 0.5 × -2180.16 = -1090.08
    expect(out.get(asId<HoldingId>("h4"))?.toString()).toBe("-1090.08");
  });
});
