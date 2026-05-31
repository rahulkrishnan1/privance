"use client";

import {
  type Account,
  type AccountId,
  AccountPayloadSchema,
  type AllocationSlice,
  asId,
  asIsoDateTime,
  computeNetWorth,
  Decimal,
  encryptAead,
  type Holding,
  type HoldingId,
  HoldingPayloadSchema,
  type IsoDateTime,
  KDF_PARAM_VERSION,
  LABEL_VERSION,
  type NetWorthSnapshot,
  type NetWorthSnapshotId,
  NetWorthSnapshotPayloadSchema,
  SCALE_CENTS,
  StorageError,
  type UserId,
} from "@privance/core";
import { useEffect, useRef, useState } from "react";
import { usePricesQuery } from "@/lib/queries/prices";
import { readItemsKey } from "@/providers/auth-context";
import { useSync } from "@/providers/sync-context";
import { computeDayChangeByHoldingId, splitCashAndInvestments } from "./_math";
import {
  buildSnapshotPayload,
  existingSnapshotLooksUnpriced,
  isBreakdownPriced,
  nextSnapshotAction,
  snapshotObjectId,
  utcDateString,
} from "./_snapshot";
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
      historyPoints: HistoryPoint[];
      snapshots: NetWorthSnapshot[];
      lastRefreshedMs: number;
      /** Per-holding day change in cents; absent when prior price isn't available. */
      dayChangeByHoldingId: Map<HoldingId, Decimal>;
    };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type DecryptedData = {
  accounts: Account[];
  holdings: Holding[];
  snapshots: NetWorthSnapshot[];
};

export function useDashboardData(): DashboardData {
  const { store, client, initialising, decrypt, storeClock, tick } = useSync();
  const [data, setData] = useState<DashboardData>({ status: "loading" });
  const [decryptedData, setDecryptedData] = useState<DecryptedData | null>(null);
  const snapshotWritingRef = useRef(false);
  const snapshotRewroteRef = useRef(false);
  const [yahooTickers, setYahooTickers] = useState<string[]>([]);
  const [coingeckoTickers, setCoingeckoTickers] = useState<string[]>([]);

  const { prices, previousPrices } = usePricesQuery({ yahooTickers, coingeckoTickers });

  // ---------------------------------------------------------------------------
  // Decrypt-only effect: re-runs ONLY when the local store changes (add/edit/
  // delete via storeClock, or initialising/store identity). Crucially does NOT
  // depend on prices, so a price tick won't re-decrypt every account/holding.
  // storeClock is a tick signal, not read in the body.
  // ---------------------------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: storeClock is a tick signal, not read in the effect body
  useEffect(() => {
    if (initialising || store === null) {
      setData({ status: "loading" });
      // Reset self-heal guard on store-null transitions (sign-out, fresh sign-in).
      snapshotRewroteRef.current = false;
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const [rawAccounts, rawHoldings, rawSnapshots] = await Promise.all([
          store.list({ kind: KIND_ACCOUNT }),
          store.list({ kind: KIND_HOLDING }),
          store.list({ kind: KIND_SNAPSHOT }),
        ]);
        if (cancelled) return;

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
        if (cancelled) return;

        if (accounts.length === 0) {
          setDecryptedData(null);
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
        if (cancelled) return;

        // Route tickers by asset type: stocks/ETFs (and any proxy ticker,
        // which is always a public ETF) go to Yahoo; crypto holdings without
        // a proxy go to CoinGecko.
        const yahooSet = new Set<string>();
        const coingeckoSet = new Set<string>();
        for (const h of holdings) {
          const p = h.payload;
          if (p.proxyTicker !== null) yahooSet.add(p.proxyTicker);
          else if (p.assetType === "crypto") coingeckoSet.add(p.ticker);
          else yahooSet.add(p.ticker);
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
        if (cancelled) return;

        setDecryptedData({ accounts, holdings, snapshots });
      } catch (err) {
        if (cancelled) return;
        setData({
          status: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialising, store, decrypt, storeClock]);

  // ---------------------------------------------------------------------------
  // Compute effect: re-runs on price ticks WITHOUT re-decrypting. Reads the
  // already-decrypted snapshot from state and rebuilds breakdown + day change.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (decryptedData === null) return;
    const { accounts, holdings, snapshots } = decryptedData;

    // Hold `loading` while any priced holding is still without a price.
    // Computing aggregates with a missing entry renders holdings as $0 and
    // skews KPI deltas; the race covers both cold start and a refetch
    // triggered by adding a holding.
    const someHoldingsMissingPrices =
      holdings.length > 0 &&
      holdings.some((h) => prices.get(h.payload.proxyTicker ?? h.payload.ticker) === undefined);
    if (someHoldingsMissingPrices) {
      setData({ status: "loading" });
      return;
    }

    try {
      const breakdown = computeNetWorth({ accounts, holdings, prices });
      const byKind: AllocationSlice[] = buildKindSlices(breakdown);

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

      const dayChangeByHoldingId = computeDayChangeByHoldingId(holdings, prices, previousPrices);

      setData({
        status: "ready",
        breakdown,
        holdings,
        allocationByKind: byKind,
        historyPoints,
        snapshots,
        lastRefreshedMs: breakdown.asOf,
        dayChangeByHoldingId,
      });
    } catch (err) {
      setData({
        status: "error",
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }, [decryptedData, prices, previousPrices]);

  // Primitive signals for the snapshot effect: a fresh `data` object on every
  // price tick must not re-run the effect when net worth in cents and the
  // snapshots list shape are unchanged. Deriving the strings here and using
  // them (not `data`) as the effect deps gives React's identity check the
  // chance to short-circuit the no-op case.
  const netWorthCentsTrigger =
    data.status === "ready" ? data.breakdown.netWorth.toMinorUnits().toString() : null;
  const snapshotsKeyTrigger =
    data.status === "ready"
      ? data.snapshots
          .map((s) => `${s.id}:${s.payload.snapshotAt}:${s.payload.netWorthCents}`)
          .join("|")
      : null;

  // ---------------------------------------------------------------------------
  // Snapshot effect: writes one net_worth_snapshot per UTC day so the history
  // chart has data to plot. Heals a row that was sealed before prices loaded
  // by overwriting it once per session. After a successful write, tick()
  // refreshes the decrypt effect which picks up the new snapshot.
  //
  // snapshotWritingRef guards the brief async window between store.put and
  // the next decrypt cycle (in-memory dedup, since nextSnapshotAction("skip")
  // only catches the persistent case once decryptedData reflects the new
  // row). snapshotRewroteRef caps self-heal to once per session so intraday
  // price drift does not churn the snapshot on every effect re-run.
  // ---------------------------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: data + decryptedData read but stability comes from the primitive *Trigger deps; including the objects would re-fire on every price tick
  useEffect(() => {
    if (data.status !== "ready" || decryptedData === null || store === null) return;
    if (snapshotWritingRef.current) return;
    if (!isBreakdownPriced(data.breakdown)) return;

    const today = utcDateString();

    const todaysExisting = data.snapshots.find((s) => s.payload.snapshotAt === today);
    const existingLooksUnpriced =
      todaysExisting !== undefined && existingSnapshotLooksUnpriced(todaysExisting, data.breakdown);

    const action = nextSnapshotAction({
      snapshots: data.snapshots,
      today,
      currentNetWorthCents: netWorthCentsTrigger ?? "",
      existingLooksUnpriced,
      alreadyRewroteThisSession: snapshotRewroteRef.current,
    });
    if (action.type === "skip") return;

    snapshotWritingRef.current = true;
    void (async () => {
      try {
        const key = readItemsKey();
        if (key === null) return;

        // Deterministic objectId means the row is uniquely keyed by UTC date.
        // The in-memory nextSnapshotAction above is a cheap early-skip; the
        // store.get below is the source of truth for create-vs-update because
        // an in-memory "create" decision can be stale (cross-device write
        // arrived after the last decrypt cycle).
        const objectId = snapshotObjectId(today);
        const stored = await store.get({ kind: KIND_SNAPSHOT, objectId });

        const payload = buildSnapshotPayload({
          date: today,
          breakdown: data.breakdown,
        });
        const plaintext = new TextEncoder().encode(JSON.stringify(payload));
        const blob = encryptAead({
          plaintext,
          key,
          aad: {
            recordUuid: objectId,
            kind: KIND_SNAPSHOT,
            labelVersion: LABEL_VERSION,
            kdfParamVersion: KDF_PARAM_VERSION,
          },
        });

        let version: bigint;
        let prevVersion: bigint | undefined;
        let serverSeq: bigint | null | undefined;
        if (stored === null) {
          version = 1n;
          prevVersion = undefined;
          serverSeq = undefined;
        } else {
          version = stored.version + 1n;
          prevVersion = stored.version;
          serverSeq = stored.serverSeq;
        }

        const now = Date.now();
        await store.put({
          kind: KIND_SNAPSHOT,
          objectId,
          ciphertext: blob.ciphertext,
          nonce: blob.nonce as Uint8Array,
          version,
          serverSeq,
          updatedAt: now,
        });
        await store.enqueue({
          kind: KIND_SNAPSHOT,
          objectId,
          ciphertext: blob.ciphertext,
          nonce: blob.nonce as Uint8Array,
          version,
          prevVersion,
          tombstone: false,
        });
        if (action.type === "update" && stored !== null) snapshotRewroteRef.current = true;
        tick();
        void client?.pushPending();
      } catch (err) {
        // Non-blocking: snapshot failure does not break the dashboard. The
        // next dashboard mount will retry. Log a name + message marker only
        // for known StorageError shapes; never log the raw err object, which
        // could expose ciphertext, nonce, or (after future refactor) the
        // plaintext snapshot payload via the call stack.
        if (err instanceof StorageError) {
          // biome-ignore lint/suspicious/noConsole: surface snapshot write failure
          console.warn(`[dashboard] snapshot write failed: ${err.name}: ${err.message}`);
        } else if (err instanceof Error) {
          // biome-ignore lint/suspicious/noConsole: surface snapshot write failure
          console.warn(`[dashboard] snapshot write failed: ${err.name}`);
        } else {
          // biome-ignore lint/suspicious/noConsole: surface snapshot write failure
          console.warn("[dashboard] snapshot write failed");
        }
      } finally {
        snapshotWritingRef.current = false;
      }
    })();
  }, [netWorthCentsTrigger, snapshotsKeyTrigger, store, client, tick]);

  return data;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export type { Delta } from "./_math";
export { deriveAggregateDeltas, splitCashAndInvestments } from "./_math";

// Assets-only allocation: liabilities are excluded so the pie shows parts of
// a positive whole (gross assets). This matches every personal-finance app's
// convention; mixing in negative liabilities would make "% of total" lie.
function buildKindSlices(breakdown: ReturnType<typeof computeNetWorth>): AllocationSlice[] {
  const { cash, investments } = splitCashAndInvestments(breakdown);
  const manualAsset = breakdown.byAccountKind.manualAsset;

  const total = cash.add(investments).add(manualAsset);

  const candidates: Array<{ label: string; value: Decimal }> = [
    { label: "Cash", value: cash },
    { label: "Investments", value: investments },
    { label: "Manual assets", value: manualAsset },
  ];

  return candidates
    .filter((c) => !c.value.isZero() && !c.value.isNegative())
    .map((c) => ({
      label: c.label,
      value: c.value,
      share: total.isZero() ? 0 : c.value.toFloat() / total.toFloat(),
    }))
    .sort((a, b) => b.value.cmp(a.value));
}
