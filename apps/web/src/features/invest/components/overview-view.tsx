import type { NetWorthBreakdown } from "@privance/core";
import { Decimal, type HoldingId, SCALE_CENTS } from "@privance/core";
import { lazy, Suspense, useMemo } from "react";
import { useNavigate } from "react-router";
import { useAccountsQuery } from "@/features/accounts/queries";
import { AllocationPieSkeleton } from "@/features/dashboard/components/skeletons";
import { TopHoldingsTable } from "@/features/dashboard/components/top-holdings-table";
import type { SymbolProfileEntry } from "@/lib/api/symbol-profiles";
import {
  buildClassSlices,
  buildSectorSlices,
  estimatedIncome,
  portfolioGain,
  taxBuckets,
} from "../_invest-math";
import { useInvestDashboard } from "../invest-context";
import type { TaxBucketsResult } from "../types";
import { IncomePanel } from "./income-panel";
import { SplitsRow } from "./splits-row";
import { TaxBucketsPanel } from "./tax-buckets-panel";

const AllocationPie = lazy(() =>
  import("@/features/dashboard/components/allocation-pie").then((m) => ({
    default: m.AllocationPie,
  })),
);

export function OverviewView() {
  const navigate = useNavigate();
  const { dashData } = useInvestDashboard();
  const accountsState = useAccountsQuery();

  const accounts = accountsState.status === "success" ? accountsState.data : [];

  // All invest views consume the same dashboard snapshot; derive the view-specific
  // collections locally without starting another dashboard computation.
  const breakdown: NetWorthBreakdown | null =
    dashData.status === "ready" ? dashData.breakdown : null;
  const holdings = dashData.status === "ready" ? dashData.holdings : [];
  const dayChangeByHoldingId: ReadonlyMap<HoldingId, Decimal> =
    dashData.status === "ready" ? dashData.dayChangeByHoldingId : new Map();
  const profilesByTicker: ReadonlyMap<string, SymbolProfileEntry> =
    dashData.status === "ready" ? dashData.profilesByTicker : new Map();

  const taxBucketsResult: TaxBucketsResult = useMemo(() => {
    if (dashData.status !== "ready" || breakdown === null) {
      return { buckets: [], reachableBeforeFiftyNineHalfCents: Decimal.zero(SCALE_CENTS) };
    }
    return taxBuckets({ accounts, breakdown });
  }, [accounts, dashData, breakdown]);

  const netWorthDelta = dashData.status === "ready" ? dashData.netWorthDelta : null;

  const gain = useMemo(() => {
    if (breakdown === null) {
      // Placeholder: component returns null before this is consumed.
      return { gainCents: Decimal.zero(SCALE_CENTS), gainPct: 0 };
    }
    return portfolioGain(breakdown);
  }, [breakdown]);

  const classSlices = useMemo(() => {
    if (breakdown === null) return [];
    return buildClassSlices({ breakdown, holdings, profilesByTicker });
  }, [breakdown, holdings, profilesByTicker]);
  const sectorSlices = useMemo(() => {
    if (breakdown === null) return [];
    return buildSectorSlices({ breakdown, holdings, profilesByTicker });
  }, [breakdown, holdings, profilesByTicker]);
  const income = useMemo(() => {
    if (breakdown === null) return null;
    return estimatedIncome({ breakdown, accounts, holdings, profilesByTicker });
  }, [breakdown, accounts, holdings, profilesByTicker]);
  const hasIncome = income !== null && income.payers.length > 0;

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

  if (breakdown === null) {
    return null;
  }

  return (
    <div className="swap-in">
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
              onRowClick={(holding) => {
                navigate("/app/holdings", {
                  viewTransition: true,
                  state: { highlightId: holding.id },
                });
              }}
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
          {hasIncome && income !== null && (
            <div className="col-span-6 max-[880px]:col-span-12 h-full">
              <IncomePanel result={income} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
