import type { Holding, HoldingId, HoldingValuation } from "@privance/core";
import { asId, Decimal, SCALE_CENTS } from "@privance/core";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { TopHoldingsTable } from "./top-holdings-table";

function dec(cents: bigint): Decimal {
  return Decimal.fromMinorUnits(cents, SCALE_CENTS);
}

test("caps the table at 5 rows and drops the smallest holdings", async () => {
  const tickers = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]; // descending value
  const byHolding: HoldingValuation[] = tickers.map((t, i) => {
    const value = dec(BigInt((tickers.length - i) * 100_00));
    return {
      holdingId: asId<HoldingId>(`h-${t}`),
      marketValue: value,
      costBasis: value,
      unrealizedPnl: dec(0n),
    };
  });
  const tickerById = new Map(tickers.map((t) => [asId<HoldingId>(`h-${t}`), t]));
  const groupKeyById = new Map(tickers.map((t) => [asId<HoldingId>(`h-${t}`), t]));

  const screen = await render(
    <TopHoldingsTable
      byHolding={byHolding}
      tickerById={tickerById}
      groupKeyById={groupKeyById}
      totalInvestments={dec(2100_00n)}
      dayChangeByHoldingId={new Map()}
      holdings={[] as Holding[]}
      onRowClick={() => {}}
    />,
  );

  await expect.element(screen.getByText("AAA")).toBeVisible();
  await expect.element(screen.getByText("EEE")).toBeVisible();
  expect(screen.container.querySelectorAll("tbody tr")).toHaveLength(5);
  expect(screen.container.textContent).not.toContain("FFF");
});
