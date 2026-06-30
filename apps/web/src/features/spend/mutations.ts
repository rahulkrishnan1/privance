"use client";

import {
  Decimal,
  encryptAead,
  KDF_PARAM_VERSION,
  LABEL_VERSION,
  type Nonce,
  SCALE_CENTS,
  SpendItemPayloadSchema,
} from "@privance/core";
import { useCallback, useState } from "react";
import { readItemsKey, useSync } from "@/providers";
import type { SpendFormValues } from "./types";
import { KIND_SPEND } from "./types";

function encryptPayload(
  payload: unknown,
  objectId: string,
  kind: string,
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const key = readItemsKey();
  if (key === null) throw new Error("locked");
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const blob = encryptAead({
    plaintext,
    key,
    aad: {
      recordUuid: objectId,
      kind,
      labelVersion: LABEL_VERSION,
      kdfParamVersion: KDF_PARAM_VERSION,
    },
  });
  return { ciphertext: blob.ciphertext, nonce: blob.nonce as Uint8Array };
}

function newObjectId(): string {
  return crypto.randomUUID();
}

// Converts the display dollar string (e.g. "15.49") to an integer cents string
// (e.g. "1549") via Decimal, the house money-conversion path. The form schema
// validates the shape (max 2dp) before this runs.
function dollarsToCents(amount: string): string {
  return Decimal.fromString(amount, SCALE_CENTS).toMinorUnits().toString();
}

type SpendMutationResult = {
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  createItem: (values: SpendFormValues) => Promise<string>;
  updateItem: (id: string, values: SpendFormValues) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
};

export function useSpendMutations(): SpendMutationResult {
  const { store, client, decrypt, tick } = useSync();
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const createItem = useCallback(
    async (values: SpendFormValues): Promise<string> => {
      if (store === null) throw new Error("Store not ready");
      setCreating(true);
      try {
        const id = newObjectId();
        // Validate through the payload schema before encrypting, mirroring
        // updateItem. The form values are string-typed for placeholder handling;
        // parse narrows and rejects anything the form refinements somehow missed
        // rather than encrypting a malformed record.
        const payload = SpendItemPayloadSchema.parse({
          name: values.name,
          amountCents: dollarsToCents(values.amount),
          intervalCount: Number(values.intervalCount),
          intervalUnit: values.intervalUnit,
          category: values.category,
          group: values.group,
          nextRenewalAt: values.nextRenewalAt || undefined,
          status: values.status,
        });
        const { ciphertext, nonce } = encryptPayload(payload, id, KIND_SPEND);
        const now = Date.now();
        await store.put({
          kind: KIND_SPEND,
          objectId: id,
          ciphertext,
          nonce,
          version: 1n,
          updatedAt: now,
        });
        await store.enqueue({
          kind: KIND_SPEND,
          objectId: id,
          ciphertext,
          nonce,
          version: 1n,
          prevVersion: undefined,
          tombstone: false,
          enqueuedAt: now,
        } as Parameters<typeof store.enqueue>[0]);
        tick();
        void client?.pushPending();
        return id;
      } finally {
        setCreating(false);
      }
    },
    [store, client, tick],
  );

  const updateItem = useCallback(
    async (id: string, values: SpendFormValues): Promise<void> => {
      if (store === null) throw new Error("Store not ready");
      setUpdating(true);
      try {
        const existing = await store.get({ kind: KIND_SPEND, objectId: id });
        if (existing === null) throw new Error("Item not found");

        const plaintext = decrypt({
          ciphertext: existing.ciphertext,
          nonce: existing.nonce as Nonce,
          objectId: id,
          kind: KIND_SPEND,
        });
        const current = SpendItemPayloadSchema.parse(
          JSON.parse(new TextDecoder().decode(plaintext)),
        );
        const updated = {
          ...current,
          name: values.name,
          amountCents: dollarsToCents(values.amount),
          intervalCount: Number(values.intervalCount),
          intervalUnit: values.intervalUnit,
          category: values.category,
          group: values.group,
          nextRenewalAt: values.nextRenewalAt || undefined,
          status: values.status,
        };

        const newVersion = existing.version + 1n;
        const { ciphertext, nonce } = encryptPayload(updated, id, KIND_SPEND);
        const now = Date.now();
        await store.put({
          kind: KIND_SPEND,
          objectId: id,
          ciphertext,
          nonce,
          version: newVersion,
          serverSeq: existing.serverSeq,
          updatedAt: now,
        });
        await store.enqueue({
          kind: KIND_SPEND,
          objectId: id,
          ciphertext,
          nonce,
          version: newVersion,
          prevVersion: existing.version,
          tombstone: false,
          enqueuedAt: now,
        } as Parameters<typeof store.enqueue>[0]);
        tick();
        void client?.pushPending();
      } finally {
        setUpdating(false);
      }
    },
    [store, client, decrypt, tick],
  );

  const deleteItem = useCallback(
    async (id: string): Promise<void> => {
      if (store === null) throw new Error("Store not ready");
      setDeleting(true);
      try {
        const existing = await store.get({ kind: KIND_SPEND, objectId: id });
        if (existing === null) throw new Error("Item not found");

        const newVersion = existing.version + 1n;
        const now = Date.now();
        await store.put({
          kind: KIND_SPEND,
          objectId: id,
          ciphertext: existing.ciphertext,
          nonce: existing.nonce,
          version: newVersion,
          serverSeq: existing.serverSeq,
          tombstone: true,
          updatedAt: now,
        });
        await store.enqueue({
          kind: KIND_SPEND,
          objectId: id,
          ciphertext: existing.ciphertext,
          nonce: existing.nonce,
          version: newVersion,
          prevVersion: existing.version,
          tombstone: true,
          enqueuedAt: now,
        } as Parameters<typeof store.enqueue>[0]);
        tick();
        void client?.pushPending();
      } finally {
        setDeleting(false);
      }
    },
    [store, client, tick],
  );

  return { creating, updating, deleting, createItem, updateItem, deleteItem };
}
