"use client";

import { SpendItemPayloadSchema } from "@privance/core";
import { useEffect, useState } from "react";
import { useSync } from "@/providers";
import type { LocalSpendItem } from "./types";
import { KIND_SPEND } from "./types";

function parseSpendItem(
  objectId: string,
  bytes: Uint8Array,
  updatedAt: number,
): LocalSpendItem | null {
  try {
    const text = new TextDecoder().decode(bytes);
    const p = SpendItemPayloadSchema.parse(JSON.parse(text));
    return {
      id: objectId,
      name: p.name,
      amountCents: p.amountCents,
      intervalCount: p.intervalCount,
      intervalUnit: p.intervalUnit,
      category: p.category,
      group: p.group,
      nextRenewalAt: p.nextRenewalAt,
      status: p.status,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export type SpendItemsQueryResult = {
  items: LocalSpendItem[];
  loading: boolean;
  error: Error | null;
};

export function useSpendItemsQuery(): SpendItemsQueryResult {
  const { store, initialising, decrypt, storeClock } = useSync();
  const [items, setItems] = useState<LocalSpendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: storeClock is an external invalidation signal, mutations call tick() to trigger a re-run
  useEffect(() => {
    if (initialising || store === null) {
      setLoading(initialising);
      return;
    }

    // Per-effect flag, not a shared ref: a re-run must not reset a prior
    // in-flight load's cancellation and let its stale result win.
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const raw = await store.list({ kind: KIND_SPEND });
        if (cancelled) return;

        const parsed: LocalSpendItem[] = [];
        for (const obj of raw) {
          if (obj.tombstone) continue;
          try {
            const plaintext = decrypt({
              ciphertext: obj.ciphertext,
              nonce: obj.nonce,
              objectId: obj.objectId,
              kind: KIND_SPEND,
            });
            const item = parseSpendItem(obj.objectId, plaintext, obj.updatedAt);
            if (item !== null) parsed.push(item);
          } catch {
            // Skip undecryptable objects
          }
        }

        if (cancelled) return;
        setItems(parsed);
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

  return { items, loading, error };
}
