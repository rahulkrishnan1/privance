"use client";

import { HoldingGroupPayloadSchema, HoldingPayloadSchema } from "@privance/core";
import { useEffect, useMemo, useState } from "react";
import { useSymbolProfilesQuery } from "@/lib/queries/profiles";
import { useSync } from "@/providers";
import { humanizeCryptoId } from "./_helpers";
import type { LocalGroup, LocalHolding } from "./types";
import { KIND_GROUP, KIND_HOLDING } from "./types";

function parseHolding(objectId: string, bytes: Uint8Array, updatedAt: number): LocalHolding | null {
  try {
    const text = new TextDecoder().decode(bytes);
    const p = HoldingPayloadSchema.parse(JSON.parse(text));
    return {
      id: objectId,
      accountId: p.accountId,
      groupId: p.groupId,
      ticker: p.ticker,
      assetType: p.assetType,
      proxyTicker: p.proxyTicker,
      sharesMajor: p.sharesMajor,
      sharesScale: p.sharesScale,
      costBasisCents: p.costBasisCents,
      scaleFactor: p.scaleFactor,
      proxyAnchoredAt: p.proxyAnchoredAt,
      name: p.name,
      updatedAt,
    };
  } catch {
    return null;
  }
}

function parseGroup(objectId: string, bytes: Uint8Array, updatedAt: number): LocalGroup | null {
  try {
    const text = new TextDecoder().decode(bytes);
    const p = HoldingGroupPayloadSchema.parse(JSON.parse(text));
    return {
      id: objectId,
      name: p.name,
      updatedAt,
    };
  } catch {
    return null;
  }
}

type HoldingsQueryResult = {
  holdings: LocalHolding[];
  loading: boolean;
  error: Error | null;
};

export function useHoldingsQuery(): HoldingsQueryResult {
  const { store, initialising, decrypt, storeClock } = useSync();
  const [parsedHoldings, setParsedHoldings] = useState<LocalHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: storeClock is an external invalidation signal, mutations call tick() to trigger a re-run
  useEffect(() => {
    if (initialising || store === null) {
      setLoading(initialising);
      return;
    }

    // Per-effect flag (not a shared ref): a re-fired effect must not un-cancel a
    // still-in-flight prior load, or an out-of-order resolve would clobber fresh data.
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const raw = await store.list({ kind: KIND_HOLDING });
        if (cancelled) return;

        const parsed: LocalHolding[] = [];
        for (const obj of raw) {
          if (obj.tombstone) continue;
          try {
            const plaintext = decrypt({
              ciphertext: obj.ciphertext,
              nonce: obj.nonce,
              objectId: obj.objectId,
              kind: KIND_HOLDING,
            });
            const h = parseHolding(obj.objectId, plaintext, obj.updatedAt);
            if (h !== null) parsed.push(h);
          } catch {}
        }

        if (cancelled) return;
        setParsedHoldings(parsed);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [store, initialising, decrypt, storeClock]);

  // Look up display names off each holding's own ticker (not the proxy, which
  // is a public ETF stand-in) and enrich reactively so names appear when the
  // lookup resolves. Build new objects; never mutate the parsed records.
  const tickers = useMemo(() => parsedHoldings.map((h) => h.ticker), [parsedHoldings]);
  const { profilesByTicker } = useSymbolProfilesQuery(tickers);

  const holdings = useMemo(
    () =>
      parsedHoldings.map((h) => {
        const profile = profilesByTicker.get(h.ticker);
        const name =
          profile?.displayName ??
          h.name ??
          (h.assetType === "crypto" ? humanizeCryptoId(h.ticker) : undefined);
        if (profile === undefined && name === h.name) return h;
        return {
          ...h,
          name,
          sector: profile?.sector ?? h.sector,
          assetClass: profile?.assetClass ?? h.assetClass,
          dividendYield: profile?.dividendYield ?? h.dividendYield,
        };
      }),
    [parsedHoldings, profilesByTicker],
  );

  return { holdings, loading, error };
}

type GroupsQueryResult = {
  groups: LocalGroup[];
  loading: boolean;
  error: Error | null;
};

export function useGroupsQuery(): GroupsQueryResult {
  const { store, initialising, decrypt, storeClock } = useSync();
  const [groups, setGroups] = useState<LocalGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: storeClock is an external invalidation signal, mutations call tick() to trigger a re-run
  useEffect(() => {
    if (initialising || store === null) {
      setLoading(initialising);
      return;
    }

    // Per-effect flag (not a shared ref); see useHoldingsQuery for the rationale.
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const raw = await store.list({ kind: KIND_GROUP });
        if (cancelled) return;

        const parsed: LocalGroup[] = [];
        for (const obj of raw) {
          if (obj.tombstone) continue;
          try {
            const plaintext = decrypt({
              ciphertext: obj.ciphertext,
              nonce: obj.nonce,
              objectId: obj.objectId,
              kind: KIND_GROUP,
            });
            const g = parseGroup(obj.objectId, plaintext, obj.updatedAt);
            if (g !== null) parsed.push(g);
          } catch {}
        }

        if (cancelled) return;
        setGroups(parsed);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [store, initialising, decrypt, storeClock]);

  return { groups, loading, error };
}
