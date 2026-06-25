import type { Holding, HoldingId, HoldingValuation } from "@privance/core";
import { asId, Decimal, SCALE_CENTS } from "@privance/core";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { TopHoldingsTable } from "./top-holdings-table";

function dec(cents: bigint): Decimal {
  return Decimal.fromMinorUnits(cents, SCALE_CENTS);
}

// The browser harness ships no Tailwind utilities, so the height-driven fill
// (verified in-app) settles at the collapsed preview here; this pins the
// preview's invariant: the largest holdings show and the smallest are dropped.
test("previews the largest holdings and drops the smallest", async () => {
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
  const byTicker = new Map(tickers.map((t) => [asId<HoldingId>(`h-${t}`), t]));

  const screen = await render(
    <TopHoldingsTable
      byHolding={byHolding}
      tickerById={byTicker}
      groupKeyById={byTicker}
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
