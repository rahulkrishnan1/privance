/**
 * Storage adapter tests.
 *
 * Strategy: use @sqlite.org/sqlite-wasm's Node build (no OPFS) to create an
 * in-memory Database, then inject it into WebSqliteAdapter via the second
 * constructor argument. This avoids the OPFS dependency that is unavailable in
 * Node/vitest and lets us run the full suite locally and in CI without a real
 * browser.
 *
 * The SAHPool production path is exercised only in the actual PWA runtime.
 */

import type { Database } from "@sqlite.org/sqlite-wasm";
import initSqlite from "@sqlite.org/sqlite-wasm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredObject } from "./types.js";
import { StorageNotInitializedError } from "./types.js";
import { WebSqliteAdapter } from "./web-adapter.js";

// Reusable byte fixtures, small, deterministic.
const CIPHER_A = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
const NONCE_A = new Uint8Array(12).fill(0xaa);
const CIPHER_B = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
const NONCE_B = new Uint8Array(12).fill(0xbb);

async function makeInMemoryAdapter(): Promise<WebSqliteAdapter> {
  const sqlite3 = await initSqlite();
  const db: Database = new sqlite3.oo1.DB({ filename: ":memory:" });
  return new WebSqliteAdapter({
    workerUrl: "unused-in-test",
    dbFilename: "/test.sqlite3",
    injectedDb: db,
  });
}

describe("WebSqliteAdapter", () => {
  let adapter: WebSqliteAdapter;

  beforeEach(async () => {
    adapter = await makeInMemoryAdapter();
    await adapter.init();
  });

  afterEach(async () => {
    // close() is idempotent, safe even if destroy() was called.
    await adapter.close();
  });

  it("throws StorageNotInitializedError before init()", async () => {
    const raw = await makeInMemoryAdapter();
    await expect(raw.get({ kind: "account", objectId: "x" })).rejects.toThrow(
      StorageNotInitializedError,
    );
  });

  it("init() is idempotent, calling twice does not throw", async () => {
    await expect(adapter.init()).resolves.toBeUndefined();
  });

  it("put then get returns the stored object", async () => {
    await adapter.put({
      kind: "account",
      objectId: "obj-1",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 1n,
      updatedAt: 1_700_000_000_000,
    });

    const obj = await adapter.get({ kind: "account", objectId: "obj-1" });

    expect(obj).not.toBeNull();
    const stored = obj as StoredObject;
    expect(stored.kind).toBe("account");
    expect(stored.objectId).toBe("obj-1");
    expect(stored.ciphertext).toEqual(CIPHER_A);
    expect(stored.nonce).toEqual(NONCE_A);
    expect(stored.version).toBe(1n);
    expect(stored.serverSeq).toBeNull();
    expect(stored.tombstone).toBe(false);
    expect(stored.updatedAt).toBe(1_700_000_000_000);
  });

  it("get returns null for absent object", async () => {
    const result = await adapter.get({ kind: "account", objectId: "missing" });
    expect(result).toBeNull();
  });

  it("put upserts, second put overwrites first", async () => {
    await adapter.put({
      kind: "holding",
      objectId: "h-1",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 1n,
    });
    await adapter.put({
      kind: "holding",
      objectId: "h-1",
      ciphertext: CIPHER_B,
      nonce: NONCE_B,
      version: 2n,
      serverSeq: 99n,
      tombstone: true,
    });

    const obj = await adapter.get({ kind: "holding", objectId: "h-1" });
    expect(obj?.ciphertext).toEqual(CIPHER_B);
    expect(obj?.nonce).toEqual(NONCE_B);
    expect(obj?.version).toBe(2n);
    expect(obj?.serverSeq).toBe(99n);
    expect(obj?.tombstone).toBe(true);
  });

  it("objects of different kinds with the same objectId are independent", async () => {
    await adapter.put({
      kind: "account",
      objectId: "shared-id",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 1n,
    });
    await adapter.put({
      kind: "holding",
      objectId: "shared-id",
      ciphertext: CIPHER_B,
      nonce: NONCE_B,
      version: 2n,
    });

    const acc = await adapter.get({ kind: "account", objectId: "shared-id" });
    const hld = await adapter.get({ kind: "holding", objectId: "shared-id" });

    expect(acc?.ciphertext).toEqual(CIPHER_A);
    expect(hld?.ciphertext).toEqual(CIPHER_B);
  });

  it("round-trips a version above 2^53 without precision loss through the INTEGER column", async () => {
    // version/server_seq are SQLite INTEGER (int64). If the driver coerced them
    // through a JS Number anywhere, values above Number.MAX_SAFE_INTEGER (2^53)
    // would silently corrupt. Pin an exact bigint round-trip.
    const bigVersion = 9_007_199_254_740_993n; // 2^53 + 1, not representable as a Number
    const bigSeq = 9_223_372_036_854_775_807n; // int64 max
    await adapter.put({
      kind: "account",
      objectId: "big-1",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: bigVersion,
      serverSeq: bigSeq,
    });

    const obj = await adapter.get({ kind: "account", objectId: "big-1" });
    expect(obj?.version).toBe(bigVersion);
    expect(obj?.serverSeq).toBe(bigSeq);
  });

  it("list returns only objects of the requested kind, ordered by objectId", async () => {
    await adapter.put({
      kind: "account",
      objectId: "z",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 1n,
    });
    await adapter.put({
      kind: "account",
      objectId: "a",
      ciphertext: CIPHER_B,
      nonce: NONCE_B,
      version: 2n,
    });
    await adapter.put({
      kind: "holding",
      objectId: "h",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 3n,
    });

    const accounts = await adapter.list({ kind: "account" });

    expect(accounts).toHaveLength(2);
    expect(accounts[0]?.objectId).toBe("a");
    expect(accounts[1]?.objectId).toBe("z");
  });

  it("list returns empty array when no objects of that kind exist", async () => {
    const result = await adapter.list({ kind: "transaction" });
    expect(result).toEqual([]);
  });

  it("delete removes the object so get returns null", async () => {
    await adapter.put({
      kind: "account",
      objectId: "del-me",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 1n,
    });
    await adapter.delete({ kind: "account", objectId: "del-me" });

    const result = await adapter.get({ kind: "account", objectId: "del-me" });
    expect(result).toBeNull();
  });

  it("delete on absent object is a no-op (no throw)", async () => {
    await expect(adapter.delete({ kind: "account", objectId: "ghost" })).resolves.toBeUndefined();
  });

  it("delete is scoped to kind, same objectId in another kind is unaffected", async () => {
    await adapter.put({
      kind: "account",
      objectId: "x",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 1n,
    });
    await adapter.put({
      kind: "holding",
      objectId: "x",
      ciphertext: CIPHER_B,
      nonce: NONCE_B,
      version: 2n,
    });

    await adapter.delete({ kind: "account", objectId: "x" });

    expect(await adapter.get({ kind: "account", objectId: "x" })).toBeNull();
    expect(await adapter.get({ kind: "holding", objectId: "x" })).not.toBeNull();
  });

  it("getCursor returns null when never set", async () => {
    const cursor = await adapter.getCursor();
    expect(cursor).toBeNull();
  });

  it("setCursor then getCursor round-trips", async () => {
    await adapter.setCursor(42n);
    const cursor = await adapter.getCursor();
    expect(cursor).toBe(42n);
  });

  it("setCursor overwrites a previously stored cursor", async () => {
    await adapter.setCursor(1n);
    await adapter.setCursor(999n);
    expect(await adapter.getCursor()).toBe(999n);
  });

  it("enqueue + drainQueue returns items oldest-first", async () => {
    await adapter.enqueue({
      id: "q-1",
      kind: "account",
      objectId: "a1",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 1n,
      tombstone: false,
    });
    await adapter.enqueue({
      id: "q-2",
      kind: "account",
      objectId: "a2",
      ciphertext: CIPHER_B,
      nonce: NONCE_B,
      version: 2n,
      tombstone: false,
    });

    const items = await adapter.drainQueue();

    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe("q-1");
    expect(items[1]?.id).toBe("q-2");
    expect(items[0]?.ciphertext).toEqual(CIPHER_A);
  });

  it("drainQueue returns empty array when queue is empty", async () => {
    expect(await adapter.drainQueue()).toEqual([]);
  });

  it("ackQueueItem removes only the acked item", async () => {
    await adapter.enqueue({
      id: "q-1",
      kind: "account",
      objectId: "a1",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 1n,
      tombstone: false,
    });
    await adapter.enqueue({
      id: "q-2",
      kind: "account",
      objectId: "a2",
      ciphertext: CIPHER_B,
      nonce: NONCE_B,
      version: 2n,
      tombstone: false,
    });

    await adapter.ackQueueItem("q-1");

    const remaining = await adapter.drainQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("q-2");
  });

  it("full queue happy path: enqueue → drain → ack → drain empty", async () => {
    await adapter.enqueue({
      id: "ev-1",
      kind: "price",
      objectId: "p1",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 1n,
      tombstone: false,
    });

    const first = await adapter.drainQueue();
    expect(first).toHaveLength(1);

    await adapter.ackQueueItem("ev-1");

    const second = await adapter.drainQueue();
    expect(second).toHaveLength(0);
  });

  it("enqueue auto-generates id when omitted", async () => {
    await adapter.enqueue({
      kind: "account",
      objectId: "a1",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 1n,
      tombstone: false,
    });
    const items = await adapter.drainQueue();
    expect(items[0]?.id).toBeTruthy();
  });

  it("destroy wipes all rows then closes the adapter", async () => {
    // Populate data and verify it's present.
    await adapter.put({
      kind: "account",
      objectId: "a1",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 1n,
    });
    await adapter.put({
      kind: "holding",
      objectId: "h1",
      ciphertext: CIPHER_B,
      nonce: NONCE_B,
      version: 2n,
    });
    await adapter.setCursor(10n);
    await adapter.enqueue({
      id: "q-1",
      kind: "account",
      objectId: "a1",
      ciphertext: CIPHER_A,
      nonce: NONCE_A,
      version: 1n,
      tombstone: false,
    });

    expect(await adapter.list({ kind: "account" })).toHaveLength(1);
    expect(await adapter.list({ kind: "holding" })).toHaveLength(1);
    expect(await adapter.getCursor()).toBe(10n);
    expect(await adapter.drainQueue()).toHaveLength(1);

    // destroy() deletes all rows and closes. Subsequent calls must throw because
    // the adapter is closed (StorageNotInitializedError).
    await adapter.destroy();

    await expect(adapter.list({ kind: "account" })).rejects.toThrow(StorageNotInitializedError);
  });
});
