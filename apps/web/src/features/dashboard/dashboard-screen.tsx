"use client";

import type { HoldingId } from "@privance/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RefreshButton, Screen } from "@/components/index";
import { useCooldown } from "@/lib/use-cooldown";
import { AllocationPie } from "./components/allocation-pie";
import { DeltaLine } from "./components/delta-line";
import { EmptyState } from "./components/empty-state";
import { HistoryChart } from "./components/history-chart";
import { NetWorthTile } from "./components/net-worth-tile";
import {
  AllocationPieSkeleton,
  HistoryChartSkeleton,
  KpiRowSkeleton,
  TopHoldingsSkeleton,
} from "./components/skeletons";
import { SummaryTile } from "./components/summary-tile";
import { TopHoldingsTable } from "./components/top-holdings-table";
import type { DashboardData } from "./queries";
import { deriveAggregateDeltas, splitCashAndInvestments, useDashboardData } from "./queries";

// ---------------------------------------------------------------------------
// Inner content
// ---------------------------------------------------------------------------

type ReadyContentProps = Extract<DashboardData, { status: "ready" }>;

function ReadyContent({
  breakdown,
  holdings,
  allocationByKind,
  historyPoints,
  dayChangeByHoldingId,
}: ReadyContentProps) {
  const { tickerById, groupKeyById } = useMemo(() => {
    const tickerMap = new Map<HoldingId, string>();
    const groupMap = new Map<HoldingId, string>();
    for (const h of holdings) {
      tickerMap.set(h.id, h.payload.ticker);
      // proxyTicker is the price-fetch ticker; including it in the merge key
      // prevents two distinct underlyings with the same display ticker from
      // collapsing into a single row.
      groupMap.set(h.id, `${h.payload.ticker}|${h.payload.proxyTicker ?? ""}`);
    }
    return { tickerById: tickerMap, groupKeyById: groupMap };
  }, [holdings]);

  const { cash, investments } = useMemo(() => splitCashAndInvestments(breakdown), [breakdown]);

  const { investments: investmentsDelta, netWorth: netWorthDelta } = useMemo(
    () => deriveAggregateDeltas(breakdown, dayChangeByHoldingId),
    [breakdown, dayChangeByHoldingId],
  );

  return (
    <>
      {/* Equal-width KPI tiles. Net Worth + Cash sum to 2 of 3 columns,
          matching the Chart card's 2-of-3 width below; Investments at 1 of 3
          matches the Composition card directly underneath it. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <NetWorthTile breakdown={breakdown} delta={netWorthDelta} />
        <SummaryTile label="Cash" value={cash} />
        <SummaryTile
          label="Investments"
          value={investments}
          subline={investmentsDelta !== null ? <DeltaLine {...investmentsDelta} /> : null}
        />
      </div>

      {/* Same 3-column grid as the KPI row so the History chart sits under
          Net Worth + Cash (col-span-2) and the Composition pie sits under
          Investments. HistoryChart and AllocationPie are direct grid children
          so each inherits the row height needed by the internal Recharts
          ResponsiveContainer. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <HistoryChart points={historyPoints} className="md:col-span-2" />
        <AllocationPie title="Composition" slices={allocationByKind} />
      </div>

      <TopHoldingsTable
        byHolding={breakdown.byHolding}
        tickerById={tickerById}
        groupKeyById={groupKeyById}
        totalInvestments={investments}
        dayChangeByHoldingId={dayChangeByHoldingId}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

function DashboardContent() {
  const data = useDashboardData();
  const { cooldownMs, refresh: refreshCooldown } = useCooldown();
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const handleRefresh = useCallback(async () => {
    if (refreshing || cooldownMs > 0) return;
    setRefreshing(true);
    try {
      // Invalidate every price query so usePricesQuery refetches with the
      // current ticker list. The dashboard's load() re-runs on new prices,
      // which advances `lastRefreshedMs`.
      await queryClient.invalidateQueries({ queryKey: ["prices"] });
    } finally {
      setRefreshing(false);
      refreshCooldown();
    }
  }, [refreshing, cooldownMs, refreshCooldown, queryClient]);

  if (data.status === "empty") {
    return <EmptyState />;
  }

  const header = (
    <div className="flex items-end justify-between gap-3 mb-4">
      <h1
        className="font-serif text-[32px] leading-tight font-light tracking-[-0.015em] text-app-text"
        style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
      >
        Dashboard
      </h1>
      <RefreshButton
        cooldownMs={cooldownMs}
        onRefresh={() => {
          void handleRefresh();
        }}
        refreshing={refreshing}
      />
    </div>
  );

  if (data.status === "loading") {
    return (
      <>
        {header}
        <KpiRowSkeleton />
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4 mb-4">
          <HistoryChartSkeleton />
          <AllocationPieSkeleton />
        </div>
        <TopHoldingsSkeleton />
      </>
    );
  }

  if (data.status === "error") {
    return (
      <>
        {header}
        <div className="rounded-xl border border-app-red/40 bg-app-red/10 p-4">
          <p className="text-sm font-semibold text-app-red mb-1">Failed to load dashboard</p>
          <p className="text-xs text-app-muted">{data.error.message}</p>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <ReadyContent {...data} />
    </>
  );
}

export function DashboardScreen() {
  return (
    <Screen width="wide">
      <ErrorBoundary>
        <DashboardContent />
      </ErrorBoundary>
    </Screen>
  );
}
