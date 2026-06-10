"use client";

import type { Plan, PlanId, UserId } from "@privance/core";
import { asId, asIsoDateTime, PLAN_OBJECT_ID, PlanPayloadSchema } from "@privance/core";
import { useCallback, useEffect, useState } from "react";
import { useSync } from "@/providers/sync-context";

// ---------------------------------------------------------------------------
// Parse helper
// ---------------------------------------------------------------------------

function parsePlan(raw: unknown, objectId: string): Plan {
  const payload = PlanPayloadSchema.parse(raw);
  const now = asIsoDateTime(new Date().toISOString());
  return {
    id: asId<PlanId>(objectId),
    userId: asId<UserId>(""),
    createdAt: now,
    updatedAt: now,
    payload,
  } as Plan;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type PlanQueryState =
  | { status: "initialising" }
  | { status: "error"; error: Error }
  | { status: "none" }
  | { status: "success"; data: Plan };

/**
 * Reads the singleton plan record from the local store, decrypts it, and
 * returns the typed Plan. Re-evaluates whenever the store changes (storeClock).
 * Returns `{ status: "none" }` when no plan record exists yet.
 */
export function usePlanRecord(): PlanQueryState {
  const { store, initialising, decrypt, storeClock } = useSync();
  const [state, setState] = useState<PlanQueryState>({ status: "initialising" });

  const load = useCallback(async () => {
    if (store === null) {
      setState({ status: "initialising" });
      return;
    }

    try {
      const row = await store.get({ kind: "plan", objectId: PLAN_OBJECT_ID });
      if (row === null || row.tombstone) {
        setState({ status: "none" });
        return;
      }

      const plaintext = decrypt({
        ciphertext: row.ciphertext,
        nonce: row.nonce,
        objectId: row.objectId,
        kind: "plan",
      });
      const raw = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
      const plan = parsePlan(raw, row.objectId);
      setState({ status: "success", data: plan });
    } catch (err) {
      setState({
        status: "error",
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }, [store, decrypt]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: storeClock is an external invalidation signal
  useEffect(() => {
    if (initialising) {
      setState({ status: "initialising" });
      return;
    }
    void load();
  }, [initialising, load, storeClock]);

  return state;
}
