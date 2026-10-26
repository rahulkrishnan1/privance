import type { Database } from "@sqlite.org/sqlite-wasm";
import initSqlite from "@sqlite.org/sqlite-wasm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnqueueInput } from "./types.js";
import { StorageNotInitializedError } from "./types.js";
import { WebSqliteAdapter } from "./web-adapter.js";

const edit: EnqueueInput = {
  kind: "account",
  objectId: "account-1",
  ciphertext: new Uint8Array([1, 2, 3]),
  nonce: new Uint8Array([4, 5, 6]),
  version: 9_007_199_254_740_993n,
  prevVersion: 9_007_199_254_740_992n,
  tombstone: false,
};

// Real SQLite, injected only to exercise the durable-path logic without OPFS.
describe("LocalStore atomic writes", () => {
  let db: Database;
  let store: WebSqliteAdapter;

  beforeEach(async () => {
    const sqlite = await initSqlite();
    db = new sqlite.oo1.DB(":memory:");
    store = new WebSqliteAdapter({ workerUrl: "unused", injectedDb: db });
    await store.init();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await store.close();
  });

  it("reports test durable semantics only after init and fails safe after close", async () => {
    expect(store.mode).toBe("opfs");
    await store.close();
    expect(() => store.mode).toThrow(StorageNotInitializedError);
    await expect(store.putAndEnqueue(edit)).rejects.toThrow(StorageNotInitializedError);
    await expect(store.applyRemote(edit)).rejects.toThrow(StorageNotInitializedError);
  });

  it("commits the exact envelope and stable queue ID together with an unconfirmed sequence", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const id = await store.putAndEnqueue(edit);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(await store.drainQueue()).toEqual([{ ...edit, id, enqueuedAt: 1234 }]);
    expect(await store.get(edit)).toEqual({
      kind: edit.kind,
      objectId: edit.objectId,
      ciphertext: edit.ciphertext,
      nonce: edit.nonce,
      version: edit.version,
      tombstone: false,
      serverSeq: null,
      updatedAt: 1234,
    });
    await store.ackQueueItem(id);
    expect(await store.drainQueue()).toEqual([]);
    expect((await store.get(edit))?.serverSeq).toBeNull();
  });

  it.each([false, true])(
    "rolls back object and queue on insertion failure (existing=%s)",
    async (existing) => {
      if (existing) await store.put({ ...edit, version: 1n, serverSeq: 2n });
      const before = await store.get(edit);
      db.exec(`CREATE TRIGGER fail_enqueue BEFORE INSERT ON outbound_queue
      BEGIN SELECT RAISE(ABORT, 'injected queue failure'); END`);
      await expect(store.putAndEnqueue(edit)).rejects.toThrow("injected queue failure");
      expect(await store.get(edit)).toEqual(before);
      expect(await store.drainQueue()).toEqual([]);
    },
  );

  it("orders timestamp ties by insertion, not random queue ID or index order", async () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    // Force a different query plan so a missing SQL tie-breaker cannot pass by accident.
    db.exec("DROP INDEX outbound_queue_enqueued_idx");
    db.exec("CREATE INDEX queue_ties ON outbound_queue(enqueued_at, id)");
    await store.enqueue({ ...edit, id: "z-first" });
    await store.enqueue({ ...edit, id: "a-second" });
    expect((await store.drainQueue()).map((item) => item.id)).toEqual(["z-first", "a-second"]);
  });

  it("confirms only the exact queued revision and leaves ciphertext and timestamp unchanged", async () => {
    const id = await store.putAndEnqueue({ ...edit, id: "exact" });
    const before = await store.get(edit);
    const confirmed = { version: edit.version + 1n, serverSeq: 9_223_372_036_854_775_807n };
    await store.ackQueueItem(id, confirmed);
    expect(await store.get(edit)).toEqual({ ...before, ...confirmed });
    expect(await store.drainQueue()).toEqual([]);
    await store.ackQueueItem(id, { version: 1n, serverSeq: 1n });
    expect(await store.get(edit)).toEqual({ ...before, ...confirmed });
  });

  it.each([
    { version: edit.version + 1n },
    { ciphertext: new Uint8Array([7, 8, 9]) },
    { nonce: new Uint8Array([9, 8, 7]) },
    { tombstone: true },
    {},
  ])("old confirmation preserves a newer local queue identity: %o", async (change) => {
    const oldId = await store.putAndEnqueue(edit);
    // A local edit after the sender's awaited queue snapshot must survive its old reply.
    await store.drainQueue();
    const newId = await store.putAndEnqueue({ ...edit, ...change });
    const newer = await store.get(edit);
    await store.ackQueueItem(oldId, { version: 100n, serverSeq: 200n });
    expect(await store.get(edit)).toEqual(newer);
    expect((await store.drainQueue()).map((item) => item.id)).toEqual([newId]);
  });

  it.each([
    { version: edit.version + 1n },
    { ciphertext: new Uint8Array([7]) },
    { nonce: new Uint8Array([8]) },
    { tombstone: true },
  ])(
    "confirmation also protects an unconditional put with changed identity: %o",
    async (change) => {
      const id = await store.putAndEnqueue(edit);
      await store.put({ ...edit, ...change });
      const newer = await store.get(edit);
      await store.ackQueueItem(id, { version: 100n, serverSeq: 200n });
      expect(await store.get(edit)).toEqual(newer);
      expect(await store.drainQueue()).toEqual([]);
    },
  );

  it("an old confirmation cannot downgrade a newer confirmed identical envelope", async () => {
    const oldId = await store.putAndEnqueue(edit);
    const newId = await store.putAndEnqueue(edit);
    const confirmed = { version: edit.version, serverSeq: 200n };
    await store.ackQueueItem(newId, confirmed);
    const newer = await store.get(edit);
    await store.ackQueueItem(oldId, { version: edit.version, serverSeq: 100n });
    expect(await store.get(edit)).toEqual(newer);
    expect(await store.drainQueue()).toEqual([]);
  });

  it("rolls back confirmation metadata if queue deletion fails", async () => {
    const id = await store.putAndEnqueue(edit);
    const before = await store.get(edit);
    db.exec(`CREATE TRIGGER fail_ack BEFORE DELETE ON outbound_queue
      BEGIN SELECT RAISE(ABORT, 'injected ack failure'); END`);
    await expect(store.ackQueueItem(id, { version: 100n, serverSeq: 200n })).rejects.toThrow(
      "injected ack failure",
    );
    expect(await store.get(edit)).toEqual(before);
    expect((await store.drainQueue()).map((item) => item.id)).toEqual([id]);
  });

  it.each([false, true])(
    "atomically discards captured intent for a chosen server envelope (deleted=%s)",
    async (tombstone) => {
      const id = await store.putAndEnqueue(edit);
      const local = await store.get(edit);
      const replacement = {
        ...edit,
        ciphertext: new Uint8Array([99]),
        version: edit.version + 10n,
        serverSeq: 50n,
        tombstone,
        updatedAt: 1234,
      };
      db.exec(`CREATE TRIGGER fail_choice BEFORE INSERT ON sync_objects
        BEGIN SELECT RAISE(ABORT, 'injected replacement failure'); END`);
      await expect(
        store.ackQueueItem(id, { version: 100n, serverSeq: 200n }, replacement),
      ).rejects.toThrow("injected replacement failure");
      expect(await store.get(edit)).toEqual(local);
      expect((await store.drainQueue()).map((item) => item.id)).toEqual([id]);
      db.exec("DROP TRIGGER fail_choice");
      await store.ackQueueItem(id, undefined, replacement);
      expect(await store.get(edit)).toEqual({
        kind: edit.kind,
        objectId: edit.objectId,
        ciphertext: replacement.ciphertext,
        nonce: replacement.nonce,
        version: replacement.version,
        serverSeq: replacement.serverSeq,
        tombstone,
        updatedAt: 1234,
      });
      expect(await store.drainQueue()).toEqual([]);
    },
  );

  it("requires a matching captured identity and never reapplies an absent ID's replacement", async () => {
    const id = await store.putAndEnqueue(edit);
    const local = await store.get(edit);
    for (const change of [{ kind: "holding" }, { objectId: "other" }]) {
      await expect(store.ackQueueItem(id, undefined, { ...edit, ...change })).rejects.toThrow(
        "Replacement must match",
      );
      expect(await store.get({ ...edit, ...change })).toBeNull();
      expect(await store.get(edit)).toEqual(local);
      expect((await store.drainQueue()).map((item) => item.id)).toEqual([id]);
    }
    await store.ackQueueItem(id);
    await store.ackQueueItem(id, { version: 100n, serverSeq: 200n }, { ...edit, version: 99n });
    expect(await store.get(edit)).toEqual(local);
    expect(await store.drainQueue()).toEqual([]);
  });

  it.each(["account", "holding"])(
    "a discard removes only its captured ID and preserves remaining %s intent for the object",
    async (kind) => {
      const id = await store.putAndEnqueue(edit);
      const later = { ...edit, kind, ciphertext: new Uint8Array([7]), version: edit.version + 1n };
      const nextId = await store.putAndEnqueue(later);
      const before = await store.get(edit);
      const next = await store.get(later);
      await store.ackQueueItem(id, undefined, { ...edit, serverSeq: 50n, tombstone: true });
      expect(await store.get(edit)).toEqual(before);
      expect(await store.get(later)).toEqual(next);
      expect((await store.drainQueue()).map((item) => item.id)).toEqual([nextId]);
    },
  );

  it.each([edit.version - 1n, edit.version, edit.version + 1n])(
    "applyRemote preserves pending intent regardless of remote version %s",
    async (version) => {
      const id = await store.putAndEnqueue(edit);
      const local = await store.get(edit);
      const remote = { ...edit, ciphertext: new Uint8Array([99]), version, serverSeq: 10n };
      expect(await store.applyRemote(remote)).toBe(false);
      expect(await store.get(edit)).toEqual(local);
      // Server object IDs are global, including if a remote kind differs.
      expect(await store.applyRemote({ ...remote, kind: "holding" })).toBe(false);
      expect(await store.get({ ...edit, kind: "holding" })).toBeNull();
      await store.ackQueueItem(id);
      expect(await store.applyRemote(remote)).toBe(true);
      expect(await store.get(edit)).toMatchObject({
        ciphertext: remote.ciphertext,
        nonce: remote.nonce,
        version,
        serverSeq: 10n,
      });
    },
  );

  it("a local save started during remote application is never overwritten", async () => {
    const receiving = store.applyRemote({
      ...edit,
      ciphertext: new Uint8Array([99]),
      serverSeq: 100n,
    });
    const saving = store.putAndEnqueue(edit);
    await Promise.all([receiving, saving]);
    expect(await store.get(edit)).toMatchObject({ ciphertext: edit.ciphertext, serverSeq: null });
    expect(await store.drainQueue()).toHaveLength(1);
  });

  it("applyRemote inserts when no local intent exists and preserves defaults", async () => {
    expect(await store.applyRemote(edit)).toBe(true);
    expect(await store.get(edit)).toMatchObject({ version: edit.version, serverSeq: null });
    expect(await store.drainQueue()).toEqual([]);
  });
});
