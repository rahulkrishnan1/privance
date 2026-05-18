"use client";

import type { Account, AccountKind } from "@privance/core";
import { encryptAead, KDF_PARAM_VERSION, LABEL_VERSION } from "@privance/core";
import { useCallback, useState } from "react";
import { readItemsKey, useSync } from "@/providers/index";

// ---------------------------------------------------------------------------
// Encryption helper
// ---------------------------------------------------------------------------

function encryptPayload(opts: { payload: unknown; objectId: string }): {
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
      recordUuid: opts.objectId,
      kind: "account",
      labelVersion: LABEL_VERSION,
      kdfParamVersion: KDF_PARAM_VERSION,
    },
  });
}

// ---------------------------------------------------------------------------
// Payload builders per kind
// ---------------------------------------------------------------------------

type CreateInput = {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  /** Balance as a decimal string, e.g. "1234.56". */
  balanceString: string;
};

function buildPayload(input: CreateInput): unknown {
  const cents = balanceStringToCents(input.balanceString);
  switch (input.kind) {
    case "cash":
      return {
        kind: "cash",
        subKind: "checking",
        name: input.name,
        balanceCents: cents,
        currency: input.currency,
      };
    case "investment":
      return {
        kind: "investment",
        subKind: "brokerage",
        name: input.name,
        cashBalanceCents: cents,
        currency: input.currency,
        assetType: "stock",
      };
    case "liability":
      return {
        kind: "liability",
        subKind: "credit_card",
        name: input.name,
        balanceCents: cents,
        currency: input.currency,
      };
    case "manual_asset":
      return {
        kind: "manual_asset",
        subKind: "other_asset",
        name: input.name,
        valueCents: cents,
        currency: input.currency,
      };
  }
}

/** Convert a decimal string like "1234.56" to minor-unit bigint string "123456". */
function balanceStringToCents(s: string): string {
  const trimmed = s.trim();
  const isNeg = trimmed.startsWith("-");
  const unsigned = isNeg ? trimmed.slice(1) : trimmed;
  const dotIdx = unsigned.indexOf(".");
  let intPart: string;
  let fracPart: string;
  if (dotIdx === -1) {
    intPart = unsigned;
    fracPart = "00";
  } else {
    intPart = unsigned.slice(0, dotIdx);
    fracPart = unsigned
      .slice(dotIdx + 1)
      .padEnd(2, "0")
      .slice(0, 2);
  }
  const cents = BigInt(intPart) * 100n + BigInt(fracPart);
  return isNeg ? (-cents).toString() : cents.toString();
}

// ---------------------------------------------------------------------------
// Mutation state
// ---------------------------------------------------------------------------

type MutationState = "idle" | "pending" | "error";

// ---------------------------------------------------------------------------
// useCreateAccount
// ---------------------------------------------------------------------------

export function useCreateAccount(): {
  create: (input: CreateInput) => Promise<void>;
  state: MutationState;
  error: Error | null;
} {
  const { store, client, tick } = useSync();
  const [state, setState] = useState<MutationState>("idle");
  const [error, setError] = useState<Error | null>(null);

  const create = useCallback(
    async (input: CreateInput) => {
      if (store === null) throw new Error("store not ready");
      setState("pending");
      setError(null);
      try {
        const payload = buildPayload(input);
        const { ciphertext, nonce } = encryptPayload({ payload, objectId: input.id });
        await store.put({
          kind: "account",
          objectId: input.id,
          ciphertext,
          nonce,
          version: 1n,
          tombstone: false,
          updatedAt: Date.now(),
        });
        await store.enqueue({
          kind: "account",
          objectId: input.id,
          ciphertext,
          nonce,
          version: 1n,
          prevVersion: undefined,
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

  return { create, state, error };
}

// ---------------------------------------------------------------------------
// useUpdateAccount
// ---------------------------------------------------------------------------

type UpdateInput = {
  account: Account;
  name: string;
  currency: string;
  balanceString: string;
};

export function useUpdateAccount(): {
  update: (input: UpdateInput) => Promise<void>;
  state: MutationState;
  error: Error | null;
} {
  const { store, client, tick } = useSync();
  const [state, setState] = useState<MutationState>("idle");
  const [error, setError] = useState<Error | null>(null);

  const update = useCallback(
    async (input: UpdateInput) => {
      if (store === null) throw new Error("store not ready");
      setState("pending");
      setError(null);
      try {
        const objectId = input.account.id;
        const existing = await store.get({ kind: "account", objectId });
        const prevVersion = existing?.version ?? 1n;
        const nextVersion = prevVersion + 1n;

        const cents = balanceStringToCents(input.balanceString);

        const prev = input.account.payload;
        let merged: unknown;
        switch (prev.kind) {
          case "cash":
            merged = { ...prev, name: input.name, currency: input.currency, balanceCents: cents };
            break;
          case "investment":
            merged = {
              ...prev,
              name: input.name,
              currency: input.currency,
              cashBalanceCents: cents,
            };
            break;
          case "liability":
            merged = { ...prev, name: input.name, currency: input.currency, balanceCents: cents };
            break;
          case "manual_asset":
            merged = { ...prev, name: input.name, currency: input.currency, valueCents: cents };
            break;
        }

        const { ciphertext, nonce } = encryptPayload({ payload: merged, objectId });
        await store.put({
          kind: "account",
          objectId,
          ciphertext,
          nonce,
          version: nextVersion,
          tombstone: false,
          updatedAt: Date.now(),
        });
        await store.enqueue({
          kind: "account",
          objectId,
          ciphertext,
          nonce,
          version: nextVersion,
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

  return { update, state, error };
}

// ---------------------------------------------------------------------------
// useDeleteAccount
//
// Permanently removes an account by writing a tombstone. The sync server treats
// tombstoned objects as deleted and the local store hides them. Reversible
// archive (`archived` flag preserved server-side) is not in the current schema;
// adding it requires bumping the Account payload schema in @privance/core and
// is tracked as a follow-up.
// ---------------------------------------------------------------------------

export function useDeleteAccount(): {
  deleteAccount: (account: Account) => Promise<void>;
  state: MutationState;
  error: Error | null;
} {
  const { store, client, tick } = useSync();
  const [state, setState] = useState<MutationState>("idle");
  const [error, setError] = useState<Error | null>(null);

  const deleteAccount = useCallback(
    async (account: Account) => {
      if (store === null) throw new Error("store not ready");
      setState("pending");
      setError(null);
      try {
        const objectId = account.id;
        const existing = await store.get({ kind: "account", objectId });
        const prevVersion = existing?.version ?? 1n;
        const nextVersion = prevVersion + 1n;

        const { ciphertext, nonce } = encryptPayload({
          payload: account.payload,
          objectId,
        });

        await store.put({
          kind: "account",
          objectId,
          ciphertext,
          nonce,
          version: nextVersion,
          tombstone: true,
          updatedAt: Date.now(),
        });
        await store.enqueue({
          kind: "account",
          objectId,
          ciphertext,
          nonce,
          version: nextVersion,
          prevVersion,
          tombstone: true,
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

  return { deleteAccount, state, error };
}
