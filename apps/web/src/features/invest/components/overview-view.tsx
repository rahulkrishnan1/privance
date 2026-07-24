"use client";

import type { Account, Decimal, Holding, HoldingId, NetWorthBreakdown } from "@privance/core";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useMemo } from "react";
import { AllocationPieSkeleton } from "@/features/dashboard/components/skeletons";
import { TopHoldingsTable } from "@/features/dashboard/components/top-holdings-table";
import type { SymbolProfileEntry } from "@/lib/api/symbol-profiles";
import {
  buildClassSlices,
  buildSectorSlices,
  estimatedIncome,
  portfolioGain,
} from "../_invest-math";
import type { TaxBucketsResult } from "../types";
import { IncomePanel } from "./income-panel";
import { SplitsRow } from "./splits-row";
import { TaxBucketsPanel } from "./tax-buckets-panel";

const AllocationPie = lazy(() =>
  import("@/features/dashboard/components/allocation-pie").then((m) => ({
    default: m.AllocationPie,
  })),
);

type OverviewViewProps = {
  breakdown: NetWorthBreakdown;
  accounts: Account[];
  holdings: Holding[];
  dayChangeByHoldingId: ReadonlyMap<HoldingId, Decimal>;
  netWorthDelta: { dollar: Decimal; pct: number } | null;
  taxBucketsResult: TaxBucketsResult;
  profilesByTicker: ReadonlyMap<string, SymbolProfileEntry>;
};

export function OverviewView({
  breakdown,
  accounts,
  holdings,
  dayChangeByHoldingId,
  netWorthDelta,
  taxBucketsResult,
  profilesByTicker,
}: OverviewViewProps) {
  const navigate = useNavigate();
  const gain = useMemo(() => portfolioGain(breakdown), [breakdown]);

  const classSlices = useMemo(
    () => buildClassSlices({ breakdown, holdings, profilesByTicker }),
    [breakdown, holdings, profilesByTicker],
  );
  const sectorSlices = useMemo(
    () => buildSectorSlices({ breakdown, holdings, profilesByTicker }),
    [breakdown, holdings, profilesByTicker],
  );
  const income = useMemo(
    () => estimatedIncome({ breakdown, accounts, holdings, profilesByTicker }),
    [breakdown, accounts, holdings, profilesByTicker],
  );
  const hasIncome = income.payers.length > 0;

  // Key each holding by its price ticker (proxy when present) so a proxied
  // holding, e.g. a CIT priced off VOO, rolls its value and weight into the
  // proxy's row. The table uses this both as the display ticker and the group key.
  const priceTickerById = useMemo(() => {
    const map = new Map<HoldingId, string>();
    for (const h of holdings) {
      map.set(h.id, h.payload.proxyTicker ?? h.payload.ticker);
    }
    return map;
  }, [holdings]);

  return (
    <div className="pt-4 flex flex-col gap-4">
      <SplitsRow breakdown={breakdown} delta={netWorthDelta} portfolioGain={gain} />

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-6 max-[880px]:col-span-12 h-full">
          <Suspense fallback={<AllocationPieSkeleton />}>
            <AllocationPie
              title="Allocation"
              classSlices={classSlices}
              sectorSlices={sectorSlices}
            />
          </Suspense>
        </div>

        <div className="col-span-6 max-[880px]:col-span-12 h-full">
          <TopHoldingsTable
            byHolding={breakdown.byHolding}
            tickerById={priceTickerById}
            groupKeyById={priceTickerById}
            dayChangeByHoldingId={dayChangeByHoldingId}
            holdings={holdings}
            onRowClick={() => navigate({ to: "/app/holdings" })}
          />
        </div>

        <div
          className={`${hasIncome ? "col-span-6" : "col-span-12"} max-[880px]:col-span-12 h-full`}
        >
          <TaxBucketsPanel
            buckets={taxBucketsResult.buckets}
            reachableBeforeFiftyNineHalfCents={taxBucketsResult.reachableBeforeFiftyNineHalfCents}
          />
        </div>
        {hasIncome && (
          <div className="col-span-6 max-[880px]:col-span-12 h-full">
            <IncomePanel result={income} />
          </div>
        )}
      </div>
    </div>
  );
}
