import type { NetWorthBreakdown } from "@privance/core";
import { Decimal, type HoldingId, SCALE_CENTS } from "@privance/core";
import { describe, expect, it } from "vitest";
import { isAwaitingInitialPrices, splitCashAndInvestments } from "./_math";

type TestHolding = { payload: { ticker: string; proxyTicker: string | null } };

function holding(ticker: string, proxyTicker: string | null = null): TestHolding {
  return { payload: { ticker, proxyTicker } };
}

function cents(dollars: number): Decimal {
  return Decimal.fromMinorUnits(BigInt(Math.round(dollars * 100)), SCALE_CENTS);
}

// splitCashAndInvestments only reads byHolding + byAccountKind, so the rest of
// the breakdown is irrelevant here.
function breakdown(opts: {
  holdingMVs: number[];
  cash: number;
  investmentAccountTotal: number;
}): NetWorthBreakdown {
  return {
    byHolding: opts.holdingMVs.map((mv, i) => ({
      holdingId: `h${i}` as HoldingId,
      marketValue: cents(mv),
      costBasis: cents(0),
      unrealizedPnl: cents(0),
    })),
    byAccountKind: {
      cash: cents(opts.cash),
      investment: cents(opts.investmentAccountTotal),
      liability: cents(0),
      manualAsset: cents(0),
    },
  } as unknown as NetWorthBreakdown;
}

describe("isAwaitingInitialPrices", () => {
  it("does not hold once the price fetch has settled, even with an unpriced holding", () => {
    const holdings = [holding("VTI"), holding("ILLIQUID")];
    const prices = new Map([["VTI", 1]]);
    expect(isAwaitingInitialPrices(holdings, prices, false)).toBe(false);
  });

  it("holds while the initial fetch is in flight and a price is still missing", () => {
    const holdings = [holding("VTI"), holding("AAPL")];
    const prices = new Map([["VTI", 1]]);
    expect(isAwaitingInitialPrices(holdings, prices, true)).toBe(true);
  });

  it("does not hold while loading once every holding is priced", () => {
    const holdings = [holding("VTI"), holding("AAPL")];
    const prices = new Map([
      ["VTI", 1],
      ["AAPL", 2],
    ]);
    expect(isAwaitingInitialPrices(holdings, prices, true)).toBe(false);
  });

  it("keys on the proxy ticker when present", () => {
    const holdings = [holding("FXAIX", "VOO")];
    expect(isAwaitingInitialPrices(holdings, new Map(), true)).toBe(true);
    expect(isAwaitingInitialPrices(holdings, new Map([["VOO", 1]]), true)).toBe(false);
  });

  it("never holds when there are no holdings", () => {
    expect(isAwaitingInitialPrices([], new Map(), true)).toBe(false);
  });
});

describe("splitCashAndInvestments", () => {
  it("counts holdings market value as investments and the rest of the investment account as cash", () => {
    // Investment account holds $30k total; $25k is holdings, so the $5k sweep
    // is cash. Plus $10k in plain cash accounts.
    const { cash, investments } = splitCashAndInvestments(
      breakdown({ holdingMVs: [15_000, 10_000], cash: 10_000, investmentAccountTotal: 30_000 }),
    );
    expect(investments.toString()).toBe(cents(25_000).toString());
    expect(cash.toString()).toBe(cents(15_000).toString());
  });

  it("treats a fully-invested account as zero cash sweep", () => {
    const { cash, investments } = splitCashAndInvestments(
      breakdown({ holdingMVs: [20_000], cash: 5_000, investmentAccountTotal: 20_000 }),
    );
    expect(investments.toString()).toBe(cents(20_000).toString());
    expect(cash.toString()).toBe(cents(5_000).toString());
  });

  it("reports zero investments when there are no holdings", () => {
    const { cash, investments } = splitCashAndInvestments(
      breakdown({ holdingMVs: [], cash: 8_000, investmentAccountTotal: 0 }),
    );
    expect(investments.isZero()).toBe(true);
    expect(cash.toString()).toBe(cents(8_000).toString());
  });
});
