"use client";

import {
  type Account,
  type AccountId,
  AccountPayloadSchema,
  type AllocationSlice,
  allocationByAssetClass,
  allocationByRegion,
  asId,
  asIsoDateTime,
  computeNetWorth,
  Decimal,
  type Holding,
  type HoldingId,
  HoldingPayloadSchema,
  type IsoDateTime,
  type NetWorthSnapshot,
  type NetWorthSnapshotId,
  NetWorthSnapshotPayloadSchema,
  SCALE_CENTS,
  type SymbolProfile,
  type UserId,
} from "@privance/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePricesQuery } from "@/lib/queries/prices";
import { useProfilesQuery } from "@/lib/queries/profiles";
import { useSync } from "@/providers/sync-context";
import type { HistoryPoint } from "./types";

// ---------------------------------------------------------------------------
// Kind constants
// ---------------------------------------------------------------------------

const KIND_ACCOUNT = "account" as const;
const KIND_HOLDING = "holding" as const;
const KIND_SNAPSHOT = "net_worth_snapshot" as const;

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function parseAccount(
  raw: unknown,
  meta: { id: string; createdAt: IsoDateTime; lastUpdatedAt: IsoDateTime },
): Account {
  const payload = AccountPayloadSchema.parse(raw);
  return {
    id: asId<AccountId>(meta.id),
    userId: asId<UserId>(""),
    createdAt: meta.createdAt,
    lastUpdatedAt: meta.lastUpdatedAt,
    payload,
  } as Account;
}

function parseHolding(raw: unknown, objectId: string, updatedAt: number): Holding {
  const p = HoldingPayloadSchema.parse(raw);
  const ts = asIsoDateTime(new Date(updatedAt).toISOString());
  return {
    id: asId<HoldingId>(objectId),
    userId: asId<UserId>(""),
    createdAt: ts,
    updatedAt: ts,
    payload: p,
  } as Holding;
}

function parseSnapshot(raw: unknown, objectId: string): NetWorthSnapshot {
  const p = NetWorthSnapshotPayloadSchema.parse(raw);
  return {
    id: asId<NetWorthSnapshotId>(objectId),
    userId: asId<UserId>(""),
    createdAt: asIsoDateTime(new Date().toISOString()),
    updatedAt: asIsoDateTime(new Date().toISOString()),
    payload: p,
  } as NetWorthSnapshot;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DashboardData =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "empty" }
  | {
      status: "ready";
      breakdown: ReturnType<typeof computeNetWorth>;
      holdings: Holding[];
      allocationByKind: AllocationSlice[];
      allocationByAssetClass: AllocationSlice[];
      allocationByRegion: AllocationSlice[];
      historyPoints: HistoryPoint[];
      snapshots: NetWorthSnapshot[];
      lastRefreshedMs: number;
    };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDashboardData(): DashboardData {
  const { store, initialising, decrypt, storeClock } = useSync();
  const [data, setData] = useState<DashboardData>({ status: "loading" });
  const [yahooTickers, setYahooTickers] = useState<string[]>([]);
  const [coingeckoTickers, setCoingeckoTickers] = useState<string[]>([]);
  const cancelRef = useRef(false);

  const { prices } = usePricesQuery({ yahooTickers, coingeckoTickers });
  // Yahoo's symbol-lookup powers profile metadata; CoinGecko slugs don't have
  // exchange/sector data so we only look up the stock side.
  const { profiles } = useProfilesQuery(yahooTickers);

  const load = useCallback(async () => {
    if (store === null) {
      setData({ status: "loading" });
      return;
    }

    cancelRef.current = false;

    try {
      const [rawAccounts, rawHoldings, rawSnapshots] = await Promise.all([
        store.list({ kind: KIND_ACCOUNT }),
        store.list({ kind: KIND_HOLDING }),
        store.list({ kind: KIND_SNAPSHOT }),
      ]);

      if (cancelRef.current) return;

      const nowIso = asIsoDateTime(new Date().toISOString());

      const accounts: Account[] = [];
      for (const obj of rawAccounts) {
        if (obj.tombstone) continue;
        try {
          const bytes = decrypt({
            ciphertext: obj.ciphertext,
            nonce: obj.nonce,
            objectId: obj.objectId,
            kind: KIND_ACCOUNT,
          });
          accounts.push(
            parseAccount(parseJson(bytes), {
              id: obj.objectId,
              createdAt: nowIso,
              lastUpdatedAt: nowIso,
            }),
          );
        } catch {
          // skip undecryptable objects
        }
      }

      if (cancelRef.current) return;

      if (accounts.length === 0) {
        setData({ status: "empty" });
        return;
      }

      const holdings: Holding[] = [];
      for (const obj of rawHoldings) {
        if (obj.tombstone) continue;
        try {
          const bytes = decrypt({
            ciphertext: obj.ciphertext,
            nonce: obj.nonce,
            objectId: obj.objectId,
            kind: KIND_HOLDING,
          });
          holdings.push(parseHolding(parseJson(bytes), obj.objectId, obj.updatedAt));
        } catch {
          // skip undecryptable objects
        }
      }

      if (cancelRef.current) return;

      // Route prices by asset type: stocks/ETFs (and any proxy ticker, which
      // is always a public ETF) go to Yahoo; crypto holdings without a proxy
      // go to CoinGecko using the slug stored as the ticker.
      const yahooSet = new Set<string>();
      const coingeckoSet = new Set<string>();
      for (const h of holdings) {
        const p = h.payload;
        if (p.proxyTicker !== null) {
          yahooSet.add(p.proxyTicker);
        } else if (p.assetType === "crypto") {
          coingeckoSet.add(p.ticker);
        } else {
          yahooSet.add(p.ticker);
        }
      }
      const nextYahoo = [...yahooSet].sort();
      const nextCoingecko = [...coingeckoSet].sort();
      const sameAsPrev = (prev: string[], next: string[]) =>
        prev.length === next.length && prev.every((t, i) => t === next[i]);
      setYahooTickers((prev) => (sameAsPrev(prev, nextYahoo) ? prev : nextYahoo));
      setCoingeckoTickers((prev) => (sameAsPrev(prev, nextCoingecko) ? prev : nextCoingecko));

      const snapshots: NetWorthSnapshot[] = [];
      for (const obj of rawSnapshots) {
        if (obj.tombstone) continue;
        try {
          const bytes = decrypt({
            ciphertext: obj.ciphertext,
            nonce: obj.nonce,
            objectId: obj.objectId,
            kind: KIND_SNAPSHOT,
          });
          snapshots.push(parseSnapshot(parseJson(bytes), obj.objectId));
        } catch {
          // skip undecryptable objects
        }
      }

      if (cancelRef.current) return;

      const breakdown = computeNetWorth({ accounts, holdings, prices });

      // The allocation functions look up by holding.payload.ticker, but
      // profiles are fetched against `proxyTicker || ticker`. Re-key here so
      // every holding can find a profile regardless of proxy setup.
      const profilesByHoldingTicker = new Map<string, SymbolProfile>();
      for (const h of holdings) {
        const key = h.payload.proxyTicker ?? h.payload.ticker;
        const profile = profiles.get(key);
        if (profile !== undefined) profilesByHoldingTicker.set(h.payload.ticker, profile);
      }

      const byKind: AllocationSlice[] = buildKindSlices(breakdown);
      const byAsset = allocationByAssetClass(holdings, prices, profilesByHoldingTicker);
      const byRegion = allocationByRegion(holdings, prices, profilesByHoldingTicker);

      const historyPoints: HistoryPoint[] = snapshots
        .slice()
        .sort((a, b) => a.payload.snapshotAt.localeCompare(b.payload.snapshotAt))
        .map((snap) => {
          const cents = BigInt(snap.payload.netWorthCents);
          const value = Decimal.fromMinorUnits(cents, SCALE_CENTS);
          return {
            date: snap.payload.snapshotAt,
            valueDisplay: value.toFloat(),
            value,
          };
        });

      setData({
        status: "ready",
        breakdown,
        holdings,
        allocationByKind: byKind,
        allocationByAssetClass: byAsset,
        allocationByRegion: byRegion,
        historyPoints,
        snapshots,
        lastRefreshedMs: breakdown.asOf,
      });
    } catch (err) {
      if (cancelRef.current) return;
      setData({
        status: "error",
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }, [store, decrypt, prices, profiles]);

  // storeClock ticks on every local mutation, ensuring the dashboard refreshes
  // after add/edit/delete in any feature without waiting for a price tick.
  // biome-ignore lint/correctness/useExhaustiveDependencies: storeClock is a tick signal, not read in load
  useEffect(() => {
    if (initialising) {
      setData({ status: "loading" });
      return;
    }
    void load();
    return () => {
      cancelRef.current = true;
    };
  }, [initialising, load, storeClock]);

  return data;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildKindSlices(breakdown: ReturnType<typeof computeNetWorth>): AllocationSlice[] {
  // Bucket by what the money *is*, not which account holds it:
  // an investment account's cash sweep belongs in the Cash bucket, not
  // Investments. Holdings market value is the only thing in Investments.
  const investments = breakdown.byHolding.reduce(
    (acc, h) => acc.add(h.marketValue),
    Decimal.zero(SCALE_CENTS),
  );
  const investmentAccountCash = breakdown.byAccountKind.investment.sub(investments);
  const cash = breakdown.byAccountKind.cash.add(investmentAccountCash);
  const manualAsset = breakdown.byAccountKind.manualAsset;
  const liability = breakdown.byAccountKind.liability;

  const total = cash.add(investments).add(manualAsset).add(liability);

  const candidates: Array<{ label: string; value: Decimal }> = [
    { label: "Cash", value: cash },
    { label: "Investments", value: investments },
    { label: "Manual assets", value: manualAsset },
    { label: "Liabilities", value: liability },
  ];

  return candidates
    .filter((c) => !c.value.isZero())
    .map((c) => ({
      label: c.label,
      value: c.value,
      share: total.isZero() ? 0 : c.value.toFloat() / total.toFloat(),
    }))
    .sort((a, b) => b.value.cmp(a.value));
}
