import { Decimal, SCALE_CRYPTO } from "@privance/core";
import { describe, expect, it, vi } from "vitest";
import {
  computeAnchorScaleFactor,
  filterHoldings,
  lookupProxyPrice,
  parseStoredHolding,
  sortHoldings,
} from "./_helpers";
import type { LocalHolding } from "./types";
import { holdingFormSchema } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// holdingFormSchema, validation rules
// ---------------------------------------------------------------------------

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

  it("accepts zero avg cost (free/gifted assets)", () => {
    const result = holdingFormSchema.safeParse({
      assetType: "stock",
      ticker: "VOO",
      accountId: "acc-1",
      shares: "5",
      avgCostPerShare: "0",
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

// ---------------------------------------------------------------------------
// filterHoldings
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// sortHoldings
// ---------------------------------------------------------------------------

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

  it("sorts by shares ascending", () => {
    const result = sortHoldings(
      [beta, alpha],
      { column: "shares", direction: "asc" },
      EMPTY_PRICES,
    );
    expect(result[0]?.sharesMajor).toBe("5");
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
});

// ---------------------------------------------------------------------------
// parseStoredHolding
// ---------------------------------------------------------------------------

describe("parseStoredHolding", () => {
  it("round-trips a holding payload", () => {
    const payload = {
      accountId: "acc-1",
      groupId: null,
      ticker: "VOO",
      assetType: "stock" as const,
      proxyTicker: null,
      sharesMajor: "42.5",
      sharesScale: 8,
      costBasisCents: "500000",
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const result = parseStoredHolding("id-1", bytes, 12345);

    expect(result.id).toBe("id-1");
    expect(result.ticker).toBe("VOO");
    expect(result.sharesMajor).toBe("42.5");
    expect(result.costBasisCents).toBe("500000");
    expect(result.updatedAt).toBe(12345);
    expect(result.groupId).toBeNull();
  });

  it("preserves optional fields when present", () => {
    const payload = {
      accountId: "acc-2",
      groupId: "grp-X",
      ticker: "FXAIX",
      assetType: "stock" as const,
      proxyTicker: "VOO",
      sharesMajor: "10",
      sharesScale: 4,
      costBasisCents: "100000",
      scaleFactor: "1.05",
      name: "Fidelity 500 Index",
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const result = parseStoredHolding("id-2", bytes, 0);

    expect(result.proxyTicker).toBe("VOO");
    expect(result.scaleFactor).toBe("1.05");
    expect(result.name).toBe("Fidelity 500 Index");
  });
});

// ---------------------------------------------------------------------------
// computeAnchorScaleFactor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// lookupProxyPrice
// ---------------------------------------------------------------------------

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
});
