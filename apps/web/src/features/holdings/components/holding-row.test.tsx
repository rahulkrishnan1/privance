import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LocalGroup, LocalHolding } from "../types";
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
    costBasisCents: "15000",
    scaleFactor: undefined,
    proxyAnchoredAt: undefined,
    name: undefined,
    updatedAt: 0,
    ...overrides,
  };
}

const EMPTY_PRICES = new Map<string, { ticker: string; price: string }>();
const EMPTY_GROUPS: LocalGroup[] = [];

function renderRow(isExpanded: boolean): string {
  return renderToStaticMarkup(
    <table>
      <tbody>
        <HoldingRow
          holding={makeHolding()}
          accountName="Brokerage"
          groups={EMPTY_GROUPS}
          prices={EMPTY_PRICES}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          isExpanded={isExpanded}
          onToggle={vi.fn()}
        />
      </tbody>
    </table>,
  );
}

describe("HoldingRow mobile sub-row", () => {
  it("renders a sub-row with colSpan=9999 when expanded", () => {
    const html = renderRow(true);
    // React's static renderer keeps the JSX-cased attribute; lowercase by
    // browsers at parse time. Match either so the assertion survives a
    // future React renderer change.
    expect(html).toMatch(/col[Ss]pan="9999"/);
  });

  it("marks the sub-row md:hidden so it only shows on mobile", () => {
    const html = renderRow(true);
    // The sub-row tr carries md:hidden; assert both attribute and class
    // appear so a future refactor that drops either is caught.
    expect(html).toMatch(/<tr[^>]*md:hidden[^>]*>/);
  });

  it("omits the sub-row when not expanded", () => {
    const html = renderRow(false);
    expect(html).not.toMatch(/col[Ss]pan="9999"/);
  });
});
