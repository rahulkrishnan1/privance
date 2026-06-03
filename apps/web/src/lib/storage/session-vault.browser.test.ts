import type { ItemsKey } from "@privance/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSession,
  loadSession,
  persistSession,
  SESSION_TTL_MS,
  touchSession,
} from "./session-vault";

const KEY_BYTES = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const itemsKey = KEY_BYTES as unknown as ItemsKey;

/** Reads the raw persisted record straight from IndexedDB so tests can assert
 *  what actually lives at rest (the wrap key's non-extractability). */
function readRawRecord(): Promise<{ key: CryptoKey } | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("privance.session", 1);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction("vault", "readonly").objectStore("vault").get("current");
      req.onsuccess = () => {
        db.close();
        resolve(req.result);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    };
    open.onerror = () => reject(open.error);
  });
}

beforeEach(() => clearSession());
afterEach(() => clearSession());

describe("session vault round-trip", () => {
  it("loads back the exact items key within the window", async () => {
    await persistSession(itemsKey, 1000);
    const restored = await loadSession(1000 + SESSION_TTL_MS);
    expect(restored).not.toBeNull();
    expect(Array.from(restored as Uint8Array)).toEqual(Array.from(KEY_BYTES));
  });

  it("returns null and purges once the window has elapsed", async () => {
    await persistSession(itemsKey, 1000);
    const expired = await loadSession(1000 + SESSION_TTL_MS + 1);
    expect(expired).toBeNull();
    // Purged: a later load inside a fresh window still finds nothing.
    expect(await loadSession(1000)).toBeNull();
  });

  it("slides the window forward on touch", async () => {
    await persistSession(itemsKey, 1000);
    await touchSession(1000 + SESSION_TTL_MS);
    // Without the touch this would be expired; with it, still fresh.
    const restored = await loadSession(1000 + SESSION_TTL_MS + SESSION_TTL_MS);
    expect(restored).not.toBeNull();
  });

  it("clearSession removes the stored key", async () => {
    await persistSession(itemsKey, 1000);
    await clearSession();
    expect(await loadSession(1000)).toBeNull();
  });
});

describe("session vault at-rest posture", () => {
  it("stores a non-extractable wrap key whose bytes cannot be exported", async () => {
    await persistSession(itemsKey, 1000);
    const record = await readRawRecord();
    const key = record?.key;
    expect(key?.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key as CryptoKey)).rejects.toThrow();
  });
});
