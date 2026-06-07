import { deriveBiometricKek, sealProtectorKey } from "@privance/core";
import { generateProtectorKeypair, saveEnrollment, wrapItemsKeyRsa } from "./biometric-store";

// Shared enrollment assembly for the biometric browser tests, so the four test
// files exercise one crypto-construction path instead of drifting copies.

export const BIOMETRIC_DB = "privance.biometric";
export const BIOMETRIC_OBJECT_STORE = "enrollment";
export const BIOMETRIC_RECORD_KEY = "current";

/** Builds a complete, internally consistent enrollment bundle without saving. */
export async function buildEnrollment(opts?: {
  userId?: string;
  username?: string;
  itemsKey?: Uint8Array;
  lastPasswordUnlockAt?: number;
}) {
  const userId = opts?.userId ?? "user-abc";
  const username = opts?.username ?? "alice";
  const itemsKey = opts?.itemsKey ?? crypto.getRandomValues(new Uint8Array(32));
  const { publicKeyBytes, pkcs8 } = await generateProtectorKeypair();
  const recordUuid = crypto.randomUUID();
  const credentialId = crypto.getRandomValues(new Uint8Array(16));
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const prfOutput = crypto.getRandomValues(new Uint8Array(32));
  const kek = deriveBiometricKek({ prfOutput, salt });
  const sealedPrivateKey = sealProtectorKey({
    pkcs8,
    kek,
    pubKeyBytes: publicKeyBytes,
    recordUuid,
  });
  const wrappedItemsKey = await wrapItemsKeyRsa({ itemsKey, publicKeyBytes, recordUuid });
  const pkcs8Bytes = pkcs8.slice();
  pkcs8.fill(0);
  const now = opts?.lastPasswordUnlockAt ?? Date.now();
  return {
    recordUuid,
    userId,
    username,
    credentialId,
    salt,
    publicKeyBytes,
    sealedPrivateKey,
    wrappedItemsKey,
    now,
    prfOutput,
    kek,
    itemsKey,
    pkcs8Bytes,
  };
}

/** Builds and persists an enrollment record; returns the full bundle. */
export async function seedEnrollment(opts: {
  userId: string;
  username: string;
  itemsKey?: Uint8Array;
  lastPasswordUnlockAt?: number;
}) {
  const e = await buildEnrollment(opts);
  await saveEnrollment(e);
  return e;
}

/** Reads the raw enrollment record from IndexedDB, bypassing the store API. */
export function readRawBiometricIdb(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BIOMETRIC_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(BIOMETRIC_OBJECT_STORE);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(BIOMETRIC_OBJECT_STORE, "readonly");
      const get = tx.objectStore(BIOMETRIC_OBJECT_STORE).get(BIOMETRIC_RECORD_KEY);
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
      get.onerror = () => {
        db.close();
        reject(get.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
}
