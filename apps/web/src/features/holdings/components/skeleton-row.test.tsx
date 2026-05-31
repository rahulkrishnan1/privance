import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkeletonRow, SkeletonRows } from "./skeleton-row";

describe("SkeletonRow responsive columns", () => {
  it("renders exactly 10 <td> elements matching the real table", () => {
    const html = renderToStaticMarkup(
      <table>
        <tbody>
          <SkeletonRow />
        </tbody>
      </table>,
    );
    const matches = html.match(/<td/g);
    expect(matches).toHaveLength(10);
  });

  it("the ticker cell is always visible (no hidden class)", () => {
    const html = renderToStaticMarkup(
      <table>
        <tbody>
          <SkeletonRow />
        </tbody>
      </table>,
    );
    // The first <td> should not carry hidden.
    const firstTd = html.match(/<td[^>]*>/)?.[0] ?? "";
    expect(firstTd).not.toContain("hidden");
  });

  it("desktop-only columns carry hidden md:table-cell", () => {
    const html = renderToStaticMarkup(
      <table>
        <tbody>
          <SkeletonRow />
        </tbody>
      </table>,
    );
    // At least 7 hidden tds (account, shares, price, avgcost, gain$, groups, actions).
    const hiddenTds = html.match(/hidden md:table-cell/g);
    expect(hiddenTds).not.toBeNull();
    expect((hiddenTds ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it("market value and gain % cells are visible (no hidden class)", () => {
    const html = renderToStaticMarkup(
      <table>
        <tbody>
          <SkeletonRow />
        </tbody>
      </table>,
    );
    // Split on <td to examine each cell in order.
    const cells = html.split("<td").slice(1);
    // Indices: 0=Ticker, 1=Account, 2=Shares, 3=Price, 4=AvgCost, 5=MarketValue, 6=GainDollar, 7=GainPct, 8=Groups, 9=Actions
    expect(cells[5]).not.toMatch(/hidden/);
    expect(cells[7]).not.toMatch(/hidden/);
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
