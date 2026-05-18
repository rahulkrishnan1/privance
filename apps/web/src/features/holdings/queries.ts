"use client";

import {
  HoldingGroupPayloadSchema,
  HoldingPayloadSchema,
  type SymbolProfile,
} from "@privance/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { lookupProfiles } from "@/lib/api/profiles";
import { useSync } from "@/providers/sync-context";
import type { LocalGroup, LocalHolding } from "./types";
import { KIND_GROUP, KIND_HOLDING } from "./types";

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// useHoldingsQuery
// ---------------------------------------------------------------------------

export type HoldingsQueryResult = {
  holdings: LocalHolding[];
  loading: boolean;
  error: Error | null;
  reload: () => void;
};

export function useHoldingsQuery(): HoldingsQueryResult {
  const { store, initialising, decrypt } = useSync();
  const [holdings, setHoldings] = useState<LocalHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const cancelRef = useRef(false);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a manual reload counter
  useEffect(() => {
    if (initialising || store === null) {
      setLoading(initialising);
      return;
    }

    cancelRef.current = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const raw = await store.list({ kind: KIND_HOLDING });
        if (cancelRef.current) return;

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
          } catch {
            // Skip objects that fail to decrypt (locked or corrupted)
          }
        }

        if (cancelRef.current) return;
        setHoldings(parsed);
        setLoading(false);
      } catch (err) {
        if (cancelRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelRef.current = true;
    };
  }, [store, initialising, decrypt, tick]);

  return { holdings, loading, error, reload };
}

// ---------------------------------------------------------------------------
// useGroupsQuery
// ---------------------------------------------------------------------------

export type GroupsQueryResult = {
  groups: LocalGroup[];
  loading: boolean;
  error: Error | null;
  reload: () => void;
};

export function useGroupsQuery(): GroupsQueryResult {
  const { store, initialising, decrypt } = useSync();
  const [groups, setGroups] = useState<LocalGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const cancelRef = useRef(false);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a manual reload counter
  useEffect(() => {
    if (initialising || store === null) {
      setLoading(initialising);
      return;
    }

    cancelRef.current = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const raw = await store.list({ kind: KIND_GROUP });
        if (cancelRef.current) return;

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
          } catch {
            // Skip undecryptable objects
          }
        }

        if (cancelRef.current) return;
        setGroups(parsed);
        setLoading(false);
      } catch (err) {
        if (cancelRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelRef.current = true;
    };
  }, [store, initialising, decrypt, tick]);

  return { groups, loading, error, reload };
}

// ---------------------------------------------------------------------------
// useTickerLookup
// ---------------------------------------------------------------------------

export function useTickerLookup(query: string): {
  results: SymbolProfile[];
  fetching: boolean;
} {
  const trimmed = query.trim().toUpperCase();
  const enabled = trimmed.length >= 1;

  const { data, isFetching } = useQuery({
    queryKey: ["ticker-lookup", trimmed],
    queryFn: async () => {
      const res = await lookupProfiles([trimmed]);
      return res.profiles;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  return {
    results: data ?? [],
    fetching: isFetching,
  };
}
