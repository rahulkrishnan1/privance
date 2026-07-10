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

test("shows the per-share price derived from market value and shares", async () => {
  const holdingId = asId<HoldingId>("h-AAA");
  const holding = {
    id: holdingId,
    payload: {
      accountId: "acct-1",
      groupId: null,
      ticker: "AAA",
      assetType: "stock",
      proxyTicker: null,
      sharesMajor: "10",
      sharesScale: 0,
      costBasisCents: "50000",
    },
  } as unknown as Holding;
  const byHolding: HoldingValuation[] = [
    { holdingId, marketValue: dec(1000_00n), costBasis: dec(50000n), unrealizedPnl: dec(50000n) },
  ];
  const byTicker = new Map([[holdingId, "AAA"]]);

  const screen = await render(
    <TopHoldingsTable
      byHolding={byHolding}
      tickerById={byTicker}
      groupKeyById={byTicker}
      dayChangeByHoldingId={new Map()}
      holdings={[holding]}
      onRowClick={() => {}}
    />,
  );

  // 10 shares at a $1,000 market value -> $100.00 per share.
  await expect.element(screen.getByText("$100.00")).toBeVisible();
});

test("renders the day change with a +/- sign and unsigned percent", async () => {
  const up = asId<HoldingId>("h-UP");
  const down = asId<HoldingId>("h-DN");
  const byHolding: HoldingValuation[] = [
    { holdingId: up, marketValue: dec(110_00n), costBasis: dec(110_00n), unrealizedPnl: dec(0n) },
    { holdingId: down, marketValue: dec(90_00n), costBasis: dec(90_00n), unrealizedPnl: dec(0n) },
  ];
  const byTicker = new Map([
    [up, "UP"],
    [down, "DN"],
  ]);
  const dayChange = new Map([
    [up, dec(10_00n)],
    [down, dec(-10_00n)],
  ]);

  const screen = await render(
    <TopHoldingsTable
      byHolding={byHolding}
      tickerById={byTicker}
      groupKeyById={byTicker}
      dayChangeByHoldingId={dayChange}
      holdings={[] as Holding[]}
      onRowClick={() => {}}
    />,
  );

  // +$10 on a $100 prior -> + sign, and the percent carries no sign.
  await expect.element(screen.getByText("+10.00%")).toBeVisible();
  // -$10 on a $100 prior -> - sign, and the percent carries no sign.
  await expect.element(screen.getByText("-10.00%")).toBeVisible();
});
