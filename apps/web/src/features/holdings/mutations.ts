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

type CreateHoldingInput = {
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
type UpdateHoldingInput = Partial<CreateHoldingInput> & { id: string };

type HoldingMutationResult = {
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  createHolding: (input: CreateHoldingInput, id?: string) => Promise<string>;
  updateHolding: (input: UpdateHoldingInput) => Promise<void>;
  deleteHolding: (id: string) => Promise<void>;
};

export function useHoldingMutations(): HoldingMutationResult {
  const { store, save, decrypt } = useSync();
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const createHolding = useCallback(
    async (input: CreateHoldingInput, id = newObjectId()): Promise<string> => {
      if (store === null) throw new Error("Store not ready");
      setCreating(true);
      try {
        const existing = await store.get({ kind: KIND_HOLDING, objectId: id });
        const prevVersion = existing?.version;
        const version = prevVersion === undefined ? 1n : prevVersion + 1n;
        const { ciphertext, nonce } = encryptPayload(input, id, KIND_HOLDING);
        await save({
          kind: KIND_HOLDING,
          objectId: id,
          ciphertext,
          nonce,
          version,
          prevVersion,
          tombstone: false,
        });
        return id;
      } finally {
        setCreating(false);
      }
    },
    [store, save],
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
        await save({
          kind: KIND_HOLDING,
          objectId: id,
          ciphertext,
          nonce,
          version: newVersion,
          prevVersion: existing.version,
          tombstone: false,
        });
      } finally {
        setUpdating(false);
      }
    },
    [store, save, decrypt],
  );

  const deleteHolding = useCallback(
    async (id: string): Promise<void> => {
      if (store === null) throw new Error("Store not ready");
      setDeleting(true);
      try {
        const existing = await store.get({ kind: KIND_HOLDING, objectId: id });
        if (existing === null) throw new Error("Holding not found");

        const newVersion = existing.version + 1n;
        await save({
          kind: KIND_HOLDING,
          objectId: id,
          ciphertext: existing.ciphertext,
          nonce: existing.nonce,
          version: newVersion,
          prevVersion: existing.version,
          tombstone: true,
        });
      } finally {
        setDeleting(false);
      }
    },
    [store, save],
  );

  return { creating, updating, deleting, createHolding, updateHolding, deleteHolding };
}

type CreateGroupInput = HoldingGroupPayload;
type UpdateGroupInput = HoldingGroupPayload & { id: string };

type GroupMutationResult = {
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  createGroup: (input: CreateGroupInput, id?: string) => Promise<string>;
  updateGroup: (input: UpdateGroupInput) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
};

export function useGroupMutations(): GroupMutationResult {
  const { store, save } = useSync();
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const createGroup = useCallback(
    async (input: CreateGroupInput, id = newObjectId()): Promise<string> => {
      if (store === null) throw new Error("Store not ready");
      setCreating(true);
      try {
        const existing = await store.get({ kind: KIND_GROUP, objectId: id });
        const prevVersion = existing?.version;
        const version = prevVersion === undefined ? 1n : prevVersion + 1n;
        const { ciphertext, nonce } = encryptPayload(input, id, KIND_GROUP);
        await save({
          kind: KIND_GROUP,
          objectId: id,
          ciphertext,
          nonce,
          version,
          prevVersion,
          tombstone: false,
        });
        return id;
      } finally {
        setCreating(false);
      }
    },
    [store, save],
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
        await save({
          kind: KIND_GROUP,
          objectId: id,
          ciphertext,
          nonce,
          version: newVersion,
          prevVersion: existing.version,
          tombstone: false,
        });
      } finally {
        setUpdating(false);
      }
    },
    [store, save],
  );

  const deleteGroup = useCallback(
    async (id: string): Promise<void> => {
      if (store === null) throw new Error("Store not ready");
      setDeleting(true);
      try {
        const existing = await store.get({ kind: KIND_GROUP, objectId: id });
        if (existing === null) throw new Error("Group not found");

        const newVersion = existing.version + 1n;
        await save({
          kind: KIND_GROUP,
          objectId: id,
          ciphertext: existing.ciphertext,
          nonce: existing.nonce,
          version: newVersion,
          prevVersion: existing.version,
          tombstone: true,
        });
      } finally {
        setDeleting(false);
      }
    },
    [store, save],
  );

  return { creating, updating, deleting, createGroup, updateGroup, deleteGroup };
}
