"use client";

import type { HoldingId } from "@privance/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Screen } from "@/components/index";
import { useCooldown } from "@/lib/use-cooldown";
import { AllocationGrid } from "./components/allocation-grid";
import { EmptyState } from "./components/empty-state";
import { HistoryChart } from "./components/history-chart";
import { NetWorthTile } from "./components/net-worth-tile";
import {
  AllocationGridSkeleton,
  HistoryChartSkeleton,
  NetWorthTileSkeleton,
  TopHoldingsSkeleton,
} from "./components/skeletons";
import { TopHoldingsTable } from "./components/top-holdings-table";
import type { DashboardData } from "./queries";
import { useDashboardData } from "./queries";

// ---------------------------------------------------------------------------
// Inner content
// ---------------------------------------------------------------------------

type ReadyContentProps = Extract<DashboardData, { status: "ready" }> & {
  cooldownMs: number;
  onRefresh: () => void;
  refreshing: boolean;
};

function ReadyContent({
  breakdown,
  holdings,
  allocationByKind,
  allocationByAssetClass,
  allocationByRegion,
  historyPoints,
  lastRefreshedMs,
  cooldownMs,
  onRefresh,
  refreshing,
}: ReadyContentProps) {
  const tickerById = useMemo(() => {
    const m = new Map<HoldingId, string>();
    for (const h of holdings) m.set(h.id, h.payload.ticker);
    return m;
  }, [holdings]);

  return (
    <>
      <NetWorthTile
        breakdown={breakdown}
        historyPoints={historyPoints}
        lastRefreshedMs={lastRefreshedMs}
        cooldownMs={cooldownMs}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
      <AllocationGrid
        byKind={allocationByKind}
        byAssetClass={allocationByAssetClass}
        byRegion={allocationByRegion}
      />
      <HistoryChart points={historyPoints} />
      <TopHoldingsTable
        byHolding={breakdown.byHolding}
        tickerById={tickerById}
        totalNetWorth={breakdown.netWorth}
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

  if (data.status === "loading") {
    return (
      <>
        <NetWorthTileSkeleton />
        <AllocationGridSkeleton />
        <HistoryChartSkeleton />
        <TopHoldingsSkeleton />
      </>
    );
  }

  if (data.status === "error") {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-neutral-900 p-4">
        <p className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">
          Failed to load dashboard
        </p>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">{data.error.message}</p>
      </div>
    );
  }

  if (data.status === "empty") {
    return <EmptyState />;
  }

  return (
    <ReadyContent
      {...data}
      cooldownMs={cooldownMs}
      onRefresh={() => {
        void handleRefresh();
      }}
      refreshing={refreshing}
    />
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
