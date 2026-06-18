"use client";

import {
  encryptAead,
  type HoldingGroupPayload,
  HoldingPayloadSchema,
  KDF_PARAM_VERSION,
  LABEL_VERSION,
  type Nonce,
} from "@privance/core";
import { useCallback, useState } from "react";
import { readItemsKey, useSync } from "@/providers";
import { clearStaleProxyAnchor } from "./_helpers";
import { KIND_GROUP, KIND_HOLDING } from "./types";

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

export type CreateHoldingInput = {
  accountId: string;
  groupId: string | null;
  ticker: string;
  assetType: "stock" | "crypto";
  proxyTicker: string | null;
  sharesMajor: string;
  sharesScale: number;
  costBasisCents: string;
  scaleFactor?: string;
  proxyAnchoredAt?: string;
  name?: string;
};
export type UpdateHoldingInput = Partial<CreateHoldingInput> & { id: string };

export type HoldingMutationResult = {
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  createHolding: (input: CreateHoldingInput) => Promise<string>;
  updateHolding: (input: UpdateHoldingInput) => Promise<void>;
  deleteHolding: (id: string) => Promise<void>;
};

export function useHoldingMutations(): HoldingMutationResult {
  const { store, client, decrypt, tick } = useSync();
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const createHolding = useCallback(
    async (input: CreateHoldingInput): Promise<string> => {
      if (store === null) throw new Error("Store not ready");
      setCreating(true);
      try {
        const id = newObjectId();
        const { ciphertext, nonce } = encryptPayload(input, id, KIND_HOLDING);
        const now = Date.now();
        await store.put({
          kind: KIND_HOLDING,
          objectId: id,
          ciphertext,
          nonce,
          version: 1n,
          updatedAt: now,
        });
        await store.enqueue({
          kind: KIND_HOLDING,
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

  const updateHolding = useCallback(
    async (input: UpdateHoldingInput): Promise<void> => {
      if (store === null) throw new Error("Store not ready");
      setUpdating(true);
      try {
        const { id, ...patch } = input;
        const existing = await store.get({ kind: KIND_HOLDING, objectId: id });
        if (existing === null) throw new Error("Holding not found");

        const plaintext = decrypt({
          ciphertext: existing.ciphertext,
          nonce: existing.nonce as Nonce,
          objectId: id,
          kind: KIND_HOLDING,
        });
        const current = HoldingPayloadSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
        const updated = clearStaleProxyAnchor({ ...current, ...patch });

        const newVersion = existing.version + 1n;
        const { ciphertext, nonce } = encryptPayload(updated, id, KIND_HOLDING);
        const now = Date.now();
        await store.put({
          kind: KIND_HOLDING,
          objectId: id,
          ciphertext,
          nonce,
          version: newVersion,
          serverSeq: existing.serverSeq,
          updatedAt: now,
        });
        await store.enqueue({
          kind: KIND_HOLDING,
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

  const deleteHolding = useCallback(
    async (id: string): Promise<void> => {
      if (store === null) throw new Error("Store not ready");
      setDeleting(true);
      try {
        const existing = await store.get({ kind: KIND_HOLDING, objectId: id });
        if (existing === null) throw new Error("Holding not found");

        const newVersion = existing.version + 1n;
        const now = Date.now();
        await store.put({
          kind: KIND_HOLDING,
          objectId: id,
          ciphertext: existing.ciphertext,
          nonce: existing.nonce,
          version: newVersion,
          serverSeq: existing.serverSeq,
          tombstone: true,
          updatedAt: now,
        });
        await store.enqueue({
          kind: KIND_HOLDING,
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

  return { creating, updating, deleting, createHolding, updateHolding, deleteHolding };
}

export type CreateGroupInput = HoldingGroupPayload;
export type UpdateGroupInput = HoldingGroupPayload & { id: string };

export type GroupMutationResult = {
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  createGroup: (input: CreateGroupInput) => Promise<string>;
  updateGroup: (input: UpdateGroupInput) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
};

export function useGroupMutations(): GroupMutationResult {
  const { store, client, tick } = useSync();
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const createGroup = useCallback(
    async (input: CreateGroupInput): Promise<string> => {
      if (store === null) throw new Error("Store not ready");
      setCreating(true);
      try {
        const id = newObjectId();
        const { ciphertext, nonce } = encryptPayload(input, id, KIND_GROUP);
        const now = Date.now();
        await store.put({
          kind: KIND_GROUP,
          objectId: id,
          ciphertext,
          nonce,
          version: 1n,
          updatedAt: now,
        });
        await store.enqueue({
          kind: KIND_GROUP,
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

  const updateGroup = useCallback(
    async (input: UpdateGroupInput): Promise<void> => {
      if (store === null) throw new Error("Store not ready");
      setUpdating(true);
      try {
        const { id, ...payload } = input;
        const existing = await store.get({ kind: KIND_GROUP, objectId: id });
        if (existing === null) throw new Error("Group not found");

        const newVersion = existing.version + 1n;
        const { ciphertext, nonce } = encryptPayload(payload, id, KIND_GROUP);
        const now = Date.now();
        await store.put({
          kind: KIND_GROUP,
          objectId: id,
          ciphertext,
          nonce,
          version: newVersion,
          serverSeq: existing.serverSeq,
          updatedAt: now,
        });
        await store.enqueue({
          kind: KIND_GROUP,
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
    [store, client, tick],
  );

  const deleteGroup = useCallback(
    async (id: string): Promise<void> => {
      if (store === null) throw new Error("Store not ready");
      setDeleting(true);
      try {
        const existing = await store.get({ kind: KIND_GROUP, objectId: id });
        if (existing === null) throw new Error("Group not found");

        const newVersion = existing.version + 1n;
        const now = Date.now();
        await store.put({
          kind: KIND_GROUP,
          objectId: id,
          ciphertext: existing.ciphertext,
          nonce: existing.nonce,
          version: newVersion,
          serverSeq: existing.serverSeq,
          tombstone: true,
          updatedAt: now,
        });
        await store.enqueue({
          kind: KIND_GROUP,
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

  return { creating, updating, deleting, createGroup, updateGroup, deleteGroup };
}
