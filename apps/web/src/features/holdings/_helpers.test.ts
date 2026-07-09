import { Decimal, SCALE_CENTS } from "@privance/core";
import { describe, expect, test } from "vitest";
import { computeAvgCost, getTotalCost, sortByValueDesc } from "./_helpers";
import type { LocalHolding } from "./types";

const dollars = (n: string) => Decimal.fromString(n, SCALE_CENTS);

function makeHolding(overrides: Partial<LocalHolding> = {}): LocalHolding {
  return {
    id: "h-1",
    accountId: "acc-1",
    groupId: null,
    ticker: "AAPL",
    assetType: "stock",
    proxyTicker: null,
    sharesMajor: "10",
    sharesScale: 8,
    costBasisCents: "100000",
    scaleFactor: undefined,
    proxyAnchoredAt: undefined,
    name: undefined,
    updatedAt: 0,
    ...overrides,
  };
}

describe("sortByValueDesc", () => {
  test("orders by descending value, biggest first", () => {
    const items = [
      { id: "a", name: "Alpha", value: dollars("100") },
      { id: "b", name: "Bravo", value: dollars("300") },
      { id: "c", name: "Charlie", value: dollars("200") },
    ];
    const sorted = sortByValueDesc(
      items,
      (i) => i.value,
      (i) => i.name,
    );
    expect(sorted.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  test("breaks value ties by name ascending", () => {
    const items = [
      { name: "Zulu", value: dollars("50") },
      { name: "Alpha", value: dollars("50") },
    ];
    const sorted = sortByValueDesc(
      items,
      (i) => i.value,
      (i) => i.name,
    );
    expect(sorted.map((i) => i.name)).toEqual(["Alpha", "Zulu"]);
  });

  test("returns a new array and leaves the input order untouched", () => {
    const items = [
      { name: "A", value: dollars("1") },
      { name: "B", value: dollars("2") },
    ];
    const sorted = sortByValueDesc(
      items,
      (i) => i.value,
      (i) => i.name,
    );
    expect(sorted).not.toBe(items);
    expect(items.map((i) => i.name)).toEqual(["A", "B"]);
  });
});

describe("getTotalCost", () => {
  test("returns the parsed cost basis for a valid integer-cents string", () => {
    expect(getTotalCost(makeHolding({ costBasisCents: "100000" }))?.toString()).toBe("1000.00");
  });

  test("parses the legacy dollar-decimal format", () => {
    expect(getTotalCost(makeHolding({ costBasisCents: "1500.00" }))?.toString()).toBe("1500.00");
  });

  test("returns null when the stored cost basis is malformed", () => {
    expect(getTotalCost(makeHolding({ costBasisCents: "not-a-number" }))).toBeNull();
  });
});

describe("computeAvgCost", () => {
  test("divides total cost by share count", () => {
    // $1,000 over 10 shares = $100 per share.
    expect(computeAvgCost(makeHolding({ costBasisCents: "100000", sharesMajor: "10" }))).toBe(100);
  });

  test("returns null when shares are zero", () => {
    expect(computeAvgCost(makeHolding({ sharesMajor: "0" }))).toBeNull();
  });

  test("returns null when the cost basis is malformed", () => {
    expect(computeAvgCost(makeHolding({ costBasisCents: "not-a-number" }))).toBeNull();
  });

  test("returns 0 for a zero cost basis with nonzero shares (not null)", () => {
    expect(computeAvgCost(makeHolding({ costBasisCents: "0", sharesMajor: "10" }))).toBe(0);
  });
});
