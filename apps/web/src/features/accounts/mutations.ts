"use client";

import type { Account, AccountKind } from "@privance/core";
import {
  Decimal,
  encryptAead,
  KDF_PARAM_VERSION,
  KIND_ACCOUNT,
  LABEL_VERSION,
  SCALE_CENTS,
} from "@privance/core";
import { useCallback, useState } from "react";
import { readItemsKey, useSync } from "@/providers";

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
      kind: KIND_ACCOUNT,
      labelVersion: LABEL_VERSION,
      kdfParamVersion: KDF_PARAM_VERSION,
    },
  });
}

type CreateInput = {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  /** Balance as a decimal string, e.g. "1234.56". */
  balanceString: string;
  /** Investment or cash account sub-kind. */
  subKind?: string;
  /** APY as a decimal fraction string (e.g. "0.041"), cash + investment sweep. */
  apy?: string;
  /** Interest rate as a decimal fraction string (e.g. "0.0625"), liability only. */
  interestRate?: string;
  /** Remaining term in years as a decimal string (e.g. "22"), liability only. */
  termYears?: string;
  /** Date the asset was last valued (ISO yyyy-mm-dd), manual_asset only. */
  valuedAt?: string;
};

function buildPayload(input: CreateInput): unknown {
  const cents = balanceStringToCents(input.balanceString);
  switch (input.kind) {
    case "cash": {
      const cashPayload: Record<string, unknown> = {
        kind: "cash",
        subKind: input.subKind ?? "checking",
        name: input.name,
        balanceCents: cents,
        currency: input.currency,
      };
      if (input.apy !== undefined && input.apy !== "") cashPayload.apy = input.apy;
      return cashPayload;
    }
    case "investment": {
      const investPayload: Record<string, unknown> = {
        kind: "investment",
        subKind: input.subKind ?? "brokerage",
        name: input.name,
        cashBalanceCents: cents,
        currency: input.currency,
        assetType: "stock",
      };
      if (input.apy !== undefined && input.apy !== "") investPayload.apy = input.apy;
      return investPayload;
    }
    case "liability": {
      const liabilityPayload: Record<string, unknown> = {
        kind: "liability",
        subKind: "credit_card",
        name: input.name,
        balanceCents: cents,
        currency: input.currency,
      };
      if (input.interestRate !== undefined && input.interestRate !== "")
        liabilityPayload.interestRate = input.interestRate;
      if (input.termYears !== undefined && input.termYears !== "")
        liabilityPayload.termYearsRemaining = input.termYears;
      return liabilityPayload;
    }
    case "manual_asset": {
      const assetPayload: Record<string, unknown> = {
        kind: "manual_asset",
        subKind: "other_asset",
        name: input.name,
        valueCents: cents,
        currency: input.currency,
      };
      if (input.valuedAt !== undefined && input.valuedAt !== "")
        assetPayload.valuedAt = input.valuedAt;
      return assetPayload;
    }
  }
}

function balanceStringToCents(s: string): string {
  return Decimal.fromString(s.trim(), SCALE_CENTS).toMinorUnits().toString();
}

type MutationState = "idle" | "pending" | "error";

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
          kind: KIND_ACCOUNT,
          objectId: input.id,
          ciphertext,
          nonce,
          version: 1n,
          tombstone: false,
          updatedAt: Date.now(),
        });
        await store.enqueue({
          kind: KIND_ACCOUNT,
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

type UpdateInput = {
  account: Account;
  name: string;
  currency: string;
  balanceString: string;
  subKind?: string;
  /** APY as a decimal fraction string (e.g. "0.041"), cash + investment sweep. */
  apy?: string;
  /** Interest rate as a decimal fraction string (e.g. "0.0625"), liability only. */
  interestRate?: string;
  /** Remaining term in years as a decimal string (e.g. "22"), liability only. */
  termYears?: string;
  /** Date the asset was last valued (ISO yyyy-mm-dd), manual_asset only. */
  valuedAt?: string;
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
        const existing = await store.get({ kind: KIND_ACCOUNT, objectId });
        const prevVersion = existing?.version ?? 1n;
        const nextVersion = prevVersion + 1n;

        const cents = balanceStringToCents(input.balanceString);

        const prev = input.account.payload;
        let merged: unknown;
        switch (prev.kind) {
          case "cash": {
            const cashMerge: Record<string, unknown> = {
              ...prev,
              name: input.name,
              currency: input.currency,
              balanceCents: cents,
            };
            if (input.subKind) cashMerge.subKind = input.subKind;
            if (input.apy !== undefined) {
              if (input.apy === "") {
                delete cashMerge.apy;
              } else {
                cashMerge.apy = input.apy;
              }
            }
            merged = cashMerge;
            break;
          }
          case "investment": {
            const investUpdate: Record<string, unknown> = {
              ...prev,
              name: input.name,
              currency: input.currency,
              cashBalanceCents: cents,
            };
            if (input.subKind) investUpdate.subKind = input.subKind;
            if (input.apy !== undefined) {
              if (input.apy === "") {
                delete investUpdate.apy;
              } else {
                investUpdate.apy = input.apy;
              }
            }
            merged = investUpdate;
            break;
          }
          case "liability": {
            const liabilityUpdate: Record<string, unknown> = {
              ...prev,
              name: input.name,
              currency: input.currency,
              balanceCents: cents,
            };
            if (input.interestRate !== undefined) {
              if (input.interestRate === "") {
                delete liabilityUpdate.interestRate;
              } else {
                liabilityUpdate.interestRate = input.interestRate;
              }
            }
            if (input.termYears !== undefined) {
              if (input.termYears === "") {
                delete liabilityUpdate.termYearsRemaining;
              } else {
                liabilityUpdate.termYearsRemaining = input.termYears;
              }
            }
            merged = liabilityUpdate;
            break;
          }
          case "manual_asset": {
            const assetMerge: Record<string, unknown> = {
              ...prev,
              name: input.name,
              currency: input.currency,
              valueCents: cents,
            };
            if (input.valuedAt !== undefined) {
              if (input.valuedAt === "") {
                delete assetMerge.valuedAt;
              } else {
                assetMerge.valuedAt = input.valuedAt;
              }
            }
            merged = assetMerge;
            break;
          }
        }

        const { ciphertext, nonce } = encryptPayload({ payload: merged, objectId });
        await store.put({
          kind: KIND_ACCOUNT,
          objectId,
          ciphertext,
          nonce,
          version: nextVersion,
          tombstone: false,
          updatedAt: Date.now(),
        });
        await store.enqueue({
          kind: KIND_ACCOUNT,
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

// Note: reversible archive is not in the current schema; adding it requires bumping the Account payload schema in @privance/core.
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
        const existing = await store.get({ kind: KIND_ACCOUNT, objectId });
        const prevVersion = existing?.version ?? 1n;
        const nextVersion = prevVersion + 1n;

        const { ciphertext, nonce } = encryptPayload({
          payload: account.payload,
          objectId,
        });

        await store.put({
          kind: KIND_ACCOUNT,
          objectId,
          ciphertext,
          nonce,
          version: nextVersion,
          tombstone: true,
          updatedAt: Date.now(),
        });
        await store.enqueue({
          kind: KIND_ACCOUNT,
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
