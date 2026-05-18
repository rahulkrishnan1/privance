"use client";

import type { Account, AccountId, UserId } from "@privance/core";
import { AccountPayloadSchema, asId, asIsoDateTime } from "@privance/core";
import { useCallback, useEffect, useState } from "react";
import { useSync } from "@/providers/sync-context";
import { centsToDecimal, getBalanceCents, sumBalances } from "./balance";

export { centsToDecimal, getBalanceCents, sumBalances };

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function parseAccount(
  raw: unknown,
  meta: { id: string; createdAt: string; lastUpdatedAt: string; userId?: string },
): Account {
  const payload = AccountPayloadSchema.parse(raw);
  return {
    id: asId<AccountId>(meta.id),
    userId: asId<UserId>(meta.userId ?? ""),
    createdAt: asIsoDateTime(meta.createdAt),
    lastUpdatedAt: asIsoDateTime(meta.lastUpdatedAt),
    payload,
  } as Account;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type AccountsQueryState =
  | { status: "initialising" }
  | { status: "error"; error: Error }
  | { status: "success"; data: Account[] };

/**
 * Reads all non-tombstoned accounts from the local store, decrypts each
 * payload, and returns the typed records. Re-evaluates whenever the store
 * reference changes (i.e. on unlock / teardown) or after any local mutation
 * (via storeClock).
 */
export function useAccountsQuery(): AccountsQueryState {
  const { store, initialising, decrypt, storeClock } = useSync();
  const [state, setState] = useState<AccountsQueryState>({ status: "initialising" });

  const load = useCallback(async () => {
    if (store === null) {
      setState({ status: "initialising" });
      return;
    }

    try {
      const rows = await store.list({ kind: "account" });
      const live = rows.filter((r) => !r.tombstone);
      const accounts = await Promise.all(
        live.map(async (row) => {
          const plaintext = decrypt({
            ciphertext: row.ciphertext,
            nonce: row.nonce,
            objectId: row.objectId,
            kind: "account",
          });
          const raw = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
          return parseAccount(raw, {
            id: row.objectId,
            createdAt: new Date(row.updatedAt).toISOString(),
            lastUpdatedAt: new Date(row.updatedAt).toISOString(),
          });
        }),
      );
      setState({ status: "success", data: accounts });
    } catch (err) {
      setState({
        status: "error",
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }, [store, decrypt]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: storeClock is an external invalidation signal, mutations call tick() to trigger a re-run
  useEffect(() => {
    if (initialising) {
      setState({ status: "initialising" });
      return;
    }
    void load();
  }, [initialising, load, storeClock]);

  return state;
}
