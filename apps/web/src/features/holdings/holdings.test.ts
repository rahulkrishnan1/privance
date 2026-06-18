import { Decimal, SCALE_CRYPTO } from "@privance/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMarketValue } from "@/lib/market-value";
import {
  clearStaleProxyAnchor,
  computeAnchorScaleFactor,
  filterHoldings,
  lookupProxyPrice,
  sortHoldings,
} from "./_helpers";
import { getSavedSort, saveSort } from "./_sort-prefs";
import type { LocalHolding } from "./types";
import { holdingFormSchema } from "./types";

function makeHolding(overrides: Partial<LocalHolding> = {}): LocalHolding {
  return {
    id: crypto.randomUUID(),
    accountId: "acc-1",
    groupId: null,
    ticker: "AAPL",
    assetType: "stock",
    proxyTicker: null,
    sharesMajor: "10",
    sharesScale: 8,
    costBasisCents: "15000",
    scaleFactor: undefined,
    proxyAnchoredAt: undefined,
    name: undefined,
    updatedAt: Date.now(),
    ...overrides,
  };
}

const EMPTY_PRICES = new Map<string, { ticker: string; price: string }>();

describe("holdingFormSchema", () => {
  it("accepts a valid stock holding", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "stock",
      ticker: "AAPL",
      accountId: "acc-1",
      shares: "10.5",
      avgCostPerShare: "150.00",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid crypto holding with a lowercase CoinGecko slug", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "crypto",
      ticker: "bitcoin",
      accountId: "acc-1",
      shares: "0.5",
      avgCostPerShare: "60000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Case normalization happens at submit time, not in the schema.
      expect(result.data.ticker).toBe("bitcoin");
    }
  });

  it("rejects empty ticker", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "stock",
      ticker: "",
      accountId: "acc-1",
      shares: "1",
      avgCostPerShare: "100",
    });
    expect(result.success).toBe(false);
  });

  it("rejects ticker longer than 64 chars", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "stock",
      ticker: "A".repeat(65),
      accountId: "acc-1",
      shares: "1",
      avgCostPerShare: "100",
    });
    expect(result.success).toBe(false);
  });

  it("rejects shares of zero", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "stock",
      ticker: "AAPL",
      accountId: "acc-1",
      shares: "0",
      avgCostPerShare: "100",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative shares", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "stock",
      ticker: "AAPL",
      accountId: "acc-1",
      shares: "-1",
      avgCostPerShare: "100",
    });
    expect(result.success).toBe(false);
  });

  it("accepts zero cost basis (free/gifted assets)", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "stock",
      ticker: "VOO",
      accountId: "acc-1",
      shares: "5",
      avgCostPerShare: "0",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a blank cost basis (optional)", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "stock",
      ticker: "VOO",
      accountId: "acc-1",
      shares: "5",
      avgCostPerShare: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-numeric shares", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "stock",
      ticker: "AAPL",
      accountId: "acc-1",
      shares: "abc",
      avgCostPerShare: "100",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty accountId", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "stock",
      ticker: "AAPL",
      accountId: "",
      shares: "1",
      avgCostPerShare: "100",
    });
    expect(result.success).toBe(false);
  });

  it("uppercases proxy ticker", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "stock",
      ticker: "FXAIX",
      accountId: "acc-1",
      shares: "1",
      avgCostPerShare: "100",
      proxyTicker: "voo",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.proxyTicker).toBe("VOO");
    }
  });

  it("rejects an invalid asset type", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "real_estate",
      ticker: "AAPL",
      accountId: "acc-1",
      shares: "1",
      avgCostPerShare: "100",
    });
    expect(result.success).toBe(false);
  });
});

describe("filterHoldings", () => {
  const h1 = makeHolding({ accountId: "acc-1", groupId: "grp-A" });
  const h2 = makeHolding({ accountId: "acc-2", groupId: "grp-B" });
  const h3 = makeHolding({ accountId: "acc-1", groupId: null });

  it("all filter returns everything", () => {
    expect(filterHoldings([h1, h2, h3], { kind: "all" })).toHaveLength(3);
  });

  it("account filter returns only matching accountId", () => {
    const result = filterHoldings([h1, h2, h3], { kind: "account", accountId: "acc-1" });
    expect(result).toHaveLength(2);
    expect(result.every((h) => h.accountId === "acc-1")).toBe(true);
  });

  it("group filter returns only matching groupId", () => {
    const result = filterHoldings([h1, h2, h3], { kind: "group", groupId: "grp-A" });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(h1.id);
  });

  it("group filter excludes null groupId holdings", () => {
    const result = filterHoldings([h1, h2, h3], { kind: "group", groupId: "grp-B" });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(h2.id);
  });

  it("account filter returns empty when no match", () => {
    expect(filterHoldings([h1, h2], { kind: "account", accountId: "acc-99" })).toHaveLength(0);
  });
});

describe("sortHoldings", () => {
  const alpha = makeHolding({ ticker: "AAPL", sharesMajor: "5", sharesScale: 2 });
  const beta = makeHolding({ ticker: "VXUS", sharesMajor: "20", sharesScale: 2 });

  it("sorts by ticker ascending", () => {
    const result = sortHoldings(
      [beta, alpha],
      { column: "ticker", direction: "asc" },
      EMPTY_PRICES,
    );
    expect(result[0]?.ticker).toBe("AAPL");
    expect(result[1]?.ticker).toBe("VXUS");
  });

  it("sorts by ticker descending", () => {
    const result = sortHoldings(
      [alpha, beta],
      { column: "ticker", direction: "desc" },
      EMPTY_PRICES,
    );
    expect(result[0]?.ticker).toBe("VXUS");
  });

  it("sorts by gain dollar ascending (all zero prices, identical gain, stable)", () => {
    const result = sortHoldings(
      [beta, alpha],
      { column: "gainDollar", direction: "asc" },
      EMPTY_PRICES,
    );
    expect(result).toHaveLength(2);
  });

  it("sorts by market value descending (all zero prices)", () => {
    const result = sortHoldings(
      [alpha, beta],
      { column: "marketValue", direction: "desc" },
      EMPTY_PRICES,
    );
    expect(result).toHaveLength(2);
  });

  it("sorts by market value with prices", () => {
    const prices = new Map([
      ["AAPL", { ticker: "AAPL", price: "400.000000" }],
      ["VXUS", { ticker: "VXUS", price: "50.000000" }],
    ]);
    const result = sortHoldings(
      [beta, alpha],
      { column: "marketValue", direction: "desc" },
      prices,
    );
    expect(result[0]?.ticker).toBe("AAPL");
  });

  it("does not mutate original array", () => {
    const original = [beta, alpha];
    sortHoldings(original, { column: "ticker", direction: "asc" }, EMPTY_PRICES);
    expect(original[0]?.ticker).toBe("VXUS");
  });

  it("sorts by weight ascending (same as marketValue with prices)", () => {
    const prices = new Map([
      ["AAPL", { ticker: "AAPL", price: "400.000000" }],
      ["VXUS", { ticker: "VXUS", price: "50.000000" }],
    ]);
    // AAPL: 10 shares * $400 = $4000; VXUS: 5 shares * $50 = $250
    // asc: VXUS first
    const result = sortHoldings([alpha, beta], { column: "weight", direction: "asc" }, prices);
    expect(result[0]?.ticker).toBe("VXUS");
    expect(result[1]?.ticker).toBe("AAPL");
  });
});

describe("computeAnchorScaleFactor", () => {
  it("anchors to the user-supplied NAV against the current proxy price", () => {
    // If real asset is currently $310 / share and VOO is $679.44,
    // scaleFactor = 310 / 679.44. proxy_price * scaleFactor rounds back to 310.
    const sf = computeAnchorScaleFactor("310", "679.44");
    const proxyPrice = Decimal.fromString("679.44", SCALE_CRYPTO);
    const effective = proxyPrice.mul(Decimal.fromString(sf, SCALE_CRYPTO), {
      resultScale: 2,
    });
    expect(effective.toString()).toBe("310.00");
  });

  it("throws when NAV is zero", () => {
    expect(() => computeAnchorScaleFactor("0", "100")).toThrow();
  });

  it("throws when proxy price is zero", () => {
    expect(() => computeAnchorScaleFactor("100", "0")).toThrow();
  });

  it("throws on malformed numbers", () => {
    expect(() => computeAnchorScaleFactor("not-a-price", "100")).toThrow();
  });
});

describe("proxy market value anchors to the entered price, not the proxy's raw price", () => {
  // 10 shares of an asset worth $100/share, proxied to VOO trading at $200.
  const scaleFactor = computeAnchorScaleFactor("100", "200"); // 0.5
  const holding = {
    ticker: "FAKECIT",
    proxyTicker: "VOO",
    sharesMajor: "10",
    sharesScale: 8,
    scaleFactor,
  };

  it("anchors to nav at anchor time", () => {
    const prices = new Map([["VOO", { ticker: "VOO", price: "200" }]]);
    // 10 * 200 * 0.5 = 1000 (= 10 * the $100 nav), NOT 10 * 200 = 2000.
    expect(getMarketValue(holding, prices).toFloat()).toBeCloseTo(1000, 2);
  });

  it("tracks proportionally as the proxy moves", () => {
    const prices = new Map([["VOO", { ticker: "VOO", price: "220" }]]); // VOO +10%
    expect(getMarketValue(holding, prices).toFloat()).toBeCloseTo(1100, 2);
  });
});

describe("clearStaleProxyAnchor", () => {
  it("drops scaleFactor and proxyAnchoredAt when the proxy ticker is removed", () => {
    // Reproduces the edit-removes-proxy corruption: without clearing, the real
    // ticker price would be multiplied by the dead scale factor.
    const cleaned = clearStaleProxyAnchor({
      proxyTicker: null,
      scaleFactor: "0.456",
      proxyAnchoredAt: "2026-05-01",
      ticker: "VTSAX",
    });
    expect(cleaned).not.toHaveProperty("scaleFactor");
    expect(cleaned).not.toHaveProperty("proxyAnchoredAt");
    expect(cleaned.ticker).toBe("VTSAX");
  });

  it("keeps anchor metadata while a proxy ticker is still set", () => {
    const cleaned = clearStaleProxyAnchor({
      proxyTicker: "VTI",
      scaleFactor: "0.456",
      proxyAnchoredAt: "2026-05-01",
      ticker: "VTSAX",
    });
    expect(cleaned.scaleFactor).toBe("0.456");
    expect(cleaned.proxyAnchoredAt).toBe("2026-05-01");
  });
});

function makeRefresh(prices: Array<{ ticker: string; price: string }>) {
  return vi.fn().mockResolvedValue({
    prices: prices.map((e) => ({ ...e, fetchedAt: "2026-05-17T00:00:00Z" })),
    unknown: [],
  });
}

describe("lookupProxyPrice", () => {
  it("returns the cached string without fetching when a cache hit exists", async () => {
    const refresh = vi.fn();
    const warm = vi.fn();
    const result = await lookupProxyPrice("VOO", "679.44", refresh, warm);
    expect(result).toBe("679.44");
    expect(refresh).not.toHaveBeenCalled();
    expect(warm).not.toHaveBeenCalled();
  });

  it("fetches, warms the cache, and returns the price on a cache miss", async () => {
    const refresh = makeRefresh([{ ticker: "VOO", price: "679.44" }]);
    const warm = vi.fn();
    const result = await lookupProxyPrice("VOO", undefined, refresh, warm);
    expect(result).toBe("679.44");
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(["VOO"]);
    expect(warm).toHaveBeenCalledOnce();
    const [calledTicker, calledDecimal] = warm.mock.calls[0] as [string, Decimal];
    expect(calledTicker).toBe("VOO");
    expect(calledDecimal.toString()).toBe("679.44000000");
  });

  it("returns null when the server lists the ticker as unknown", async () => {
    const refresh = vi.fn().mockResolvedValue({ prices: [], unknown: ["VOO"] });
    const warm = vi.fn();
    const result = await lookupProxyPrice("VOO", undefined, refresh, warm);
    expect(result).toBeNull();
    expect(warm).not.toHaveBeenCalled();
  });

  it("returns null when the network call throws", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("network failure"));
    const warm = vi.fn();
    const result = await lookupProxyPrice("VOO", undefined, refresh, warm);
    expect(result).toBeNull();
    expect(warm).not.toHaveBeenCalled();
  });

  it("returns null when server returns ticker in different case", async () => {
    const refresh = makeRefresh([{ ticker: "voo", price: "679.44" }]);
    const warm = vi.fn();
    const result = await lookupProxyPrice("VOO", undefined, refresh, warm);
    expect(result).toBeNull();
    expect(warm).not.toHaveBeenCalled();
  });
});

describe("getSavedSort / saveSort key scoping", () => {
  const mockStorage: Record<string, string> = {};

  afterEach(() => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
  });

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
    });
  });

  it("saves under a user-scoped key", () => {
    saveSort("user-1", { column: "ticker", direction: "asc" });
    expect(Object.keys(mockStorage)).toContain("holdings.sort.user-1");
    expect(Object.keys(mockStorage)).not.toContain("holdings.sort");
  });

  it("two users do not read each other's sort", () => {
    saveSort("user-a", { column: "ticker", direction: "asc" });
    saveSort("user-b", { column: "gainDollar", direction: "desc" });
    const a = getSavedSort("user-a");
    const b = getSavedSort("user-b");
    expect(a.column).toBe("ticker");
    expect(b.column).toBe("gainDollar");
  });

  it("returns the module-level default when userId is undefined", () => {
    const result = getSavedSort(undefined);
    expect(result).toBeDefined();
  });

  it("does not write to localStorage when userId is undefined", () => {
    saveSort(undefined, { column: "ticker", direction: "asc" });
    expect(Object.keys(mockStorage)).toHaveLength(0);
  });
});
