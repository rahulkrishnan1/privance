import { Decimal, SCALE_CENTS } from "@privance/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LocalHolding } from "../types";
import { HoldingRow } from "./holding-row";

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
    name: "Apple Inc.",
    updatedAt: 0,
    ...overrides,
  };
}

const EMPTY_PRICES = new Map<string, { ticker: string; price: string }>();

function renderRow(
  holdingOverrides: Partial<LocalHolding> = {},
  prices = EMPTY_PRICES,
  dayChangeCents: Decimal | null = null,
  totalInvestmentsCents: Decimal | null = null,
): string {
  return renderToStaticMarkup(
    <table>
      <tbody>
        <HoldingRow
          holding={makeHolding(holdingOverrides)}
          prices={prices}
          dayChangeCents={dayChangeCents}
          totalInvestmentsCents={totalInvestmentsCents}
          onRowClick={vi.fn()}
        />
      </tbody>
    </table>,
  );
}

describe("HoldingRow columns", () => {
  it("renders the ticker in the row", () => {
    const html = renderRow();
    expect(html).toContain("AAPL");
  });

  it("renders the holding name when provided", () => {
    const html = renderRow({ name: "Apple Inc." });
    expect(html).toContain("Apple Inc.");
  });

  it("omits the name line when name is undefined", () => {
    const html = renderRow({ name: undefined });
    expect(html).not.toContain("Apple Inc.");
  });
});

describe("HoldingRow no-price row", () => {
  it("shows 'no price · set one' in the Value cell when no price available", () => {
    const html = renderRow();
    expect(html).toContain("no price · set one");
  });

  it("does not show 'no price · set one' when a price is available", () => {
    const prices = new Map([["AAPL", { ticker: "AAPL", price: "15000000000" }]]);
    const html = renderRow({}, prices);
    expect(html).not.toContain("no price · set one");
  });
});

describe("HoldingRow gain display", () => {
  it("shows a signed gain dollar value when cost basis and price are present", () => {
    // 10 shares @ $200.00/share = $2,000 value; cost basis = $1,000 (100000 cents)
    const prices = new Map([["AAPL", { ticker: "AAPL", price: "200.00000000" }]]);
    const html = renderRow({ costBasisCents: "100000", sharesMajor: "10" }, prices);
    expect(html).toContain("+");
    expect(html).not.toContain("no price · set one");
  });
});

describe("HoldingRow interactivity", () => {
  it("has tabIndex=0 for keyboard navigation", () => {
    const html = renderRow();
    expect(html).toMatch(/<tr[^>]*tabindex="0"[^>]*>/i);
  });

  it("has aria-label including ticker and action description", () => {
    const html = renderRow();
    expect(html).toContain("AAPL");
    expect(html).toContain("open holding details");
  });
});

describe("HoldingRow weight display", () => {
  it("shows the weight bar when totalInvestmentsCents is provided and price available", () => {
    // 10 shares @ $200.00 = $2,000; total = $10,000; weight = 20.0%
    const prices = new Map([["AAPL", { ticker: "AAPL", price: "200.00000000" }]]);
    const total = Decimal.fromMinorUnits(1000000n, SCALE_CENTS); // $10,000
    const html = renderRow({}, prices, null, total);
    expect(html).toContain("20.0%");
  });

  it("shows '-' in weight cell when no price is available", () => {
    const total = Decimal.fromMinorUnits(1000000n, SCALE_CENTS);
    const html = renderRow({}, EMPTY_PRICES, null, total);
    expect(html).not.toMatch(/\d+\.\d+%/);
  });
});

describe("HoldingRow proxy + scaleFactor market value", () => {
  it("renders the correct market value and proxy sub-line for a proxied holding", () => {
    // COMPANY401K proxied via VOO @ $689.20 with scaleFactor 0.07253775.
    // effectivePrice = 689.20 × 0.07253775 = 49.99300730 (exact per Decimal.mul, banker round)
    // marketValue = 100 shares × 49.99300730 = 4999.30 cents (Decimal.mul to SCALE_CENTS)
    // So the formatted value is $4,999.30.
    const prices = new Map([["VOO", { ticker: "VOO", price: "689.20000000" }]]);
    const html = renderRow(
      {
        ticker: "COMPANY401K",
        proxyTicker: "VOO",
        sharesMajor: "100",
        scaleFactor: "0.07253775",
      },
      prices,
    );
    expect(html).toContain("$4,999.30");
    expect(html).not.toContain("no price");
    expect(html).toContain("Proxy");
    expect(html).toContain("VOO");
  });
});

describe("HoldingRow exact gain $ and %", () => {
  it("renders +$1,000.00 and +100.00% for a 100% gain", () => {
    // 10 shares @ $200.00 = $2,000; cost = $1,000 → gain = +$1,000, +100.00%
    const prices = new Map([["AAPL", { ticker: "AAPL", price: "200.00000000" }]]);
    const html = renderRow({ costBasisCents: "100000", sharesMajor: "10" }, prices);
    expect(html).toContain("+$1,000.00");
    expect(html).toContain("+100.00%");
  });

  it("renders -$500.00 for a loss", () => {
    // 10 shares @ $50.00 = $500; cost = $1,000 → gain = -$500
    const prices = new Map([["AAPL", { ticker: "AAPL", price: "50.00000000" }]]);
    const html = renderRow({ costBasisCents: "100000", sharesMajor: "10" }, prices);
    expect(html).toContain("-$500.00");
  });

  it("renders +$1,000.00 gain but no percent line when cost basis is zero", () => {
    // 10 shares @ $100.00 = $1,000; cost basis = $0 → gainPct is null (no percent line)
    const prices = new Map([["AAPL", { ticker: "AAPL", price: "100.00000000" }]]);
    const html = renderRow({ costBasisCents: "0", sharesMajor: "10" }, prices);
    expect(html).toContain("+$1,000.00");
    // A percentage is meaningless with no cost basis, so no percent figure is shown.
    expect(html).not.toMatch(/[\d.]+%/);
  });
});

describe("HoldingRow day change display", () => {
  it("renders day dollar change and correct day percent", () => {
    // 10 shares @ $200.00 = $2,000 MV; dayChange = +$1.50 (150 cents).
    // prior = $2,000 - $1.50 = $1,998.50; dayPct = 1.50 / 1998.50 = 0.000750562...
    // formatSignedPct(0.000750562) = "+0.08%" (0.0750... rounds to 0.08 at 2dp)
    const prices = new Map([["AAPL", { ticker: "AAPL", price: "200.00000000" }]]);
    const dayChange = Decimal.fromMinorUnits(150n, SCALE_CENTS); // +$1.50
    const html = renderRow({ costBasisCents: "100000", sharesMajor: "10" }, prices, dayChange);
    expect(html).toContain("+$1.50");
    expect(html).toContain("+0.08%");
  });
});
