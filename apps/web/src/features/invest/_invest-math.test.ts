import type {
  Account,
  AccountId,
  Holding,
  HoldingId,
  NetWorthBreakdown,
  UserId,
} from "@privance/core";
import { asId, asIsoDateTime, Decimal, SCALE_CENTS } from "@privance/core";
import { describe, expect, it } from "vitest";
import type { SymbolProfileEntry } from "@/lib/api/symbol-profiles";
import {
  buildClassSlices,
  buildSectorSlices,
  estimatedIncome,
  portfolioGain,
  subsetGain,
  taxBuckets,
} from "./_invest-math";

function dec(cents: bigint): Decimal {
  return Decimal.fromMinorUnits(cents, SCALE_CENTS);
}

function makeBreakdown(
  holdings: Array<{ unrealizedPnl: bigint; costBasis: bigint; marketValue?: bigint }>,
  byAccount: Array<{
    accountId: string;
    value: bigint;
    kind: "cash" | "investment" | "liability" | "manual_asset";
  }> = [],
): NetWorthBreakdown {
  return {
    totalAssets: dec(0n),
    totalLiabilities: dec(0n),
    netWorth: dec(0n),
    byAccountKind: {
      cash: dec(0n),
      investment: dec(0n),
      liability: dec(0n),
      manualAsset: dec(0n),
    },
    byAccount: byAccount.map((a) => ({
      accountId: asId<AccountId>(a.accountId),
      value: dec(a.value),
      kind: a.kind,
    })),
    byHolding: holdings.map((h, i) => ({
      holdingId: asId<HoldingId>(`h${i}`),
      marketValue: dec(h.marketValue ?? 0n),
      costBasis: dec(h.costBasis),
      unrealizedPnl: dec(h.unrealizedPnl),
    })),
    unknownTickers: [],
    asOf: 0,
  };
}

const TS = asIsoDateTime("2026-01-01T00:00:00.000Z");

function makeInvestmentAccount(opts: { id: string; name: string; subKind: string }): Account {
  return {
    id: asId<AccountId>(opts.id),
    userId: asId<UserId>(""),
    createdAt: TS,
    lastUpdatedAt: TS,
    payload: {
      kind: "investment",
      subKind: opts.subKind as "brokerage",
      name: opts.name,
      cashBalanceCents: "0",
      currency: "USD",
      assetType: "stock",
    },
  } as Account;
}

function makeCashAccount(id: string, name: string): Account {
  return {
    id: asId<AccountId>(id),
    userId: asId<UserId>(""),
    createdAt: TS,
    lastUpdatedAt: TS,
    payload: {
      kind: "cash",
      subKind: "checking",
      name,
      balanceCents: "1000000",
      currency: "USD",
    },
  } as Account;
}

function makeCashAccountWith(opts: {
  id: string;
  name: string;
  balanceCents: string;
  apy?: string;
}): Account {
  return {
    id: asId<AccountId>(opts.id),
    userId: asId<UserId>(""),
    createdAt: TS,
    lastUpdatedAt: TS,
    payload: {
      kind: "cash",
      subKind: "savings",
      name: opts.name,
      balanceCents: opts.balanceCents,
      currency: "USD",
      ...(opts.apy !== undefined ? { apy: opts.apy } : {}),
    },
  } as Account;
}

function makeManualAssetAccount(id: string, name: string, valueCents: string): Account {
  return {
    id: asId<AccountId>(id),
    userId: asId<UserId>(""),
    createdAt: TS,
    lastUpdatedAt: TS,
    payload: {
      kind: "manual_asset",
      subKind: "real_estate",
      name,
      valueCents,
      currency: "USD",
    },
  } as Account;
}

/** Holding whose id matches makeBreakdown's positional ids (h0, h1, ...). */
function makeHolding(opts: {
  id: string;
  ticker: string;
  assetType: "stock" | "crypto";
  proxyTicker?: string;
}): Holding {
  return {
    id: asId<HoldingId>(opts.id),
    userId: asId<UserId>(""),
    createdAt: TS,
    updatedAt: TS,
    payload: {
      accountId: asId<AccountId>("acct"),
      groupId: null,
      ticker: opts.ticker,
      assetType: opts.assetType,
      proxyTicker: opts.proxyTicker ?? null,
      sharesMajor: "0",
      sharesScale: 4,
      costBasisCents: "0",
    },
  } as Holding;
}

function profile(ticker: string, fields: Partial<SymbolProfileEntry>): SymbolProfileEntry {
  return { ticker, assetType: "stock", ...fields };
}

describe("portfolioGain", () => {
  it("sums unrealized pnl and computes correct percentage", () => {
    const breakdown = makeBreakdown([
      { unrealizedPnl: 10000n, costBasis: 50000n },
      { unrealizedPnl: 5000n, costBasis: 25000n },
    ]);
    const { gainCents, gainPct } = portfolioGain(breakdown);
    // total gain = 15000 cents = $150
    expect(gainCents.toMinorUnits()).toBe(15000n);
    // pct = 15000 / 75000 = 0.2
    expect(gainPct).toBeCloseTo(0.2, 6);
  });

  it("returns 0 pct when cost basis is zero", () => {
    const breakdown = makeBreakdown([{ unrealizedPnl: 5000n, costBasis: 0n }]);
    const { gainPct } = portfolioGain(breakdown);
    expect(gainPct).toBe(0);
  });

  it("handles negative unrealizedPnl (loss)", () => {
    const breakdown = makeBreakdown([{ unrealizedPnl: -3000n, costBasis: 10000n }]);
    const { gainCents, gainPct } = portfolioGain(breakdown);
    expect(gainCents.toMinorUnits()).toBe(-3000n);
    expect(gainPct).toBeCloseTo(-0.3, 6);
  });

  it("returns zero when no holdings", () => {
    const breakdown = makeBreakdown([]);
    const { gainCents, gainPct } = portfolioGain(breakdown);
    expect(gainCents.isZero()).toBe(true);
    expect(gainPct).toBe(0);
  });
});

describe("subsetGain", () => {
  it("computes gain and pct for a slice of the byHolding array", () => {
    // Two-holding breakdown: h0 gain=$100 cost=$400, h1 gain=$50 cost=$200.
    // Slicing to h0 only: gainCents = $100, pct = 100/400 = 0.25.
    const breakdown = makeBreakdown([
      { unrealizedPnl: 10000n, costBasis: 40000n },
      { unrealizedPnl: 5000n, costBasis: 20000n },
    ]);
    const firstOnly = breakdown.byHolding.slice(0, 1);
    const { gainCents, gainPct } = subsetGain(firstOnly);
    expect(gainCents.toMinorUnits()).toBe(10000n);
    expect(gainPct).toBeCloseTo(0.25, 6);
  });

  it("returns zero gainCents and zero gainPct for an empty subset", () => {
    const { gainCents, gainPct } = subsetGain([]);
    expect(gainCents.isZero()).toBe(true);
    expect(gainPct).toBe(0);
  });
});

describe("taxBuckets", () => {
  it("buckets investment accounts by tax treatment", () => {
    const brokerageAccount = makeInvestmentAccount({
      id: "a1",
      name: "Vanguard",
      subKind: "brokerage",
    });
    const iraAccount = makeInvestmentAccount({ id: "a2", name: "Fidelity IRA", subKind: "401k" });

    const breakdown = makeBreakdown(
      [],
      [
        { accountId: "a1", value: 50000n, kind: "investment" },
        { accountId: "a2", value: 30000n, kind: "investment" },
      ],
    );

    const { buckets } = taxBuckets({ accounts: [brokerageAccount, iraAccount], breakdown });

    const taxable = buckets.find((b) => b.key === "taxable");
    const pretax = buckets.find((b) => b.key === "pretax");
    expect(taxable?.valueCents.toMinorUnits()).toBe(50000n);
    expect(pretax?.valueCents.toMinorUnits()).toBe(30000n);
  });

  it("buckets cash accounts into the cash bucket", () => {
    const cashAccount = makeCashAccount("c1", "Savings");
    const breakdown = makeBreakdown([], [{ accountId: "c1", value: 1000000n, kind: "cash" }]);
    const { buckets } = taxBuckets({ accounts: [cashAccount], breakdown });
    const cash = buckets.find((b) => b.key === "cash");
    expect(cash?.valueCents.toMinorUnits()).toBe(1000000n);
  });

  it("buckets manual_asset accounts into property", () => {
    const propAccount = makeManualAssetAccount("m1", "House", "50000000");
    const breakdown = makeBreakdown(
      [],
      [{ accountId: "m1", value: 50000000n, kind: "manual_asset" }],
    );
    const { buckets } = taxBuckets({ accounts: [propAccount], breakdown });
    const property = buckets.find((b) => b.key === "property");
    expect(property?.valueCents.toMinorUnits()).toBe(50000000n);
  });

  it("computes reachableBeforeFiftyNineHalfCents = taxable + cash", () => {
    const brokerageAccount = makeInvestmentAccount({
      id: "a1",
      name: "Brokerage",
      subKind: "brokerage",
    });
    const cashAccount = makeCashAccount("c1", "Savings");

    const breakdown = makeBreakdown(
      [],
      [
        { accountId: "a1", value: 40000n, kind: "investment" },
        { accountId: "c1", value: 10000n, kind: "cash" },
      ],
    );

    const { reachableBeforeFiftyNineHalfCents } = taxBuckets({
      accounts: [brokerageAccount, cashAccount],
      breakdown,
    });

    expect(reachableBeforeFiftyNineHalfCents.toMinorUnits()).toBe(50000n);
  });

  it("omits buckets with zero value", () => {
    const breakdown = makeBreakdown([], []);
    const { buckets } = taxBuckets({ accounts: [], breakdown });
    expect(buckets).toHaveLength(0);
  });

  it("reclassifies taxable brokerage cash sweep into the Cash bucket", () => {
    // Brokerage total value = 100_000 cents; sweep = 20_000 cents.
    // Expected: taxable = 80_000, cash = 20_000.
    const brokerage: Account = {
      ...makeInvestmentAccount({ id: "b1", name: "Brokerage", subKind: "brokerage" }),
      payload: {
        kind: "investment",
        subKind: "brokerage",
        name: "Brokerage",
        cashBalanceCents: "20000",
        currency: "USD",
        assetType: "stock",
      },
    } as Account;

    const breakdown = makeBreakdown([], [{ accountId: "b1", value: 100000n, kind: "investment" }]);

    const { buckets, reachableBeforeFiftyNineHalfCents } = taxBuckets({
      accounts: [brokerage],
      breakdown,
    });

    const taxable = buckets.find((b) => b.key === "taxable");
    const cash = buckets.find((b) => b.key === "cash");
    expect(taxable?.valueCents.toMinorUnits()).toBe(80000n);
    expect(cash?.valueCents.toMinorUnits()).toBe(20000n);
    // reachable total is unchanged (sweep is just reclassified within the reachable set).
    expect(reachableBeforeFiftyNineHalfCents.toMinorUnits()).toBe(100000n);
  });

  it("keeps pretax account sweep in pretax bucket (not freely reachable)", () => {
    // 401k total value = 50_000 cents; cashBalanceCents = 10_000 cents.
    // Sweep must stay in pretax, not move to Cash.
    const pretaxAccount: Account = {
      ...makeInvestmentAccount({ id: "p1", name: "401k", subKind: "401k" }),
      payload: {
        kind: "investment",
        subKind: "401k",
        name: "401k",
        cashBalanceCents: "10000",
        currency: "USD",
        assetType: "stock",
      },
    } as Account;

    const breakdown = makeBreakdown([], [{ accountId: "p1", value: 50000n, kind: "investment" }]);

    const { buckets } = taxBuckets({ accounts: [pretaxAccount], breakdown });

    const pretax = buckets.find((b) => b.key === "pretax");
    const cash = buckets.find((b) => b.key === "cash");
    expect(pretax?.valueCents.toMinorUnits()).toBe(50000n);
    expect(cash).toBeUndefined();
  });
});

describe("taxBuckets edge cases", () => {
  it("taxBuckets: account absent from breakdown.byAccount falls back to zero and is omitted", () => {
    const account = makeInvestmentAccount({
      id: "missing",
      name: "Phantom",
      subKind: "brokerage",
    });
    // breakdown has no byAccount entry for "missing"
    const breakdown = makeBreakdown([], []);

    const { buckets } = taxBuckets({ accounts: [account], breakdown });
    // Zero value means it's filtered out
    expect(buckets).toHaveLength(0);
  });
});

describe("buildClassSlices", () => {
  it("buckets bond ETF -> Fixed income, crypto -> Crypto, cash holding/account/sweep -> Cash, unknown stock -> Equities", () => {
    // byHolding ids are positional: h0 stock, h1 bond ETF, h2 crypto, h3 cash holding.
    const breakdown = makeBreakdown(
      [
        { unrealizedPnl: 0n, costBasis: 0n, marketValue: 60000n },
        { unrealizedPnl: 0n, costBasis: 0n, marketValue: 20000n },
        { unrealizedPnl: 0n, costBasis: 0n, marketValue: 10000n },
        { unrealizedPnl: 0n, costBasis: 0n, marketValue: 5000n },
      ],
      [],
    );
    const withKinds: NetWorthBreakdown = {
      ...breakdown,
      byAccountKind: {
        cash: dec(3000n),
        // investment value = holdings (95000) + 2000 cash sweep
        investment: dec(97000n),
        liability: dec(0n),
        manualAsset: dec(40000n),
      },
    };

    const holdings = [
      makeHolding({ id: "h0", ticker: "VOO", assetType: "stock" }),
      makeHolding({ id: "h1", ticker: "BND", assetType: "stock" }),
      makeHolding({ id: "h2", ticker: "BTC", assetType: "crypto" }),
      makeHolding({ id: "h3", ticker: "SGOV", assetType: "stock" }),
    ];
    const profiles = new Map<string, SymbolProfileEntry>([
      ["BND", profile("BND", { assetClass: "fixed_income" })],
      ["SGOV", profile("SGOV", { assetClass: "cash" })],
      // VOO has no profile -> unknown stock -> Equities.
    ]);

    const slices = buildClassSlices({ breakdown: withKinds, holdings, profilesByTicker: profiles });
    const byLabel = new Map(slices.map((s) => [s.label, s.value.toMinorUnits()]));

    expect(byLabel.get("Equities")).toBe(60000n);
    expect(byLabel.get("Fixed income")).toBe(20000n);
    expect(byLabel.get("Crypto")).toBe(10000n);
    // Cash = cash accounts (3000) + sweep (2000) + cash holding (5000) = 10000
    expect(byLabel.get("Cash")).toBe(10000n);
    // Property (manual assets) is excluded from the invested-plus-cash mix.
    expect(byLabel.has("Property")).toBe(false);
    // Sorted desc by value.
    expect(slices.map((s) => s.label)).toEqual(["Equities", "Fixed income", "Crypto", "Cash"]);
  });

  it("drops zero/negative buckets", () => {
    const breakdown = makeBreakdown(
      [{ unrealizedPnl: 0n, costBasis: 0n, marketValue: 50000n }],
      [],
    );
    const withKinds: NetWorthBreakdown = {
      ...breakdown,
      byAccountKind: {
        cash: dec(0n),
        investment: dec(50000n),
        liability: dec(0n),
        manualAsset: dec(0n),
      },
    };
    const holdings = [makeHolding({ id: "h0", ticker: "VOO", assetType: "stock" })];
    const slices = buildClassSlices({
      breakdown: withKinds,
      holdings,
      profilesByTicker: new Map(),
    });
    expect(slices.map((s) => s.label)).toEqual(["Equities"]);
  });
});

describe("buildSectorSlices", () => {
  it("groups stocks by sector, bonds -> Fixed income, crypto -> Crypto, sector-less stock -> Other equities", () => {
    const breakdown = makeBreakdown(
      [
        { unrealizedPnl: 0n, costBasis: 0n, marketValue: 40000n }, // h0 tech
        { unrealizedPnl: 0n, costBasis: 0n, marketValue: 15000n }, // h1 tech
        { unrealizedPnl: 0n, costBasis: 0n, marketValue: 20000n }, // h2 bond
        { unrealizedPnl: 0n, costBasis: 0n, marketValue: 10000n }, // h3 crypto
        { unrealizedPnl: 0n, costBasis: 0n, marketValue: 5000n }, // h4 no sector
      ],
      [],
    );
    const holdings = [
      makeHolding({ id: "h0", ticker: "AAPL", assetType: "stock" }),
      makeHolding({ id: "h1", ticker: "MSFT", assetType: "stock" }),
      makeHolding({ id: "h2", ticker: "BND", assetType: "stock" }),
      makeHolding({ id: "h3", ticker: "BTC", assetType: "crypto" }),
      makeHolding({ id: "h4", ticker: "PRIV", assetType: "stock" }),
    ];
    const profiles = new Map<string, SymbolProfileEntry>([
      ["AAPL", profile("AAPL", { sector: "Technology" })],
      ["MSFT", profile("MSFT", { sector: "Technology" })],
      ["BND", profile("BND", { assetClass: "fixed_income" })],
      // PRIV has no sector and no profile entry -> Other equities.
    ]);

    const slices = buildSectorSlices({ breakdown, holdings, profilesByTicker: profiles });
    const byLabel = new Map(slices.map((s) => [s.label, s.value.toMinorUnits()]));

    expect(byLabel.get("Technology")).toBe(55000n);
    expect(byLabel.get("Fixed income")).toBe(20000n);
    expect(byLabel.get("Crypto")).toBe(10000n);
    expect(byLabel.get("Other equities")).toBe(5000n);
    // Cash and property never appear in the sector view.
    expect(byLabel.has("Cash")).toBe(false);
    expect(slices.map((s) => s.label)).toEqual([
      "Technology",
      "Fixed income",
      "Crypto",
      "Other equities",
    ]);
  });

  it("resolves a proxied holding's sector via its proxy ticker", () => {
    // The holding's own ticker has no profile; only the proxy does. The sector
    // must still be found through the proxy fallback.
    const breakdown = makeBreakdown(
      [{ unrealizedPnl: 0n, costBasis: 0n, marketValue: 30000n }],
      [],
    );
    const holdings = [
      makeHolding({ id: "h0", ticker: "FZROX", assetType: "stock", proxyTicker: "VTI" }),
    ];
    const profiles = new Map<string, SymbolProfileEntry>([
      ["VTI", profile("VTI", { sector: "Technology" })],
    ]);

    const slices = buildSectorSlices({ breakdown, holdings, profilesByTicker: profiles });
    const byLabel = new Map(slices.map((s) => [s.label, s.value.toMinorUnits()]));
    expect(byLabel.get("Technology")).toBe(30000n);
    expect(byLabel.has("Other equities")).toBe(false);
  });

  it("splits a fund across its sector weightings and merges with same-sector stocks", () => {
    const breakdown = makeBreakdown(
      [
        { unrealizedPnl: 0n, costBasis: 0n, marketValue: 100000n }, // h0 VTI fund ($1,000)
        { unrealizedPnl: 0n, costBasis: 0n, marketValue: 10000n }, // h1 AAPL stock ($100)
      ],
      [],
    );
    const holdings = [
      makeHolding({ id: "h0", ticker: "VTI", assetType: "stock" }),
      makeHolding({ id: "h1", ticker: "AAPL", assetType: "stock" }),
    ];
    const profiles = new Map<string, SymbolProfileEntry>([
      [
        "VTI",
        profile("VTI", {
          assetClass: "etf",
          sectorWeightings: [
            { sector: "Technology", weight: 0.3 },
            { sector: "Healthcare", weight: 0.2 },
            { sector: "Energy", weight: 0.5 },
          ],
        }),
      ],
      ["AAPL", profile("AAPL", { sector: "Technology" })],
    ]);

    const slices = buildSectorSlices({ breakdown, holdings, profilesByTicker: profiles });
    const byLabel = new Map(slices.map((s) => [s.label, s.value.toMinorUnits()]));

    // VTI: 30% tech $300 + AAPL $100 tech = $400; 20% health $200; 50% energy $500.
    expect(byLabel.get("Technology")).toBe(40000n);
    expect(byLabel.get("Healthcare")).toBe(20000n);
    expect(byLabel.get("Energy")).toBe(50000n);
  });
});

describe("estimatedIncome", () => {
  it("a holding with a yield contributes marketValue * yield to annual income", () => {
    // h0: $1,000 market value at 1.37% yield = $13.70 = 1370 cents.
    const breakdown = makeBreakdown([{ unrealizedPnl: 0n, costBasis: 0n, marketValue: 100000n }]);
    const holdings = [makeHolding({ id: "h0", ticker: "SCHD", assetType: "stock" })];
    const profiles = new Map<string, SymbolProfileEntry>([
      ["SCHD", profile("SCHD", { dividendYield: "0.0137", displayName: "Schwab Dividend" })],
    ]);

    const result = estimatedIncome({ breakdown, holdings, profilesByTicker: profiles });

    expect(result.annualCents.toMinorUnits()).toBe(1370n);
    expect(result.payers).toHaveLength(1);
    expect(result.payers[0].ticker).toBe("SCHD");
    expect(result.payers[0].name).toBe("Schwab Dividend");
    expect(result.payers[0].yield).toBeCloseTo(0.0137, 6);
    // portfolioYield = 1370 / 100000 = 0.0137.
    expect(result.portfolioYield).toBeCloseTo(0.0137, 6);
    // monthly = 1370 / 12 = 114.166... -> 114 cents (banker's rounding).
    expect(result.monthlyCents.toMinorUnits()).toBe(114n);
  });

  it("resolves a proxied holding's yield via the proxy and rolls it into the proxy payer row", () => {
    // Holding ticker has no profile; the proxy carries the yield. Income must
    // still accrue and the payer row uses the proxy ticker.
    const breakdown = makeBreakdown([{ unrealizedPnl: 0n, costBasis: 0n, marketValue: 100000n }]);
    const holdings = [
      makeHolding({ id: "h0", ticker: "FZILX", assetType: "stock", proxyTicker: "VXUS" }),
    ];
    const profiles = new Map<string, SymbolProfileEntry>([
      ["VXUS", profile("VXUS", { dividendYield: "0.03", displayName: "Vanguard ex-US" })],
    ]);

    const result = estimatedIncome({ breakdown, holdings, profilesByTicker: profiles });

    expect(result.annualCents.toMinorUnits()).toBe(3000n);
    expect(result.payers).toHaveLength(1);
    expect(result.payers[0].ticker).toBe("VXUS");
    expect(result.payers[0].name).toBe("Vanguard ex-US");
  });

  it("excludes holdings with no yield from income and payers", () => {
    const breakdown = makeBreakdown([
      { unrealizedPnl: 0n, costBasis: 0n, marketValue: 100000n },
      { unrealizedPnl: 0n, costBasis: 0n, marketValue: 200000n },
    ]);
    const holdings = [
      makeHolding({ id: "h0", ticker: "SCHD", assetType: "stock" }),
      makeHolding({ id: "h1", ticker: "GOOGL", assetType: "stock" }),
    ];
    const profiles = new Map<string, SymbolProfileEntry>([
      ["SCHD", profile("SCHD", { dividendYield: "0.0137" })],
      // GOOGL has no dividendYield -> excluded.
      ["GOOGL", profile("GOOGL", { sector: "Technology" })],
    ]);

    const result = estimatedIncome({ breakdown, holdings, profilesByTicker: profiles });

    expect(result.payers.map((p) => p.ticker)).toEqual(["SCHD"]);
    expect(result.annualCents.toMinorUnits()).toBe(1370n);
    // portfolioYield divides by the full $3,000 market value: 1370 / 300000.
    expect(result.portfolioYield).toBeCloseTo(1370 / 300000, 8);
  });

  it("sorts payers descending by annual income", () => {
    const breakdown = makeBreakdown([
      { unrealizedPnl: 0n, costBasis: 0n, marketValue: 100000n }, // h0: 1.0% -> $10
      { unrealizedPnl: 0n, costBasis: 0n, marketValue: 500000n }, // h1: 1.3% -> $65
      { unrealizedPnl: 0n, costBasis: 0n, marketValue: 200000n }, // h2: 3.7% -> $74
    ]);
    const holdings = [
      makeHolding({ id: "h0", ticker: "VTI", assetType: "stock" }),
      makeHolding({ id: "h1", ticker: "VOO", assetType: "stock" }),
      makeHolding({ id: "h2", ticker: "BND", assetType: "stock" }),
    ];
    const profiles = new Map<string, SymbolProfileEntry>([
      ["VTI", profile("VTI", { dividendYield: "0.01" })],
      ["VOO", profile("VOO", { dividendYield: "0.013" })],
      ["BND", profile("BND", { dividendYield: "0.037" })],
    ]);

    const result = estimatedIncome({ breakdown, holdings, profilesByTicker: profiles });

    expect(result.payers.map((p) => p.ticker)).toEqual(["BND", "VOO", "VTI"]);
    expect(result.payers.map((p) => p.annualCents.toMinorUnits())).toEqual([7400n, 6500n, 1000n]);
  });

  it("returns empty payers and zero income for a zero-yield portfolio", () => {
    const breakdown = makeBreakdown([{ unrealizedPnl: 0n, costBasis: 0n, marketValue: 100000n }]);
    const holdings = [makeHolding({ id: "h0", ticker: "GOOGL", assetType: "stock" })];
    const profiles = new Map<string, SymbolProfileEntry>([
      ["GOOGL", profile("GOOGL", { sector: "Technology" })],
    ]);

    const result = estimatedIncome({ breakdown, holdings, profilesByTicker: profiles });

    expect(result.payers).toHaveLength(0);
    expect(result.annualCents.isZero()).toBe(true);
    expect(result.monthlyCents.isZero()).toBe(true);
    expect(result.portfolioYield).toBe(0);
  });

  it("adds cash-account interest as a payer and blends the yield denominator", () => {
    // Holding SCHD $1,000 @ 1.37% = $13.70. Cash $10,000 @ 4% = $400.
    const breakdown = makeBreakdown([{ unrealizedPnl: 0n, costBasis: 0n, marketValue: 100000n }]);
    const holdings = [makeHolding({ id: "h0", ticker: "SCHD", assetType: "stock" })];
    const profiles = new Map<string, SymbolProfileEntry>([
      ["SCHD", profile("SCHD", { dividendYield: "0.0137", displayName: "Schwab Dividend" })],
    ]);
    const cash = makeCashAccountWith({
      id: "c1",
      name: "Ally Savings",
      balanceCents: "1000000",
      apy: "0.04",
    });

    const result = estimatedIncome({
      breakdown,
      accounts: [cash],
      holdings,
      profilesByTicker: profiles,
    });

    // annual = 1370 (dividend) + 40000 (interest) = 41370 cents.
    expect(result.annualCents.toMinorUnits()).toBe(41370n);
    // CASH ($400) outranks SCHD ($13.70).
    expect(result.payers.map((p) => p.ticker)).toEqual(["CASH", "SCHD"]);
    const cashPayer = result.payers[0];
    expect(cashPayer.id).toBe("cash:c1");
    expect(cashPayer.name).toBe("Ally Savings");
    expect(cashPayer.annualCents.toMinorUnits()).toBe(40000n);
    expect(cashPayer.yield).toBeCloseTo(0.04, 6);
    // Blended yield = 41370 / (100000 holdings + 1000000 cash).
    expect(result.portfolioYield).toBeCloseTo(41370 / 1100000, 8);
  });

  it("includes investment cash-sweep interest", () => {
    // Sweep $5,000 @ 4.5% = $225, no holdings.
    const breakdown = makeBreakdown([]);
    const sweepAccount: Account = {
      ...makeInvestmentAccount({ id: "i1", name: "Fidelity", subKind: "brokerage" }),
      payload: {
        kind: "investment",
        subKind: "brokerage",
        name: "Fidelity",
        cashBalanceCents: "500000",
        currency: "USD",
        assetType: "stock",
        apy: "0.045",
      },
    } as Account;

    const result = estimatedIncome({
      breakdown,
      accounts: [sweepAccount],
      holdings: [],
      profilesByTicker: new Map(),
    });

    expect(result.annualCents.toMinorUnits()).toBe(22500n);
    expect(result.payers).toHaveLength(1);
    expect(result.payers[0].id).toBe("cash:i1");
    expect(result.payers[0].ticker).toBe("CASH");
    expect(result.portfolioYield).toBeCloseTo(0.045, 6);
  });

  it("counts cash with no APY in the denominator but not as income or a payer", () => {
    const breakdown = makeBreakdown([{ unrealizedPnl: 0n, costBasis: 0n, marketValue: 100000n }]);
    const holdings = [makeHolding({ id: "h0", ticker: "SCHD", assetType: "stock" })];
    const profiles = new Map<string, SymbolProfileEntry>([
      ["SCHD", profile("SCHD", { dividendYield: "0.0137" })],
    ]);
    const idleCash = makeCashAccountWith({ id: "c1", name: "Checking", balanceCents: "1000000" });

    const result = estimatedIncome({
      breakdown,
      accounts: [idleCash],
      holdings,
      profilesByTicker: profiles,
    });

    expect(result.payers.map((p) => p.ticker)).toEqual(["SCHD"]);
    expect(result.annualCents.toMinorUnits()).toBe(1370n);
    // Idle cash still dilutes the blended yield: 1370 / (100000 + 1000000).
    expect(result.portfolioYield).toBeCloseTo(1370 / 1100000, 8);
  });

  it("ignores APY on a zero-balance cash account", () => {
    const breakdown = makeBreakdown([]);
    const emptyCash = makeCashAccountWith({
      id: "c1",
      name: "New HYSA",
      balanceCents: "0",
      apy: "0.05",
    });

    const result = estimatedIncome({
      breakdown,
      accounts: [emptyCash],
      holdings: [],
      profilesByTicker: new Map(),
    });

    expect(result.payers).toHaveLength(0);
    expect(result.annualCents.isZero()).toBe(true);
    expect(result.portfolioYield).toBe(0);
  });
});
