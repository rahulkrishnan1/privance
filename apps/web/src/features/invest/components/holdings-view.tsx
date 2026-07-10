"use client";

import type { Decimal, HoldingId, InvestmentAccount, NetWorthBreakdown } from "@privance/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { centsToDecimal, useAccountsQuery } from "@/features/accounts/queries";
import {
  computeAnchorScaleFactor,
  filterHoldings,
  getSavedSort,
  lookupProxyPrice,
  saveSort,
  sortByValueDesc,
  sortHoldings,
} from "@/features/holdings";
import { GroupsManager } from "@/features/holdings/components/groups-manager";
import { HoldingDetailSheet } from "@/features/holdings/components/holding-detail-sheet";
import {
  HoldingDialog,
  type HoldingDialogMode,
} from "@/features/holdings/components/holding-dialog";
import { HoldingsTable } from "@/features/holdings/components/holdings-table";
import { ScopeMenu } from "@/features/holdings/components/scope-menu";
import { useGroupMutations, useHoldingMutations } from "@/features/holdings/mutations";
import { useGroupsQuery, useHoldingsQuery } from "@/features/holdings/queries";
import type {
  FilterState,
  HoldingFormValues,
  LocalHolding,
  SortColumn,
  SortState,
} from "@/features/holdings/types";
import { refreshPrices } from "@/lib/api/prices";
import { formatPercentMagnitude, formatTrendCurrencyWhole } from "@/lib/format";
import { usePricesQuery, warmPrice } from "@/lib/queries/prices";
import { partitionTickers } from "@/lib/tickers";
import { useAuth } from "@/providers/auth-context";
import { useSync } from "@/providers/sync-context";
import { subsetGain } from "../_invest-math";
import { OPEN_ADD_HOLDING_KEY } from "../types";

type HoldingsViewProps = {
  breakdown: NetWorthBreakdown | null;
  dayChangeByHoldingId: ReadonlyMap<HoldingId, Decimal>;
  /** Incremented by the parent subnav "+ holding" button to open the add dialog. */
  addSignal?: number;
};

export function HoldingsView({ breakdown, dayChangeByHoldingId, addSignal }: HoldingsViewProps) {
  const { user } = useAuth();
  const userId = user?.userId;
  const [sort, setSort] = useState<SortState>(() => getSavedSort(userId));
  const [filter, setFilter] = useState<FilterState>({ kind: "all" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<HoldingDialogMode>({ kind: "add" });
  const [detailHolding, setDetailHolding] = useState<LocalHolding | null>(null);
  const [groupsManagerOpen, setGroupsManagerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { holdings, loading: holdingsLoading, error: holdingsError } = useHoldingsQuery();
  const { groups, loading: groupsLoading, error: groupsError } = useGroupsQuery();
  const { store, tick } = useSync();

  const holdingMutations = useHoldingMutations();
  const groupMutations = useGroupMutations();

  const accountsState = useAccountsQuery();
  const investmentAccounts = useMemo<InvestmentAccount[]>(() => {
    if (accountsState.status !== "success") return [];
    return accountsState.data.filter(
      (a): a is InvestmentAccount => a.payload.kind === "investment",
    );
  }, [accountsState]);

  const accountNamesMap = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const a of investmentAccounts) {
      m.set(a.id, a.payload.name);
    }
    return m;
  }, [investmentAccounts]);

  const handleSortChange = useCallback(
    (column: SortColumn) => {
      setSort((prev) => {
        const next: SortState =
          prev.column === column
            ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
            : { column, direction: "desc" };
        saveSort(userId, next);
        return next;
      });
    },
    [userId],
  );

  const { yahooTickers, coingeckoTickers } = useMemo(() => partitionTickers(holdings), [holdings]);
  const { prices: rawPrices } = usePricesQuery({ yahooTickers, coingeckoTickers });
  const pricesMap = useMemo<Map<string, { ticker: string; price: string }>>(() => {
    const m = new Map<string, { ticker: string; price: string }>();
    for (const [ticker, decimal] of rawPrices) {
      m.set(ticker, { ticker, price: decimal.toString() });
    }
    return m;
  }, [rawPrices]);

  const visibleHoldings = useMemo(
    () => sortHoldings(filterHoldings(holdings, filter), sort, pricesMap, dayChangeByHoldingId),
    [holdings, filter, sort, pricesMap, dayChangeByHoldingId],
  );

  const scopeCounts = useMemo(() => {
    const byAccount = new Map<string, number>();
    const byGroup = new Map<string, number>();
    for (const h of holdings) {
      byAccount.set(h.accountId, (byAccount.get(h.accountId) ?? 0) + 1);
      if (h.groupId !== null) byGroup.set(h.groupId, (byGroup.get(h.groupId) ?? 0) + 1);
    }
    return { byAccount, byGroup };
  }, [holdings]);

  // Values come from the canonical net-worth breakdown, not a second pipeline.
  const scopeAccounts = useMemo(() => {
    const zero = centsToDecimal("0");
    const value = new Map<string, Decimal>();
    for (const av of breakdown?.byAccount ?? []) value.set(av.accountId, av.value);
    return sortByValueDesc(
      investmentAccounts,
      (a) => value.get(a.id) ?? zero,
      (a) => a.payload.name,
    );
  }, [investmentAccounts, breakdown]);
  const scopeGroups = useMemo(() => {
    const zero = centsToDecimal("0");
    const mv = new Map<string, Decimal>(
      (breakdown?.byHolding ?? []).map((hv) => [hv.holdingId, hv.marketValue]),
    );
    const value = new Map<string, Decimal>();
    for (const h of holdings) {
      if (h.groupId === null) continue;
      value.set(h.groupId, (value.get(h.groupId) ?? zero).add(mv.get(h.id) ?? zero));
    }
    return sortByValueDesc(
      groups,
      (g) => value.get(g.id) ?? zero,
      (g) => g.name,
    );
  }, [groups, holdings, breakdown]);

  const totalInvestmentsCents = useMemo(
    () => breakdown?.byAccountKind?.investment ?? null,
    [breakdown],
  );

  const gain = useMemo(() => {
    if (breakdown === null) return null;
    const visibleIds = new Set(visibleHoldings.map((h) => h.id));
    const filteredValuations = breakdown.byHolding.filter((hv) => visibleIds.has(hv.holdingId));
    return subsetGain(filteredValuations);
  }, [breakdown, visibleHoldings]);

  // Reset a filter whose account/group was deleted; guard on settled data so a
  // transient refetch gap doesn't clear a valid filter.
  useEffect(() => {
    if (accountsState.status !== "success" || groupsLoading) return;
    const gone =
      (filter.kind === "account" && !investmentAccounts.some((a) => a.id === filter.accountId)) ||
      (filter.kind === "group" && !groups.some((g) => g.id === filter.groupId));
    if (gone) setFilter({ kind: "all" });
  }, [filter, investmentAccounts, groups, accountsState.status, groupsLoading]);

  const filterLabel =
    filter.kind === "all"
      ? "All holdings"
      : filter.kind === "account"
        ? (accountNamesMap.get(filter.accountId) ?? "Account")
        : (groups.find((g) => g.id === filter.groupId)?.name ?? "Group");

  const handleLookupProxyPrice = useCallback(
    (ticker: string): Promise<string | null> =>
      lookupProxyPrice(
        ticker,
        pricesMap.get(ticker)?.price,
        (tickers) => refreshPrices(tickers, "yahoo"),
        warmPrice,
      ),
    [pricesMap],
  );

  const openDialog = useCallback((mode: HoldingDialogMode) => {
    setDialogMode(mode);
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
  }, []);

  // Open the add dialog when the parent subnav "+ holding" button fires. The
  // signal starts at 0 (falsy) so the initial render does not auto-open.
  useEffect(() => {
    if (addSignal) openDialog({ kind: "add" });
  }, [addSignal, openDialog]);

  // Overview's "+ Add holding" routes here and leaves a one-shot flag to open
  // the add dialog (the dialog lives on this view, not on Overview).
  useEffect(() => {
    if (sessionStorage.getItem(OPEN_ADD_HOLDING_KEY)) {
      sessionStorage.removeItem(OPEN_ADD_HOLDING_KEY);
      openDialog({ kind: "add" });
    }
  }, [openDialog]);

  const handleSubmit = useCallback(
    async (values: HoldingFormValues, mode: HoldingDialogMode, opts: { proxyPrice?: string }) => {
      setError(null);
      try {
        const sharesScale = 8;
        const { Decimal } = await import("@privance/core");
        // Cost basis is entered per share; total = avg cost per share x shares.
        const sharesDecimal = Decimal.fromString(values.shares, sharesScale);
        const costPerShareStr = values.avgCostPerShare.trim() || "0";
        const costBasisCents = Decimal.fromString(costPerShareStr, sharesScale)
          .mul(sharesDecimal, { resultScale: 2 })
          .toMinorUnits()
          .toString();

        const normalizedTicker =
          values.assetType === "crypto"
            ? values.ticker.trim().toLowerCase()
            : values.ticker.trim().toUpperCase();
        const proxyTicker = values.proxyTicker?.trim() || null;

        const existingScaleFactor = mode.kind === "edit" ? mode.holding.scaleFactor : undefined;
        const existingAnchoredAt = mode.kind === "edit" ? mode.holding.proxyAnchoredAt : undefined;
        const existingProxy = mode.kind === "edit" ? mode.holding.proxyTicker : null;
        const proxyChanged = mode.kind !== "edit" || existingProxy !== proxyTicker;
        const navStr = values.nav?.trim() ?? "";

        let scaleFactor: string | undefined;
        let proxyAnchoredAt: string | undefined;
        if (proxyTicker === null) {
          scaleFactor = undefined;
          proxyAnchoredAt = undefined;
        } else if (navStr.length > 0 && opts.proxyPrice !== undefined) {
          scaleFactor = computeAnchorScaleFactor(navStr, opts.proxyPrice);
          proxyAnchoredAt = new Date().toISOString().slice(0, 10);
        } else if (!proxyChanged) {
          scaleFactor = existingScaleFactor;
          proxyAnchoredAt = existingAnchoredAt;
        } else {
          throw new Error(
            "Enter the current price per share for the new proxy so we can anchor it.",
          );
        }

        const baseInput = {
          accountId: values.accountId,
          groupId: values.groupId ?? null,
          ticker: normalizedTicker,
          assetType: values.assetType,
          proxyTicker,
          sharesMajor: values.shares,
          sharesScale,
          costBasisCents,
          ...(scaleFactor !== undefined ? { scaleFactor } : {}),
          ...(proxyAnchoredAt !== undefined ? { proxyAnchoredAt } : {}),
        } as const;

        if (mode.kind === "add") {
          await holdingMutations.createHolding(baseInput);
        } else {
          await holdingMutations.updateHolding({ id: mode.holding.id, ...baseInput });
        }
        closeDialog();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save holding");
      }
    },
    [holdingMutations, closeDialog],
  );

  const handleCreateGroup = useCallback(
    async (name: string): Promise<string> => groupMutations.createGroup({ name }),
    [groupMutations],
  );

  const handleDeleteHolding = useCallback(
    async (holding: LocalHolding) => {
      try {
        await holdingMutations.deleteHolding(holding.id);
        setDetailHolding(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete holding");
      }
    },
    [holdingMutations],
  );

  const handleGroupRename = useCallback(
    async (id: string, name: string) => groupMutations.updateGroup({ id, name }),
    [groupMutations],
  );

  const handleGroupDelete = useCallback(
    async (id: string) => groupMutations.deleteGroup(id),
    [groupMutations],
  );

  const loading = holdingsLoading || groupsLoading || store === null;
  const anyError = holdingsError ?? groupsError;

  return (
    <div className="pt-4">
      {(anyError !== null || error !== null) && (
        <div
          role="alert"
          className="rounded-lg bg-down/10 border border-down/40 px-4 py-3 mb-4 flex items-center justify-between"
        >
          <p className="text-sm text-down flex-1">
            {anyError?.message ?? error ?? "An error occurred"}
          </p>
          <button
            type="button"
            onClick={tick}
            aria-label="Retry"
            className="ml-2 text-sm font-medium text-down hover:underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      <div className="glass rounded-[10px] p-6">
        <div className="flex justify-between items-baseline mb-4 gap-2.5 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1.5">
          <div>
            {investmentAccounts.length > 0 ? (
              <ScopeMenu
                filter={filter}
                label={filterLabel}
                count={visibleHoldings.length}
                accounts={scopeAccounts}
                groups={scopeGroups}
                accountCounts={scopeCounts.byAccount}
                groupCounts={scopeCounts.byGroup}
                totalCount={holdings.length}
                onSelect={setFilter}
                onEditGroups={() => setGroupsManagerOpen(true)}
              />
            ) : (
              <h3 className="font-serif text-2xl font-normal tracking-[-0.005em]">
                {filterLabel} ({visibleHoldings.length})
              </h3>
            )}
            {gain !== null && !gain.gainCents.isZero() && (
              <p
                className={`font-mono text-sm mt-[5px] ${!gain.gainCents.isNegative() ? "text-up" : "text-down"}`}
              >
                <span className="vfig">{formatTrendCurrencyWhole(gain.gainCents)}</span> (
                {formatPercentMagnitude(gain.gainPct)}) unrealized
              </p>
            )}
          </div>
        </div>

        <HoldingsTable
          holdings={visibleHoldings}
          prices={pricesMap}
          sort={sort}
          loading={loading}
          onSortChange={handleSortChange}
          onRowClick={setDetailHolding}
          onAdd={() => openDialog({ kind: "add" })}
          dayChangeByHoldingId={dayChangeByHoldingId}
        />
      </div>

      {detailHolding !== null && (
        <HoldingDetailSheet
          holding={detailHolding}
          prices={pricesMap}
          dayChangeCents={dayChangeByHoldingId.get(detailHolding.id as HoldingId) ?? null}
          totalInvestmentsCents={totalInvestmentsCents}
          accountName={accountNamesMap.get(detailHolding.accountId) ?? detailHolding.accountId}
          onClose={() => setDetailHolding(null)}
          onEdit={(h) => {
            setDetailHolding(null);
            openDialog({ kind: "edit", holding: h });
          }}
          onDelete={handleDeleteHolding}
        />
      )}

      <HoldingDialog
        open={dialogOpen}
        mode={dialogMode}
        investmentAccounts={investmentAccounts}
        groups={groups}
        onClose={closeDialog}
        onSubmit={handleSubmit}
        onLookupProxyPrice={handleLookupProxyPrice}
        onCreateGroup={handleCreateGroup}
        submitting={holdingMutations.creating || holdingMutations.updating}
      />

      <GroupsManager
        open={groupsManagerOpen}
        groups={groups}
        onClose={() => setGroupsManagerOpen(false)}
        onRename={handleGroupRename}
        onDelete={handleGroupDelete}
      />
    </div>
  );
}
