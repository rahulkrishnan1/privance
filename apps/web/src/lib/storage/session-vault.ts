import type { ItemsKey } from "@privance/core";

// Survive-refresh / lock-on-close persistence for the items key (DEK). The raw
// key bytes are never written to storage: a non-extractable AES-GCM key wraps
// them, and only the wrapped bytes plus that key handle live in IndexedDB. A
// non-extractable CryptoKey survives structured clone into IDB while staying
// unreadable to script and devtools, so the at-rest copy cannot be exfiltrated.
// See docs/adr/0004-session-persistence.md and THREAT_MODEL.md.

const DB_NAME = "privance.session";
const STORE = "vault";
const RECORD_KEY = "current";
const IV_BYTES = 12;

/** The single window that governs both idle-while-open and time-since-last-seen
 *  across a reload or close. Reopening within it auto-unlocks; past it, the
 *  master password is required. Hardcoded by design, not configurable. */
export const SESSION_TTL_MS = 15 * 60 * 1000;

type VaultRecord = {
  wrapped: ArrayBuffer;
  iv: Uint8Array<ArrayBuffer>;
  /** Non-extractable AES-GCM key. Usable as an unwrap oracle, never exportable. */
  key: CryptoKey;
  lastActiveAt: number;
};

/** Pure window check. `now - lastActiveAt` inside `[0, ttl]` is fresh; a
 *  negative age (clock moved backwards) is treated as stale, fail-closed. */
export function isSessionFresh(opts: {
  lastActiveAt: number;
  now: number;
  ttlMs?: number;
}): boolean {
  const ttl = opts.ttlMs ?? SESSION_TTL_MS;
  const age = opts.now - opts.lastActiveAt;
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
 *  synchronously between the get and the put, so a concurrent clear (auto-lock)
 *  cannot interleave and get resurrected; returning null skips the write. */
function updateRecord(decide: (current: unknown) => VaultRecord | null): Promise<void> {
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

// Persistence is a best-effort enhancement layered on memory-only auth: every
// operation tolerates an unavailable or failing IndexedDB (locked-down hosts,
// quota errors) by degrading rather than throwing, so a storage fault can never
// break login or hang the boot state machine.

/** Surfaces an unexpected vault fault in development so a silently-broken
 *  persistence layer is observable. The error objects here carry no key
 *  material; never called on the fail-closed decrypt path (tamper stays quiet). */
function warnDev(op: string, err: unknown): void {
  if (import.meta.env.DEV) {
    // biome-ignore lint/suspicious/noConsole: dev-only diagnostic, no secrets
    console.warn(`[session-vault] ${op} failed`, err);
  }
}

/** Wrap the items key under a fresh non-extractable AES-GCM key and store it,
 *  replacing any prior record. Best-effort: on failure, survive-refresh is
 *  simply unavailable for this session. */
export async function persistSession(itemsKey: ItemsKey, now: number): Promise<void> {
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    // Copy into a plain ArrayBuffer-backed view: the branded ItemsKey's buffer is
    // ArrayBufferLike, which the WebCrypto BufferSource type rejects. Zero the
    // transient copy of the raw key bytes once wrapped so it does not linger.
    const plain = new Uint8Array(itemsKey);
    const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
    plain.fill(0);
    const record: VaultRecord = { wrapped, iv, key, lastActiveAt: now };
    await withStore("readwrite", (s) => s.put(record, RECORD_KEY));
  } catch (err) {
    warnDev("persist", err);
  }
}

/** Unwrap the items key if the window is still open, else purge and return null.
 *  Any failure (no record, expiry, decrypt error, unavailable IDB) returns null
 *  so the boot resolves to re-auth, fail-closed. */
export async function loadSession(now: number): Promise<ItemsKey | null> {
  let record: VaultRecord | undefined;
  try {
    record = (await withStore("readonly", (s) => s.get(RECORD_KEY))) as VaultRecord | undefined;
  } catch (err) {
    // Transient IDB fault: fail closed to re-auth, but keep the record so a
    // later attempt can still restore the session instead of forcing re-login.
    warnDev("load", err);
    return null;
  }
  if (record === undefined) return null;
  if (!isSessionFresh({ lastActiveAt: record.lastActiveAt, now })) {
    await clearSession();
    return null;
  }
  try {
    const bytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: record.iv },
      record.key,
      record.wrapped,
    );
    return new Uint8Array(bytes) as ItemsKey;
  } catch {
    // Decrypt failed: the record is corrupt or tampered. Purge and re-auth.
    // Stay quiet on this fail-closed path (no warnDev), per the module note.
    await clearSession();
    return null;
  }
}

/** Slide the window forward to `now`. No-op if no session is stored or IDB fails. */
export async function touchSession(now: number): Promise<void> {
  try {
    await updateRecord((current) => {
      const record = current as VaultRecord | undefined;
      if (record === undefined) return null;
      record.lastActiveAt = now;
      return record;
    });
  } catch (err) {
    warnDev("touch", err);
  }
}

export async function clearSession(): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(RECORD_KEY));
  } catch (err) {
    warnDev("clear", err);
  }
}
