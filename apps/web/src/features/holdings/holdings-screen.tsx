"use client";

import type { InvestmentAccount } from "@privance/core";
import { Decimal } from "@privance/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Button, ConfirmDialog, RefreshButton, Screen } from "@/components/index";
import { useAccountsQuery } from "@/features/accounts/queries";
import { refreshPrices } from "@/lib/api/prices";
import { usePricesQuery, warmPrice } from "@/lib/queries/prices";
import { useCooldown } from "@/lib/use-cooldown";
import { useSync } from "@/providers/sync-context";
import {
  computeAnchorScaleFactor,
  filterHoldings,
  lookupProxyPrice,
  sortHoldings,
} from "./_helpers";
import { EmptyState } from "./components/empty-state";
import { FilterChip } from "./components/filter-chip";
import { GroupsManager } from "./components/groups-manager";
import { type DrawerMode, HoldingDrawer } from "./components/holding-drawer";
import { HoldingsTable } from "./components/holdings-table";
import { useGroupMutations, useHoldingMutations } from "./mutations";
import { useGroupsQuery, useHoldingsQuery } from "./queries";
import type {
  FilterState,
  HoldingFormValues,
  LocalHolding,
  SortColumn,
  SortDirection,
  SortState,
} from "./types";
import { DEFAULT_SORT, SORT_COLUMNS, SORT_DIRECTIONS } from "./types";

// ---------------------------------------------------------------------------
// Persist sort preference
// ---------------------------------------------------------------------------

let _persistedSort: SortState = DEFAULT_SORT;

function getSavedSort(): SortState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("holdings.sort") : null;
    if (!raw) return _persistedSort;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      SORT_COLUMNS.includes((parsed as { column?: unknown }).column as SortColumn) &&
      SORT_DIRECTIONS.includes((parsed as { direction?: unknown }).direction as SortDirection)
    ) {
      return parsed as SortState;
    }
    return _persistedSort;
  } catch {
    return _persistedSort;
  }
}

function saveSort(sort: SortState) {
  _persistedSort = sort;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("holdings.sort", JSON.stringify(sort));
    }
  } catch {
    // localStorage unavailable
  }
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function HoldingsScreen() {
  const [sort, setSort] = useState<SortState>(getSavedSort);
  const [filter, setFilter] = useState<FilterState>({ kind: "all" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>({ kind: "add" });
  const [deleteTarget, setDeleteTarget] = useState<LocalHolding | null>(null);
  const [groupsManagerOpen, setGroupsManagerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    holdings,
    loading: holdingsLoading,
    error: holdingsError,
    reload: reloadHoldings,
  } = useHoldingsQuery();
  const {
    groups,
    loading: groupsLoading,
    error: groupsError,
    reload: reloadGroups,
  } = useGroupsQuery();
  const { store } = useSync();

  const reloadAll = useCallback(() => {
    reloadHoldings();
    reloadGroups();
  }, [reloadHoldings, reloadGroups]);

  const queryClient = useQueryClient();
  const { cooldownMs, refresh: refreshCooldown } = useCooldown();
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (refreshing || cooldownMs > 0) return;
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["prices"] });
      reloadAll();
    } finally {
      setRefreshing(false);
      refreshCooldown();
    }
  }, [refreshing, cooldownMs, queryClient, reloadAll, refreshCooldown]);

  const holdingMutations = useHoldingMutations(reloadAll);
  const groupMutations = useGroupMutations(reloadGroups);

  const accountsState = useAccountsQuery();
  const investmentAccounts = useMemo<InvestmentAccount[]>(() => {
    if (accountsState.status !== "success") return [];
    return accountsState.data.filter(
      (a): a is InvestmentAccount => a.payload.kind === "investment",
    );
  }, [accountsState]);

  const handleSortChange = useCallback((column: SortColumn) => {
    setSort((prev) => {
      const next: SortState =
        prev.column === column
          ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
          : { column, direction: "desc" };
      saveSort(next);
      return next;
    });
  }, []);

  const { yahooTickers, coingeckoTickers } = useMemo(() => {
    // Route by asset type. Proxy tickers are always public ETFs (Yahoo).
    const yahoo = new Set<string>();
    const coingecko = new Set<string>();
    for (const h of holdings) {
      if (h.proxyTicker !== null) {
        yahoo.add(h.proxyTicker);
      } else if (h.assetType === "crypto") {
        coingecko.add(h.ticker);
      } else {
        yahoo.add(h.ticker);
      }
    }
    return { yahooTickers: [...yahoo], coingeckoTickers: [...coingecko] };
  }, [holdings]);
  const { prices: rawPrices } = usePricesQuery({ yahooTickers, coingeckoTickers });
  const pricesMap = useMemo<Map<string, { ticker: string; price: string }>>(() => {
    const m = new Map<string, { ticker: string; price: string }>();
    for (const [ticker, decimal] of rawPrices) {
      m.set(ticker, { ticker, price: decimal.toString() });
    }
    return m;
  }, [rawPrices]);

  const visibleHoldings = useMemo(
    () => sortHoldings(filterHoldings(holdings, filter), sort, pricesMap),
    [holdings, filter, sort, pricesMap],
  );

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

  const handleSubmit = useCallback(
    async (values: HoldingFormValues, mode: DrawerMode, opts: { proxyPrice?: string }) => {
      setError(null);
      try {
        const sharesScale = 8;
        const sharesDecimal = Decimal.fromString(values.shares, sharesScale);
        const costPerShare = Decimal.fromString(values.avgCostPerShare, sharesScale);
        const costBasisCents = costPerShare
          .mul(sharesDecimal, { resultScale: 2 })
          .toMinorUnits()
          .toString();

        // Stock tickers are uppercase; CoinGecko slugs are lowercase. Normalize
        // once at submit so storage and price lookups stay consistent.
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
          await holdingMutations.updateHolding({
            id: mode.holding.id,
            ...baseInput,
          });
        }
        setDrawerOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save holding");
      }
    },
    [holdingMutations],
  );

  const handleCreateGroup = useCallback(
    async (name: string): Promise<string> => groupMutations.createGroup({ name }),
    [groupMutations],
  );

  const handleDelete = useCallback(async () => {
    if (deleteTarget === null) return;
    try {
      await holdingMutations.deleteHolding(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete holding");
      setDeleteTarget(null);
    }
  }, [deleteTarget, holdingMutations]);

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
  const showEmptyState = !loading && anyError === null && holdings.length === 0;

  if (showEmptyState) {
    return (
      <Screen width="wide">
        <EmptyState
          onAdd={() => {
            setDrawerMode({ kind: "add" });
            setDrawerOpen(true);
          }}
        />
        <HoldingDrawer
          open={drawerOpen}
          mode={drawerMode}
          investmentAccounts={investmentAccounts}
          groups={groups}
          onClose={() => setDrawerOpen(false)}
          onSubmit={handleSubmit}
          onLookupProxyPrice={handleLookupProxyPrice}
          onCreateGroup={handleCreateGroup}
          submitting={holdingMutations.creating || holdingMutations.updating}
        />
      </Screen>
    );
  }

  return (
    <Screen width="wide">
      {/* Page header */}
      <div className="flex items-center justify-between mb-4">
        <h1
          className="font-serif text-[32px] leading-tight font-light tracking-[-0.015em] text-app-text"
          style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
        >
          Holdings
        </h1>

        <div className="flex items-center gap-2">
          <RefreshButton
            cooldownMs={cooldownMs}
            onRefresh={() => void handleRefresh()}
            refreshing={refreshing}
          />

          {holdings.length > 0 && (
            <Button
              onClick={() => {
                setDrawerMode({ kind: "add" });
                setDrawerOpen(true);
              }}
              aria-label="Add holding"
            >
              Add holding
            </Button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {(anyError !== null || error !== null) && (
        <div
          role="alert"
          className="rounded-lg bg-app-red/10 border border-app-red/40 px-4 py-3 mb-3 flex items-center justify-between"
        >
          <p className="text-sm text-app-red flex-1">
            {anyError?.message ?? error ?? "An error occurred"}
          </p>
          <button
            type="button"
            onClick={reloadAll}
            aria-label="Retry"
            className="ml-2 text-sm font-medium text-app-red hover:underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Account filter row, only shown when there are multiple accounts to pick between. */}
      {investmentAccounts.length > 1 && (
        <div
          role="toolbar"
          aria-label="Filter by account"
          className="flex flex-wrap gap-2 mb-3 overflow-x-auto pb-1"
        >
          <FilterChip
            label="All accounts"
            selected={filter.kind === "all"}
            onPress={() => setFilter({ kind: "all" })}
          />
          {investmentAccounts.map((account) => (
            <FilterChip
              key={account.id}
              label={account.payload.name}
              selected={filter.kind === "account" && filter.accountId === account.id}
              onPress={() => setFilter({ kind: "account", accountId: account.id })}
            />
          ))}
        </div>
      )}

      <div role="toolbar" aria-label="Filter by group" className="flex flex-col gap-2 mb-4">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
          Groups
        </span>
        <button
          type="button"
          onClick={() => setGroupsManagerOpen(true)}
          className="self-start text-xs text-gold-accent mb-1 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] rounded cursor-pointer"
        >
          Manage groups
        </button>
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
            {investmentAccounts.length <= 1 && (
              <FilterChip
                label="All"
                selected={filter.kind === "all"}
                onPress={() => setFilter({ kind: "all" })}
              />
            )}
            {groups.map((g) => (
              <FilterChip
                key={g.id}
                label={g.name}
                selected={filter.kind === "group" && filter.groupId === g.id}
                onPress={() => setFilter({ kind: "group", groupId: g.id })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Holdings table */}
      <HoldingsTable
        holdings={visibleHoldings}
        groups={groups}
        accounts={investmentAccounts}
        prices={pricesMap}
        sort={sort}
        loading={loading}
        onSortChange={handleSortChange}
        onEdit={(holding) => {
          setDrawerMode({ kind: "edit", holding });
          setDrawerOpen(true);
        }}
        onDelete={(holding) => setDeleteTarget(holding)}
        onAdd={() => {
          setDrawerMode({ kind: "add" });
          setDrawerOpen(true);
        }}
      />

      {/* Add/edit drawer */}
      <HoldingDrawer
        open={drawerOpen}
        mode={drawerMode}
        investmentAccounts={investmentAccounts}
        groups={groups}
        onClose={() => setDrawerOpen(false)}
        onSubmit={handleSubmit}
        onLookupProxyPrice={handleLookupProxyPrice}
        onCreateGroup={handleCreateGroup}
        submitting={holdingMutations.creating || holdingMutations.updating}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete holding?"
        body={
          deleteTarget !== null
            ? `Remove ${deleteTarget.ticker} from your portfolio? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />

      {/* Groups manager */}
      <GroupsManager
        open={groupsManagerOpen}
        groups={groups}
        onClose={() => setGroupsManagerOpen(false)}
        onRename={handleGroupRename}
        onDelete={handleGroupDelete}
      />
    </Screen>
  );
}
