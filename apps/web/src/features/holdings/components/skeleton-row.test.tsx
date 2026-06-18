import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LocalHolding } from "../types";
import { HoldingRow } from "./holding-row";
import { SkeletonRow, SkeletonRows } from "./skeleton-row";

// Extract each <td>'s mobile-hidden flag, in column order, so the skeleton can
// be checked against the real row's responsive shape rather than a hardcoded
// class literal. A divergence in either component flips a flag and fails here.
function columnHiddenPattern(html: string): boolean[] {
  return html
    .split("<td")
    .slice(1)
    .map((cell) => /\bhidden\b/.test(cell.slice(0, cell.indexOf(">"))));
}

function realRowHtml(): string {
  const holding: LocalHolding = {
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
  };
  return renderToStaticMarkup(
    <table>
      <tbody>
        <HoldingRow
          holding={holding}
          prices={new Map([["AAPL", { ticker: "AAPL", price: "200.00000000" }]])}
          dayChangeCents={null}
          totalInvestmentsCents={null}
          onRowClick={vi.fn()}
        />
      </tbody>
    </table>,
  );
}

function skeletonHtml(): string {
  return renderToStaticMarkup(
    <table>
      <tbody>
        <SkeletonRow />
      </tbody>
    </table>,
  );
}

describe("SkeletonRow column parity with the real holding row", () => {
  it("renders the same number of columns as the real row (no layout shift on load)", () => {
    const skeletonCols = (skeletonHtml().match(/<td/g) ?? []).length;
    const realCols = (realRowHtml().match(/<td/g) ?? []).length;
    expect(skeletonCols).toBe(realCols);
    expect(skeletonCols).toBe(6);
  });

  it("hides exactly the same columns on mobile as the real row", () => {
    // The point of the skeleton is to occupy the same visible columns while
    // loading; if the real row hides Price/Gain/Weight on mobile, so must the
    // skeleton, or the table reflows when data arrives.
    const skeletonPattern = columnHiddenPattern(skeletonHtml());
    const realPattern = columnHiddenPattern(realRowHtml());
    expect(skeletonPattern).toEqual(realPattern);
    // Holding, G/L, and Value stay visible on mobile; Price, Day, Weight hide.
    expect(skeletonPattern).toEqual([false, true, true, false, true, false]);
  });

  it("SkeletonRows renders the requested count of rows", () => {
    const html = renderToStaticMarkup(
      <table>
        <tbody>
          <SkeletonRows count={3} />
        </tbody>
      </table>,
    );
    const rows = html.match(/<tr/g);
    expect(rows).toHaveLength(3);
  });
});
