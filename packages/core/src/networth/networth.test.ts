import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Decimal, SCALE_CENTS } from "../decimal/index.js";
import type {
  Account,
  CashAccount,
  Holding,
  HoldingGroup,
  InvestmentAccount,
  LiabilityAccount,
  ManualAssetAccount,
  SymbolProfile,
} from "../domain/index.js";
import { asId, asIsoDateTime } from "../domain/index.js";
import type { NetWorthInput } from "./index.js";
import {
  allocationByAssetClass,
  allocationByCountry,
  allocationByGroup,
  allocationByRegion,
  allocationBySector,
  computeNetWorth,
} from "./index.js";

const AS_OF = 1_700_000_000_000;

function makeCash(id: string, balanceCents: string, currency = "USD"): CashAccount {
  return {
    id: asId(id),
    userId: asId("u-1"),
    createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
    lastUpdatedAt: asIsoDateTime("2026-01-01T00:00:00Z"),
    payload: {
      kind: "cash",
      subKind: "checking",
      name: `Cash ${id}`,
      balanceCents,
      currency,
    },
  };
}

function makeInvestment(id: string, cashBalanceCents: string, currency = "USD"): InvestmentAccount {
  return {
    id: asId(id),
    userId: asId("u-1"),
    createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
    lastUpdatedAt: asIsoDateTime("2026-01-01T00:00:00Z"),
    payload: {
      kind: "investment",
      subKind: "brokerage",
      name: `Investment ${id}`,
      cashBalanceCents,
      currency,
      assetType: "stock",
    },
  };
}

function makeLiability(id: string, balanceCents: string, currency = "USD"): LiabilityAccount {
  return {
    id: asId(id),
    userId: asId("u-1"),
    createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
    lastUpdatedAt: asIsoDateTime("2026-01-01T00:00:00Z"),
    payload: {
      kind: "liability",
      subKind: "mortgage",
      name: `Liability ${id}`,
      balanceCents,
      currency,
    },
  };
}

function makeManualAsset(id: string, valueCents: string, currency = "USD"): ManualAssetAccount {
  return {
    id: asId(id),
    userId: asId("u-1"),
    createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
    lastUpdatedAt: asIsoDateTime("2026-01-01T00:00:00Z"),
    payload: {
      kind: "manual_asset",
      subKind: "real_estate",
      name: `Asset ${id}`,
      valueCents,
      currency,
    },
  };
}

function makeHolding(
  id: string,
  accountId: string,
  ticker: string,
  sharesMajor: string,
  costBasisCents: string,
  opts: {
    proxyTicker?: string | null;
    scaleFactor?: string;
    sharesScale?: number;
    groupId?: string | null;
  } = {},
): Holding {
  return {
    id: asId(id),
    userId: asId("u-1"),
    createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
    updatedAt: asIsoDateTime("2026-01-01T00:00:00Z"),
    payload: {
      accountId: asId(accountId),
      groupId:
        opts.groupId !== undefined ? (opts.groupId !== null ? asId(opts.groupId) : null) : null,
      ticker,
      assetType: "stock",
      proxyTicker: opts.proxyTicker !== undefined ? opts.proxyTicker : null,
      sharesMajor,
      sharesScale: opts.sharesScale ?? 4,
      costBasisCents,
      scaleFactor: opts.scaleFactor,
    },
  };
}

function makeGroup(id: string, name: string): HoldingGroup {
  return {
    id: asId(id),
    userId: asId("u-1"),
    createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
    payload: { name },
  };
}

function priceMap(entries: Record<string, string>): Map<string, Decimal> {
  return new Map(
    Object.entries(entries).map(([ticker, price]) => [ticker, Decimal.fromString(price)]),
  );
}

describe("computeNetWorth, cash only", () => {
  it("sums cash account balances", () => {
    const input: NetWorthInput = {
      accounts: [makeCash("ca-1", "100000"), makeCash("ca-2", "50000")],
      holdings: [],
      prices: new Map(),
      asOf: AS_OF,
    };
    const bd = computeNetWorth(input);
    expect(bd.totalAssets.toString()).toBe("1500.00");
    expect(bd.totalLiabilities.toString()).toBe("0.00");
    expect(bd.netWorth.toString()).toBe("1500.00");
    expect(bd.byAccountKind.cash.toString()).toBe("1500.00");
  });

  it("netWorth = totalAssets - totalLiabilities", () => {
    const input: NetWorthInput = {
      accounts: [makeCash("ca-1", "500000"), makeLiability("la-1", "200000")],
      holdings: [],
      prices: new Map(),
      asOf: AS_OF,
    };
    const bd = computeNetWorth(input);
    expect(bd.netWorth.toString()).toBe("3000.00");
    expect(bd.totalAssets.toString()).toBe("5000.00");
    expect(bd.totalLiabilities.toString()).toBe("2000.00");
  });
});

describe("computeNetWorth, investments + holdings", () => {
  it("includes cash sweep + holding market value in investment bucket", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "50000")]; // $500 sweep
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "AAPL", "10.0000", "15000"), // 10 shares
    ];
    const prices = priceMap({ AAPL: "200.00" }); // $200/share → $2000 market value
    const input: NetWorthInput = { accounts, holdings, prices, asOf: AS_OF };
    const bd = computeNetWorth(input);
    // investment = $500 (sweep) + $2000 (holding) = $2500
    expect(bd.byAccountKind.investment.toString()).toBe("2500.00");
    expect(bd.totalAssets.toString()).toBe("2500.00");
    // byHolding
    expect(bd.byHolding).toHaveLength(1);
    const h = bd.byHolding[0];
    expect(h).toBeDefined();
    expect(h?.marketValue.toString()).toBe("2000.00");
    expect(h?.costBasis.toString()).toBe("150.00");
    expect(h?.unrealizedPnl.toString()).toBe("1850.00");
  });

  it("reports a negative unrealizedPnl when market value is below cost basis", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "AAPL", "10.0000", "300000"), // cost $3,000
    ];
    const prices = priceMap({ AAPL: "200.00" }); // 10 × $200 = $2,000 market value
    const bd = computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    const h = bd.byHolding[0];
    expect(h?.marketValue.toString()).toBe("2000.00");
    expect(h?.costBasis.toString()).toBe("3000.00");
    // $2,000 - $3,000 = -$1,000 loss.
    expect(h?.unrealizedPnl.toString()).toBe("-1000.00");
    expect(h?.unrealizedPnl.isNegative()).toBe(true);
  });

  it("accumulates multiple holdings on same account", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "AAPL", "2.0000", "0"),
      makeHolding("h-2", "ia-1", "GOOG", "1.0000", "0"),
    ];
    const prices = priceMap({ AAPL: "100.00", GOOG: "150.00" });
    const bd = computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    // $200 + $150 = $350
    expect(bd.byAccountKind.investment.toString()).toBe("350.00");
    const acct = bd.byAccount[0];
    expect(acct?.value.toString()).toBe("350.00");
  });
});

describe("computeNetWorth, manual_asset", () => {
  it("adds manual asset value to totalAssets and manualAsset bucket", () => {
    const accounts: Account[] = [makeManualAsset("ma-1", "55000000")]; // $550,000
    const bd = computeNetWorth({ accounts, holdings: [], prices: new Map(), asOf: AS_OF });
    expect(bd.byAccountKind.manualAsset.toString()).toBe("550000.00");
    expect(bd.totalAssets.toString()).toBe("550000.00");
  });
});

describe("computeNetWorth, liability sign convention", () => {
  it("liability balanceCents is positive but subtracted from netWorth", () => {
    const accounts: Account[] = [
      makeCash("ca-1", "1000000"), // $10,000
      makeLiability("la-1", "300000"), // $3,000 debt
    ];
    const bd = computeNetWorth({ accounts, holdings: [], prices: new Map(), asOf: AS_OF });
    expect(bd.totalAssets.toString()).toBe("10000.00");
    expect(bd.totalLiabilities.toString()).toBe("3000.00");
    expect(bd.netWorth.toString()).toBe("7000.00");
    expect(bd.byAccountKind.liability.toString()).toBe("3000.00");
  });
});

describe("computeNetWorth, unknown tickers", () => {
  it("adds ticker to unknownTickers and contributes $0 market value", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const holdings: Holding[] = [makeHolding("h-1", "ia-1", "XYZ", "5.0000", "10000")];
    const bd = computeNetWorth({ accounts, holdings, prices: new Map(), asOf: AS_OF });
    expect(bd.unknownTickers).toContain("XYZ");
    expect(bd.byAccountKind.investment.toString()).toBe("0.00");
  });

  it("adds proxy ticker to unknownTickers when proxy price missing", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "CIT_FOO", "10.0000", "5000", {
        proxyTicker: "SPY",
        scaleFactor: "1.00",
      }),
    ];
    // No price for SPY
    const bd = computeNetWorth({ accounts, holdings, prices: new Map(), asOf: AS_OF });
    expect(bd.unknownTickers).toContain("SPY");
    expect(bd.byAccountKind.investment.toString()).toBe("0.00");
  });
});

describe("computeNetWorth, proxy-priced holdings", () => {
  it("values holding via proxyTicker * scaleFactor * shares", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    // Holding proxied to SPY at 0.98x (CIT tracking SPY with slight discount)
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "CIT_401K", "100.0000", "0", {
        proxyTicker: "SPY",
        scaleFactor: "0.98",
      }),
    ];
    const prices = priceMap({ SPY: "500.00" }); // $500/share → effective price = $490
    const bd = computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    // 100 shares × $490 = $49,000
    expect(bd.byAccountKind.investment.toString()).toBe("49000.00");
    expect(bd.unknownTickers).toHaveLength(0);
  });

  it("does not throw when scaleFactor has more decimal places than price scale (5dp)", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "CIT_CRD", "100.0000", "0", {
        proxyTicker: "SPY",
        scaleFactor: "0.98765", // 5dp, would throw ParseError if parsed at SCALE_CENTS
      }),
    ];
    const prices = priceMap({ SPY: "500.00" });
    // 100 × (500.00 × 0.98765) = 100 × 493.825 = $49,382.50 at cent precision.
    const bd = computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    expect(bd.unknownTickers).toHaveLength(0);
    expect(bd.byAccountKind.investment.toString()).toBe("49382.50");
  });

  it("uses scaleFactor=1 when omitted and proxy ticker is set", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "CIT_B", "10.0000", "0", {
        proxyTicker: "QQQ",
        // no scaleFactor
      }),
    ];
    const prices = priceMap({ QQQ: "400.00" });
    const bd = computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    // 10 shares × $400 = $4,000
    expect(bd.byAccountKind.investment.toString()).toBe("4000.00");
  });
});

describe("computeNetWorth, primary currency is order-independent", () => {
  it("produces the same unknownTickers regardless of account order", () => {
    // 2× USD, 1× EUR, USD is the mode. No matter what order, EUR should be mismatch.
    const accounts: Account[] = [
      makeCash("ca-1", "100000", "USD"),
      makeCash("ca-2", "50000", "EUR"),
      makeCash("ca-3", "80000", "USD"),
    ];
    const reversed = [...accounts].reverse();
    const bd1 = computeNetWorth({ accounts, holdings: [], prices: new Map(), asOf: AS_OF });
    const bd2 = computeNetWorth({
      accounts: reversed,
      holdings: [],
      prices: new Map(),
      asOf: AS_OF,
    });
    // Both orderings should flag the EUR account as a mismatch
    expect(bd1.unknownTickers.some((s) => s.startsWith("currency_mismatch:"))).toBe(true);
    expect(bd2.unknownTickers.some((s) => s.startsWith("currency_mismatch:"))).toBe(true);
    // The set of mismatch IDs should be identical
    const mismatches1 = bd1.unknownTickers.filter((s) => s.startsWith("currency_mismatch:")).sort();
    const mismatches2 = bd2.unknownTickers.filter((s) => s.startsWith("currency_mismatch:")).sort();
    expect(mismatches1).toEqual(mismatches2);
  });
});

describe("computeNetWorth, currency mismatch", () => {
  it("flags accounts with a different currency in unknownTickers", () => {
    const accounts: Account[] = [
      makeCash("ca-1", "100000", "USD"),
      makeCash("ca-2", "50000", "EUR"), // mismatch: tie on count, USD holds more
    ];
    const bd = computeNetWorth({ accounts, holdings: [], prices: new Map(), asOf: AS_OF });
    expect(bd.unknownTickers).toContain("currency_mismatch:ca-2");
    expect(bd.unknownTickers).not.toContain("currency_mismatch:ca-1");
  });

  it("breaks a count tie by asset value, not alphabet", () => {
    // 1 USD vs 1 EUR with the USD account holding more: USD must be primary
    // even though EUR sorts first. The lexicographic rule once excluded a
    // user's largest account here.
    const accounts: Account[] = [
      makeCash("ca-usd", "8500000", "USD"),
      makeCash("ca-eur", "2000000", "EUR"),
    ];
    const bd = computeNetWorth({ accounts, holdings: [], prices: new Map(), asOf: AS_OF });
    expect(bd.unknownTickers).toContain("currency_mismatch:ca-eur");
    expect(bd.unknownTickers).not.toContain("currency_mismatch:ca-usd");
  });

  it("tie-break counts holdings at market value, not just cash sweeps", () => {
    // The EUR cash account exceeds the USD investment's sweep, but the USD
    // holdings at market dominate: USD wins the tie.
    const accounts: Account[] = [
      makeInvestment("ia-usd", "10000"),
      makeCash("ca-eur", "500000", "EUR"),
    ];
    const holdings: Holding[] = [makeHolding("h-1", "ia-usd", "VOO", "100.0000", "1000.00")];
    const prices = priceMap({ VOO: "400.00" });
    const bd = computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    expect(bd.unknownTickers).toContain("currency_mismatch:ca-eur");
    expect(bd.unknownTickers).not.toContain("currency_mismatch:ia-usd");
  });

  it("liabilities do not vote in the value tie-break", () => {
    // A large EUR mortgage must not make EUR primary over the USD assets.
    const accounts: Account[] = [
      makeCash("ca-usd", "100000", "USD"),
      makeLiability("la-eur", "90000000", "EUR"),
    ];
    const bd = computeNetWorth({ accounts, holdings: [], prices: new Map(), asOf: AS_OF });
    expect(bd.unknownTickers).toContain("currency_mismatch:la-eur");
    expect(bd.unknownTickers).not.toContain("currency_mismatch:ca-usd");
  });

  it("equal asset values fall back to the lexicographically smallest code", () => {
    const accounts: Account[] = [
      makeCash("ca-usd", "100000", "USD"),
      makeCash("ca-eur", "100000", "EUR"),
    ];
    const bd = computeNetWorth({ accounts, holdings: [], prices: new Map(), asOf: AS_OF });
    expect(bd.unknownTickers).toContain("currency_mismatch:ca-usd");
    expect(bd.unknownTickers).not.toContain("currency_mismatch:ca-eur");
  });

  it("does not flag accounts with the same currency", () => {
    const accounts: Account[] = [
      makeCash("ca-1", "100000", "USD"),
      makeCash("ca-2", "50000", "USD"),
    ];
    const bd = computeNetWorth({ accounts, holdings: [], prices: new Map(), asOf: AS_OF });
    expect(bd.unknownTickers.some((s) => s.startsWith("currency_mismatch:"))).toBe(false);
  });

  it("property: with two single-account currencies, the higher-value (then lower-code) currency is primary", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.constantFrom("AUD", "CAD", "EUR", "GBP", "JPY", "USD"),
        fc.constantFrom("AUD", "CAD", "EUR", "GBP", "JPY", "USD"),
        (balA, balB, curA, curB) => {
          fc.pre(curA !== curB);
          const accounts: Account[] = [
            makeCash("ca-a", String(balA), curA),
            makeCash("ca-b", String(balB), curB),
          ];
          const bd = computeNetWorth({ accounts, holdings: [], prices: new Map(), asOf: AS_OF });
          // Counts tie (one account each), so value decides; equal value -> lower code.
          const expectedPrimary =
            balA > balB ? curA : balB > balA ? curB : curA < curB ? curA : curB;
          const flaggedAccount = expectedPrimary === curA ? "ca-b" : "ca-a";
          const primaryAccount = expectedPrimary === curA ? "ca-a" : "ca-b";
          expect(bd.unknownTickers).toContain(`currency_mismatch:${flaggedAccount}`);
          expect(bd.unknownTickers).not.toContain(`currency_mismatch:${primaryAccount}`);
        },
      ),
    );
  });
});

describe("computeNetWorth, cents-string formats", () => {
  it("accepts dollar-decimal cost basis (legacy on-disk format)", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const holdings: Holding[] = [makeHolding("h-1", "ia-1", "AAPL", "10.0000", "1500.00")];
    const prices = priceMap({ AAPL: "200.00" });
    const bd = computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    expect(bd.byHolding[0]?.costBasis.toString()).toBe("1500.00");
  });

  it("rejects malformed cents string", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const holdings: Holding[] = [makeHolding("h-1", "ia-1", "AAPL", "10.0000", "not-a-number")];
    const prices = priceMap({ AAPL: "200.00" });
    expect(() => computeNetWorth({ accounts, holdings, prices, asOf: AS_OF })).toThrow(
      /invalid cents string/,
    );
  });
});

describe("computeNetWorth, empty input", () => {
  it("returns zeros for empty input", () => {
    const bd = computeNetWorth({ accounts: [], holdings: [], prices: new Map(), asOf: AS_OF });
    expect(bd.totalAssets.toString()).toBe("0.00");
    expect(bd.totalLiabilities.toString()).toBe("0.00");
    expect(bd.netWorth.toString()).toBe("0.00");
    expect(bd.unknownTickers).toHaveLength(0);
  });
});

describe("computeNetWorth, asOf", () => {
  it("returns the asOf supplied by the caller", () => {
    const bd = computeNetWorth({ accounts: [], holdings: [], prices: new Map(), asOf: AS_OF });
    expect(bd.asOf).toBe(AS_OF);
  });
});

describe("computeNetWorth, byAccount breakdown", () => {
  it("includes one entry per account with correct kind", () => {
    const accounts: Account[] = [
      makeCash("ca-1", "100000"),
      makeInvestment("ia-1", "0"),
      makeLiability("la-1", "200000"),
      makeManualAsset("ma-1", "500000"),
    ];
    const bd = computeNetWorth({ accounts, holdings: [], prices: new Map(), asOf: AS_OF });
    expect(bd.byAccount).toHaveLength(4);
    const kinds = bd.byAccount.map((a) => a.kind);
    expect(kinds).toContain("cash");
    expect(kinds).toContain("investment");
    expect(kinds).toContain("liability");
    expect(kinds).toContain("manual_asset");
  });
});

/** Arbitrary for a non-negative balance in cents (0 to $99,999.99) */
const arbCents = fc.bigInt({ min: 0n, max: 9_999_999n }).map((n) => n.toString());

/** Arbitrary for a positive price as a decimal string "0.01" to "9999.99" */
const arbPrice = fc
  .integer({ min: 1, max: 999999 })
  .map((n) => Decimal.fromMinorUnits(BigInt(n), SCALE_CENTS).toString());

/** Arbitrary for shares (1 to 1000, 4 decimal places) */
const arbShares = fc
  .integer({ min: 1, max: 100000 })
  .map((n) => Decimal.fromMinorUnits(BigInt(n), 4).toString());

describe("property: netWorth = totalAssets - totalLiabilities", () => {
  it("holds for arbitrary accounts", () => {
    fc.assert(
      fc.property(
        fc.array(arbCents, { minLength: 0, maxLength: 5 }),
        fc.array(arbCents, { minLength: 0, maxLength: 5 }),
        fc.array(arbCents, { minLength: 0, maxLength: 5 }),
        (cashBalances, liabilityBalances, manualValues) => {
          const accounts: Account[] = [
            ...cashBalances.map((b, i) => makeCash(`ca-${i}`, b)),
            ...liabilityBalances.map((b, i) => makeLiability(`la-${i}`, b)),
            ...manualValues.map((v, i) => makeManualAsset(`ma-${i}`, v)),
          ];
          const bd = computeNetWorth({ accounts, holdings: [], prices: new Map(), asOf: AS_OF });
          const computed = bd.totalAssets.sub(bd.totalLiabilities);
          expect(bd.netWorth.eq(computed)).toBe(true);
        },
      ),
    );
  });
});

describe("property: adding a zero-balance account does not change net worth", () => {
  it("cash zero account", () => {
    fc.assert(
      fc.property(fc.array(arbCents, { minLength: 1, maxLength: 5 }), (balances) => {
        const baseAccounts: Account[] = balances.map((b, i) => makeCash(`ca-${i}`, b));
        const baseNw = computeNetWorth({
          accounts: baseAccounts,
          holdings: [],
          prices: new Map(),
          asOf: AS_OF,
        });

        const withZero: Account[] = [...baseAccounts, makeCash("ca-zero", "0")];
        const withZeroNw = computeNetWorth({
          accounts: withZero,
          holdings: [],
          prices: new Map(),
          asOf: AS_OF,
        });

        expect(withZeroNw.netWorth.eq(baseNw.netWorth)).toBe(true);
      }),
    );
  });
});

describe("property: doubling all cash balances doubles totalAssets", () => {
  it("holds for cash-only inputs", () => {
    fc.assert(
      fc.property(fc.array(arbCents, { minLength: 1, maxLength: 5 }), (balances) => {
        const base: Account[] = balances.map((b, i) => makeCash(`ca-${i}`, b));
        const doubled: Account[] = balances.map((b, i) =>
          makeCash(`ca-${i}`, (BigInt(b) * 2n).toString()),
        );
        const bdBase = computeNetWorth({
          accounts: base,
          holdings: [],
          prices: new Map(),
          asOf: AS_OF,
        });
        const bdDoubled = computeNetWorth({
          accounts: doubled,
          holdings: [],
          prices: new Map(),
          asOf: AS_OF,
        });
        const expected = bdBase.totalAssets.add(bdBase.totalAssets);
        expect(bdDoubled.totalAssets.eq(expected)).toBe(true);
      }),
    );
  });
});

describe("property: doubling all liability balances doubles totalLiabilities", () => {
  it("holds for liability-only inputs", () => {
    fc.assert(
      fc.property(fc.array(arbCents, { minLength: 1, maxLength: 5 }), (balances) => {
        const base: Account[] = balances.map((b, i) => makeLiability(`la-${i}`, b));
        const doubled: Account[] = balances.map((b, i) =>
          makeLiability(`la-${i}`, (BigInt(b) * 2n).toString()),
        );
        const bdBase = computeNetWorth({
          accounts: base,
          holdings: [],
          prices: new Map(),
          asOf: AS_OF,
        });
        const bdDoubled = computeNetWorth({
          accounts: doubled,
          holdings: [],
          prices: new Map(),
          asOf: AS_OF,
        });
        const expected = bdBase.totalLiabilities.add(bdBase.totalLiabilities);
        expect(bdDoubled.totalLiabilities.eq(expected)).toBe(true);
      }),
    );
  });
});

describe("property: computation is order-independent (shuffle accounts)", () => {
  it("same output regardless of account order", () => {
    fc.assert(
      fc.property(
        fc.array(arbCents, { minLength: 2, maxLength: 6 }),
        fc.array(arbCents, { minLength: 1, maxLength: 3 }),
        (cashBalances, liabilityBalances) => {
          const accounts: Account[] = [
            ...cashBalances.map((b, i) => makeCash(`ca-${i}`, b)),
            ...liabilityBalances.map((b, i) => makeLiability(`la-${i}`, b)),
          ];
          // reverse order
          const reversed = [...accounts].reverse();
          const bd1 = computeNetWorth({ accounts, holdings: [], prices: new Map(), asOf: AS_OF });
          const bd2 = computeNetWorth({
            accounts: reversed,
            holdings: [],
            prices: new Map(),
            asOf: AS_OF,
          });
          expect(bd1.netWorth.eq(bd2.netWorth)).toBe(true);
          expect(bd1.totalAssets.eq(bd2.totalAssets)).toBe(true);
          expect(bd1.totalLiabilities.eq(bd2.totalLiabilities)).toBe(true);
        },
      ),
    );
  });
});

describe("property: computation is order-independent (shuffle holdings)", () => {
  it("same investment total regardless of holding order", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ shares: arbShares, price: arbPrice, basis: arbCents }), {
          minLength: 2,
          maxLength: 5,
        }),
        (items) => {
          const accounts: Account[] = [makeInvestment("ia-1", "0")];
          const holdings: Holding[] = items.map((item, i) =>
            makeHolding(`h-${i}`, "ia-1", `TK${i}`, item.shares, item.basis),
          );
          const prices = new Map(
            items.map((item, i) => [`TK${i}`, Decimal.fromString(item.price)]),
          );
          const reversed = [...holdings].reverse();
          const bd1 = computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
          const bd2 = computeNetWorth({ accounts, holdings: reversed, prices, asOf: AS_OF });
          expect(bd1.byAccountKind.investment.eq(bd2.byAccountKind.investment)).toBe(true);
        },
      ),
    );
  });
});

describe("allocationByAssetClass", () => {
  it("returns slices summing to 1 when all prices known", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "AAPL", "1.0000", "0"),
      makeHolding("h-2", "ia-1", "BND", "1.0000", "0"),
    ];
    const prices = priceMap({ AAPL: "100.00", BND: "80.00" });
    const profiles: Map<string, SymbolProfile> = new Map([
      ["AAPL", { ticker: "AAPL", assetType: "stock", assetClass: "equity" }],
      ["BND", { ticker: "BND", assetType: "stock", assetClass: "fixed_income" }],
    ]);
    const bd = computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    void bd; // breakdown no longer passed to allocation functions
    const slices = allocationByAssetClass(holdings, prices, profiles);
    expect(slices).toHaveLength(2);
    const totalShare = slices.reduce((acc, s) => acc + s.share, 0);
    expect(totalShare).toBeCloseTo(1, 4);
  });

  it("groups into Unknown when no profile available", () => {
    const holdings: Holding[] = [makeHolding("h-1", "ia-1", "XYZ", "1.0000", "0")];
    const prices = priceMap({ XYZ: "50.00" });
    const slices = allocationByAssetClass(holdings, prices, new Map());
    expect(slices).toHaveLength(1);
    expect(slices[0]?.label).toBe("Unknown");
  });
});

describe("allocationBySector", () => {
  it("groups holdings by sector label", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "AAPL", "1.0000", "0"),
      makeHolding("h-2", "ia-1", "MSFT", "1.0000", "0"),
      makeHolding("h-3", "ia-1", "JNJ", "1.0000", "0"),
    ];
    const prices = priceMap({ AAPL: "100.00", MSFT: "100.00", JNJ: "100.00" });
    const profiles: Map<string, SymbolProfile> = new Map([
      ["AAPL", { ticker: "AAPL", assetType: "stock", sector: "Technology" }],
      ["MSFT", { ticker: "MSFT", assetType: "stock", sector: "Technology" }],
      ["JNJ", { ticker: "JNJ", assetType: "stock", sector: "Healthcare" }],
    ]);
    computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    const slices = allocationBySector(holdings, prices, profiles);
    expect(slices).toHaveLength(2);
    const tech = slices.find((s) => s.label === "Technology");
    const health = slices.find((s) => s.label === "Healthcare");
    expect(tech).toBeDefined();
    expect(health).toBeDefined();
    // Tech = 2/3 ≈ 0.67, Health = 1/3 ≈ 0.33
    expect((tech?.share ?? 0) > (health?.share ?? 0)).toBe(true);
  });
});

describe("allocationByCountry", () => {
  it("groups by country code", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "AAPL", "1.0000", "0"),
      makeHolding("h-2", "ia-1", "SAP", "1.0000", "0"),
    ];
    const prices = priceMap({ AAPL: "200.00", SAP: "200.00" });
    const profiles: Map<string, SymbolProfile> = new Map([
      ["AAPL", { ticker: "AAPL", assetType: "stock", country: "US" }],
      ["SAP", { ticker: "SAP", assetType: "stock", country: "DE" }],
    ]);
    computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    const slices = allocationByCountry(holdings, prices, profiles);
    expect(slices).toHaveLength(2);
    const labels = slices.map((s) => s.label);
    expect(labels).toContain("US");
    expect(labels).toContain("DE");
  });
});

describe("allocationByRegion", () => {
  it("groups by region", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "AAPL", "2.0000", "0"),
      makeHolding("h-2", "ia-1", "EEM", "1.0000", "0"),
    ];
    const prices = priceMap({ AAPL: "100.00", EEM: "100.00" });
    const profiles: Map<string, SymbolProfile> = new Map([
      ["AAPL", { ticker: "AAPL", assetType: "stock", region: "North America" }],
      ["EEM", { ticker: "EEM", assetType: "stock", region: "Emerging Markets" }],
    ]);
    computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    const slices = allocationByRegion(holdings, prices, profiles);
    expect(slices).toHaveLength(2);
    // North America has 2 shares × $100 = $200 vs $100 → should be first (sorted desc)
    expect(slices[0]?.label).toBe("North America");
  });
});

describe("allocationByGroup", () => {
  it("groups by HoldingGroup name", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const groups: HoldingGroup[] = [makeGroup("grp-1", "US Equities"), makeGroup("grp-2", "Bonds")];
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "AAPL", "1.0000", "0", { groupId: "grp-1" }),
      makeHolding("h-2", "ia-1", "MSFT", "1.0000", "0", { groupId: "grp-1" }),
      makeHolding("h-3", "ia-1", "BND", "1.0000", "0", { groupId: "grp-2" }),
    ];
    const prices = priceMap({ AAPL: "100.00", MSFT: "100.00", BND: "50.00" });
    computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    const slices = allocationByGroup(holdings, prices, groups);
    expect(slices).toHaveLength(2);
    const usEq = slices.find((s) => s.label === "US Equities");
    const bonds = slices.find((s) => s.label === "Bonds");
    expect(usEq).toBeDefined();
    expect(bonds).toBeDefined();
    expect(usEq?.value.cmp(bonds?.value)).toBe(1); // $200 > $50
  });

  it("puts ungrouped holdings in Ungrouped slice", () => {
    const accounts: Account[] = [makeInvestment("ia-1", "0")];
    const groups: HoldingGroup[] = [makeGroup("grp-1", "US Equities")];
    const holdings: Holding[] = [
      makeHolding("h-1", "ia-1", "AAPL", "1.0000", "0", { groupId: "grp-1" }),
      makeHolding("h-2", "ia-1", "XYZ", "1.0000", "0", { groupId: null }),
    ];
    const prices = priceMap({ AAPL: "100.00", XYZ: "100.00" });
    computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
    const slices = allocationByGroup(holdings, prices, groups);
    const ungrouped = slices.find((s) => s.label === "Ungrouped");
    expect(ungrouped).toBeDefined();
  });
});

describe("property: allocation shares sum to 1 when investments present", () => {
  it("holds for allocationByAssetClass", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            shares: arbShares,
            price: arbPrice,
            assetClass: fc.constantFrom("equity", "fixed_income", "etf"),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (items) => {
          const accounts: Account[] = [makeInvestment("ia-1", "0")];
          const holdings: Holding[] = items.map((item, i) =>
            makeHolding(`h-${i}`, "ia-1", `TK${i}`, item.shares, "0"),
          );
          const prices = new Map(
            items.map((item, i) => [`TK${i}`, Decimal.fromString(item.price)]),
          );
          const profiles: Map<string, SymbolProfile> = new Map(
            items.map((item, i) => [
              `TK${i}`,
              { ticker: `TK${i}`, assetType: "stock" as const, assetClass: item.assetClass },
            ]),
          );
          computeNetWorth({ accounts, holdings, prices, asOf: AS_OF });
          const slices = allocationByAssetClass(holdings, prices, profiles);
          // When all holdings round to $0.00 cents, the total is zero and shares
          // are undefined. Skip the share-sum assertion in that degenerate case.
          const totalValue = slices.reduce((acc, s) => acc.add(s.value), Decimal.zero(SCALE_CENTS));
          if (totalValue.isZero()) return;
          const totalShare = slices.reduce((acc, s) => acc + s.share, 0);
          // Sum of shares should be close to 1 (float ratios)
          expect(Math.abs(totalShare - 1)).toBeLessThanOrEqual(0.01);
        },
      ),
    );
  });
});
