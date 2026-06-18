"use client";

import type { PlanPayload } from "@privance/core";
import {
  encryptAead,
  KDF_PARAM_VERSION,
  KIND_PLAN,
  LABEL_VERSION,
  PLAN_OBJECT_ID,
  PlanPayloadSchema,
} from "@privance/core";
import { useCallback, useState } from "react";
import { readItemsKey, useSync } from "@/providers/index";

function encryptPlanPayload(opts: { payload: PlanPayload }): {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
} {
  const key = readItemsKey();
  if (key === null) throw new Error("locked");
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(opts.payload));
  return encryptAead({
    plaintext,
    key,
    aad: {
      recordUuid: PLAN_OBJECT_ID,
      kind: KIND_PLAN,
      labelVersion: LABEL_VERSION,
      kdfParamVersion: KDF_PARAM_VERSION,
    },
  });
}

type MutationState = "idle" | "pending" | "error";

export function useSavePlan(): {
  savePlan: (payload: PlanPayload) => Promise<void>;
  state: MutationState;
  error: Error | null;
} {
  const { store, client, tick } = useSync();
  const [state, setState] = useState<MutationState>("idle");
  const [error, setError] = useState<Error | null>(null);

  const savePlan = useCallback(
    async (payload: PlanPayload) => {
      if (store === null) throw new Error("store not ready");
      setState("pending");
      setError(null);
      try {
        // Fail closed: never persist a payload the read path can't validate back,
        // which would brick the plan with an unrecoverable load error.
        PlanPayloadSchema.parse(payload);
        const objectId = PLAN_OBJECT_ID;
        const existing = await store.get({ kind: KIND_PLAN, objectId });
        const prevVersion = existing?.version ?? undefined;
        const version = prevVersion !== undefined ? prevVersion + 1n : 1n;

        const { ciphertext, nonce } = encryptPlanPayload({ payload });

        await store.put({
          kind: KIND_PLAN,
          objectId,
          ciphertext,
          nonce,
          version,
          tombstone: false,
          updatedAt: Date.now(),
        });
        await store.enqueue({
          kind: KIND_PLAN,
          objectId,
          ciphertext,
          nonce,
          version,
          prevVersion,
          tombstone: false,
        });
        setState("idle");
        tick();
        void client?.pushPending();
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setState("error");
        throw e;
      }
    },
    [store, client, tick],
  );

  return { savePlan, state, error };
}
