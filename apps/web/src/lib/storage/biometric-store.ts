import { type EncryptedBlob, InvalidLengthError, type ItemsKey } from "@privance/core";

// Durable enrollment record for biometric unlock. Separate from privance.session
// because this store is exempt from the 15-minute TTL and the cold-launch purge:
// it persists across sessions until the 14-day cadence expires, the user disables
// biometric unlock, or a logout occurs.

const DB_NAME = "privance.biometric";
const STORE = "enrollment";
const RECORD_KEY = "current";
const SCHEMA_VERSION = 1;

/** 14-day window between required password re-confirmations. Hardcoded by design. */
export const CADENCE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// RSA-OAEP parameters. 2048-bit key, SHA-256 hash. The protector keypair is
// single-use per enrollment so key size is not a performance bottleneck.
const RSA_ALGORITHM = {
  name: "RSA-OAEP",
  modulusLength: 2048,
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
  hash: { name: "SHA-256" },
} satisfies RsaHashedKeyAlgorithm;

// RSA plaintext layout: 32 bytes items key || UTF-8 recordUuid.
// The recordUuid binding makes a substituted blob fail deterministically at
// unwrap time (the recordUuid mismatch throws before yielding any key bytes).
const ITEMS_KEY_BYTES = 32;

export type EnrollmentRecord = {
  recordUuid: string;
  userId: string;
  username: string;
  credentialId: Uint8Array;
  salt: Uint8Array;
  publicKeyBytes: Uint8Array;
  sealedPrivateKey: EncryptedBlob;
  // null after a cadence-expiry purge: the at-rest items-key copy is destroyed
  // but the enrollment bookkeeping (no user key material) survives so the next
  // password-derived unlock can re-arm without re-enrollment.
  wrappedItemsKey: Uint8Array | null;
  lastPasswordUnlockAt: number;
  enrolledAt: number;
  schemaVersion: number;
};

/** What loadEnrollment returns: a record guaranteed usable for biometric
 *  unlock, i.e. its wrapped items key is present. */
export type UsableEnrollment = EnrollmentRecord & { wrappedItemsKey: Uint8Array };

/** Pure cadence check. `now - lastPasswordUnlockAt` inside `[0, ttl]` is fresh;
 *  a negative age (clock moved backwards) is treated as stale, fail-closed. */
export function isCadenceFresh(opts: {
  lastPasswordUnlockAt: number;
  now: number;
  ttlMs?: number;
}): boolean {
  const ttl = opts.ttlMs ?? CADENCE_TTL_MS;
  const age = opts.now - opts.lastPasswordUnlockAt;
  return age >= 0 && age <= ttl;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

/** Atomic read-modify-write in one readwrite transaction. `decide` runs
 *  synchronously between the get and the put, so no purge or re-arm from
 *  another tab can interleave; returning null skips the write. */
function updateRecord(decide: (current: unknown) => EnrollmentRecord | null): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const get = store.get(RECORD_KEY);
        get.onsuccess = () => {
          const updated = decide(get.result);
          if (updated !== null) store.put(updated, RECORD_KEY);
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

function warnDev(op: string, err: unknown): void {
  if (import.meta.env.DEV) {
    // biome-ignore lint/suspicious/noConsole: dev-only diagnostic, no secrets
    console.warn(`[biometric-store] ${op} failed`, err);
  }
}

function isValidRecord(r: unknown): r is EnrollmentRecord {
  if (typeof r !== "object" || r === null) return false;
  const rec = r as Record<string, unknown>;
  return (
    typeof rec.recordUuid === "string" &&
    typeof rec.userId === "string" &&
    typeof rec.username === "string" &&
    rec.credentialId instanceof Uint8Array &&
    rec.salt instanceof Uint8Array &&
    rec.publicKeyBytes instanceof Uint8Array &&
    typeof rec.sealedPrivateKey === "object" &&
    rec.sealedPrivateKey !== null &&
    "ciphertext" in (rec.sealedPrivateKey as object) &&
    "nonce" in (rec.sealedPrivateKey as object) &&
    (rec.wrappedItemsKey instanceof Uint8Array || rec.wrappedItemsKey === null) &&
    typeof rec.lastPasswordUnlockAt === "number" &&
    typeof rec.enrolledAt === "number" &&
    rec.schemaVersion === SCHEMA_VERSION
  );
}

/** Generates a protector keypair. Returns raw bytes so callers can seal pkcs8
 *  and store publicKeyBytes plaintext without holding CryptoKey handles. */
export async function generateProtectorKeypair(): Promise<{
  publicKeyBytes: Uint8Array;
  pkcs8: Uint8Array;
}> {
  const keyPair = await crypto.subtle.generateKey(RSA_ALGORITHM, true, ["encrypt", "decrypt"]);
  const [spki, pkcs8Buf] = await Promise.all([
    crypto.subtle.exportKey("spki", keyPair.publicKey),
    crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  ]);
  return {
    publicKeyBytes: new Uint8Array(spki),
    pkcs8: new Uint8Array(pkcs8Buf),
  };
}

/** RSA-OAEP encrypt the items key. Embeds the recordUuid beside the 32 key
 *  bytes so a substituted blob fails at unwrap. Returns the ciphertext bytes. */
export async function wrapItemsKeyRsa(opts: {
  itemsKey: Uint8Array;
  publicKeyBytes: Uint8Array;
  recordUuid: string;
}): Promise<Uint8Array> {
  if (opts.itemsKey.length !== ITEMS_KEY_BYTES) {
    throw new InvalidLengthError("itemsKey", ITEMS_KEY_BYTES, opts.itemsKey.length);
  }
  // Copy into plain ArrayBuffer-backed view: caller's buffer may be
  // ArrayBufferLike, which WebCrypto BufferSource rejects.
  const spkiBuf = new Uint8Array(opts.publicKeyBytes);
  const pubKey = await crypto.subtle.importKey("spki", spkiBuf, RSA_ALGORITHM, false, ["encrypt"]);
  const uuidBytes = new TextEncoder().encode(opts.recordUuid);
  // Plaintext layout: 32 key bytes || UTF-8 recordUuid
  const plaintext = new Uint8Array(ITEMS_KEY_BYTES + uuidBytes.length);
  plaintext.set(opts.itemsKey, 0);
  plaintext.set(uuidBytes, ITEMS_KEY_BYTES);
  const ciphertext = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubKey, plaintext);
  plaintext.fill(0);
  return new Uint8Array(ciphertext);
}

/** RSA-OAEP decrypt and verify the embedded recordUuid. Throws if the uuid
 *  in the plaintext does not match `expectedRecordUuid`. */
export async function unwrapItemsKeyRsa(opts: {
  wrappedItemsKey: Uint8Array;
  pkcs8: Uint8Array;
  expectedRecordUuid: string;
}): Promise<ItemsKey> {
  // Copy into plain ArrayBuffer-backed views; see wrapItemsKeyRsa comment.
  const pkcs8Buf = new Uint8Array(opts.pkcs8);
  const privKey = await crypto.subtle.importKey("pkcs8", pkcs8Buf, RSA_ALGORITHM, false, [
    "decrypt",
  ]);
  const wrappedBuf = new Uint8Array(opts.wrappedItemsKey);
  const plaintextBuf = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privKey, wrappedBuf);
  const plain = new Uint8Array(plaintextBuf);
  const itemsKey = plain.slice(0, ITEMS_KEY_BYTES);
  const uuidBytes = plain.slice(ITEMS_KEY_BYTES);
  const embeddedUuid = new TextDecoder().decode(uuidBytes);
  plain.fill(0);
  if (embeddedUuid !== opts.expectedRecordUuid) {
    throw new Error("unwrapItemsKeyRsa: recordUuid mismatch");
  }
  return itemsKey as ItemsKey;
}

/** Writes the enrollment record, replacing any prior one. The caller must
 *  pre-generate the recordUuid so that sealProtectorKey can bind it as AAD
 *  before this call. */
export async function saveEnrollment(opts: {
  recordUuid: string;
  userId: string;
  username: string;
  credentialId: Uint8Array;
  salt: Uint8Array;
  publicKeyBytes: Uint8Array;
  sealedPrivateKey: EncryptedBlob;
  wrappedItemsKey: Uint8Array;
  now: number;
}): Promise<void> {
  const record: EnrollmentRecord = {
    recordUuid: opts.recordUuid,
    userId: opts.userId,
    username: opts.username,
    credentialId: opts.credentialId,
    salt: opts.salt,
    publicKeyBytes: opts.publicKeyBytes,
    sealedPrivateKey: opts.sealedPrivateKey,
    wrappedItemsKey: opts.wrappedItemsKey,
    lastPasswordUnlockAt: opts.now,
    enrolledAt: opts.now,
    schemaVersion: SCHEMA_VERSION,
  };
  try {
    await withStore("readwrite", (s) => s.put(record, RECORD_KEY));
  } catch (err) {
    warnDev("save", err);
    throw err;
  }
}

/** The single read API. Returns the record only when it is usable for a
 *  biometric unlock: structurally valid, owned by `userId`, cadence fresh, and
 *  holding a wrapped items key. UserId mismatch and structural invalidity purge
 *  the whole record. Cadence expiry destroys only the wrapped items key (the
 *  sole field holding user key material); the bookkeeping survives so the next
 *  password-derived unlock re-arms without re-enrollment. Storage faults
 *  degrade to null. Cryptographic tamper detection happens at unwrap time,
 *  not here. */
export async function loadEnrollment(opts: {
  now: number;
  userId: string;
}): Promise<UsableEnrollment | null> {
  try {
    const raw = await withStore("readonly", (s) => s.get(RECORD_KEY));
    if (raw === undefined) return null;
    if (!isValidRecord(raw)) {
      await purgeEnrollment();
      return null;
    }
    if (raw.userId !== opts.userId) {
      await purgeEnrollment();
      return null;
    }
    if (!isCadenceFresh({ lastPasswordUnlockAt: raw.lastPasswordUnlockAt, now: opts.now })) {
      if (raw.wrappedItemsKey !== null) {
        // Re-checked atomically: a re-arm landing after our read makes the
        // record fresh again, and the stale snapshot must not clobber it.
        await updateRecord((current) => {
          if (!isValidRecord(current) || current.recordUuid !== raw.recordUuid) return null;
          if (isCadenceFresh({ lastPasswordUnlockAt: current.lastPasswordUnlockAt, now: opts.now }))
            return null;
          return { ...current, wrappedItemsKey: null };
        });
      }
      return null;
    }
    if (raw.wrappedItemsKey === null) return null;
    return raw as UsableEnrollment;
  } catch {
    return null;
  }
}

/** Read-then-wrap: updates the wrapped items key under the stored public key
 *  and refreshes lastPasswordUnlockAt. No-op when no record exists, so a
 *  re-arm racing a cross-tab logout purge cannot resurrect a deleted record.
 *  A userId mismatch purges instead of wrapping: re-arming another account's
 *  record would bind this user's items key to the other account's protector. */
export async function reArm(opts: {
  itemsKey: Uint8Array;
  userId: string;
  now: number;
}): Promise<void> {
  try {
    const raw = await withStore("readonly", (s) => s.get(RECORD_KEY));
    if (raw === undefined || !isValidRecord(raw)) return;
    if (raw.userId !== opts.userId) {
      await purgeEnrollment();
      return;
    }
    const freshWrapped = await wrapItemsKeyRsa({
      itemsKey: opts.itemsKey,
      publicKeyBytes: raw.publicKeyBytes,
      recordUuid: raw.recordUuid,
    });
    // The RSA wrap is async, so the record is re-checked atomically before the
    // write: a purge or replacement enrollment committed mid-wrap must win, or
    // the put would resurrect a deleted record.
    await updateRecord((current) => {
      if (!isValidRecord(current) || current.recordUuid !== raw.recordUuid) return null;
      if (current.userId !== opts.userId) return null;
      return { ...current, wrappedItemsKey: freshWrapped, lastPasswordUnlockAt: opts.now };
    });
  } catch (err) {
    warnDev("reArm", err);
  }
}

/** Deletes the enrollment record. Best-effort. */
export async function purgeEnrollment(): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(RECORD_KEY));
  } catch (err) {
    warnDev("purge", err);
  }
}
