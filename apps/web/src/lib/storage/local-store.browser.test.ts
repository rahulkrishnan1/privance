import type { EnqueueInput, LocalStore } from "@privance/core/storage";
import { createLocalStore, StorageNotInitializedError } from "@privance/core/storage";
import { describe, expect, it } from "vitest";

const edit: EnqueueInput = {
  kind: "account",
  objectId: "worker-account",
  ciphertext: new Uint8Array([1, 2, 3]),
  nonce: new Uint8Array([4, 5, 6]),
  version: 9_007_199_254_740_993n,
  prevVersion: 9_007_199_254_740_992n,
  tombstone: false,
};

function memoryWorkerUrl(): string {
  const workerUrl = new URL("/sqlite/privance-worker.mjs", location.href).href;
  // Disable only OPFS; the actual worker, WASM, SQLite, and RPC path still run.
  return URL.createObjectURL(
    new Blob(
      [
        `
    Object.defineProperty(navigator.storage, "getDirectory", {
      value: async () => { throw new Error("OPFS disabled for storage regression"); }
    });
    await import(${JSON.stringify(workerUrl)});
  `,
      ],
      { type: "text/javascript" },
    ),
  );
}

describe("LocalStore real SQLite worker protocol", () => {
  it.each(["opfs", "memory"] as const)(
    "preserves atomic saves and exact confirmations in %s mode",
    async (mode) => {
      const workerUrl = mode === "memory" ? memoryWorkerUrl() : "/sqlite/privance-worker.mjs";
      const dbFilename = `/storage-regression-${crypto.randomUUID()}.sqlite3`;
      let store: LocalStore = createLocalStore({ workerUrl, dbFilename });
      try {
        expect(() => store.mode).toThrow(StorageNotInitializedError);
        await store.init();
        expect(store.mode).toBe(mode);
        const oldId = await store.putAndEnqueue({ ...edit, id: "old-revision" });
        expect(oldId).toBe("old-revision");
        expect(await store.drainQueue()).toEqual([
          { ...edit, id: oldId, enqueuedAt: expect.any(Number) },
        ]);
        const original = await store.get(edit);
        expect(original).toMatchObject({
          ciphertext: edit.ciphertext,
          version: edit.version,
          serverSeq: null,
        });

        // Duplicate queue ID fails after the object upsert: the entire transaction must roll back.
        await expect(
          store.putAndEnqueue({ ...edit, objectId: "rolled-back", id: oldId }),
        ).rejects.toThrow();
        expect(await store.get({ ...edit, objectId: "rolled-back" })).toBeNull();
        await expect(
          store.putAndEnqueue({ ...edit, ciphertext: new Uint8Array([99]), id: oldId }),
        ).rejects.toThrow();
        expect(await store.get(edit)).toEqual(original);
        expect(await store.drainQueue()).toHaveLength(1);

        const remote = { ...edit, version: edit.version + 10n, serverSeq: 20n };
        expect(await store.applyRemote(remote)).toBe(false);
        expect(await store.get(edit)).toEqual(original);

        // Start a newer save between awaited network work and an old acknowledgement.
        await store.drainQueue();
        const saving = store.putAndEnqueue({
          ...edit,
          ciphertext: new Uint8Array([7]),
          id: "new-revision",
        });
        const confirming = store.ackQueueItem(oldId, { version: edit.version, serverSeq: 30n });
        const newId = await saving;
        await confirming;
        expect(await store.get(edit)).toMatchObject({
          ciphertext: new Uint8Array([7]),
          serverSeq: null,
        });
        expect((await store.drainQueue()).map((item) => item.id)).toEqual([newId]);

        await store.close();
        expect(() => store.mode).toThrow(StorageNotInitializedError);
        store = createLocalStore({ workerUrl, dbFilename });
        await store.init();
        expect(store.mode).toBe(mode);
        if (mode === "opfs") {
          expect((await store.drainQueue()).map((item) => item.id)).toEqual([newId]);
          expect((await store.get(edit))?.ciphertext).toEqual(new Uint8Array([7]));
          const before = await store.get(edit);
          const confirmed = { version: edit.version + 1n, serverSeq: 9_223_372_036_854_775_807n };
          await store.ackQueueItem(newId, confirmed);
          expect(await store.get(edit)).toEqual({ ...before, ...confirmed });
          expect(await store.drainQueue()).toEqual([]);
        } else {
          // This is why memory-mode callers must require an exact server acknowledgement.
          expect(await store.get(edit)).toBeNull();
          expect(await store.drainQueue()).toEqual([]);
        }
        expect(await store.applyRemote(remote)).toBe(true);
        expect(await store.get(edit)).toMatchObject({ version: remote.version, serverSeq: 20n });

        const firstIdentical = await store.putAndEnqueue(edit);
        const lastIdentical = await store.putAndEnqueue(edit);
        await store.ackQueueItem(lastIdentical, { version: edit.version, serverSeq: 200n });
        await store.ackQueueItem(firstIdentical, { version: edit.version, serverSeq: 100n });
        expect((await store.get(edit))?.serverSeq).toBe(200n);
        expect(await store.drainQueue()).toEqual([]);

        const receiving = store.applyRemote({ ...remote, ciphertext: new Uint8Array([99]) });
        const savingDuringPull = store.putAndEnqueue(edit);
        await Promise.all([receiving, savingDuringPull]);
        expect(await store.get(edit)).toMatchObject({
          ciphertext: edit.ciphertext,
          serverSeq: null,
        });
        expect(await store.drainQueue()).toHaveLength(1);
      } finally {
        await store.destroy();
        expect(() => store.mode).toThrow(StorageNotInitializedError);
        if (mode === "memory") URL.revokeObjectURL(workerUrl);
      }
    },
    30_000,
  );

  it.each([
    { mode: "opfs", tombstone: false },
    { mode: "opfs", tombstone: true },
    { mode: "memory", tombstone: false },
    { mode: "memory", tombstone: true },
  ] as const)(
    "atomically accepts server data through the actual worker ($mode, deleted=$tombstone)",
    async ({ mode, tombstone }) => {
      const workerUrl = mode === "memory" ? memoryWorkerUrl() : "/sqlite/privance-worker.mjs";
      const dbFilename = `/discard-regression-${crypto.randomUUID()}.sqlite3`;
      let store = createLocalStore({ workerUrl, dbFilename });
      try {
        await store.init();
        expect(store.mode).toBe(mode);
        const id = await store.putAndEnqueue(edit);
        await store.setCursor(100n);
        const local = await store.get(edit);
        const replacement = {
          ...edit,
          ciphertext: new Uint8Array([99]),
          nonce: new Uint8Array([98]),
          version: edit.version + 5n,
          serverSeq: 50n,
          updatedAt: 1234,
          tombstone,
        };
        for (const change of [{ kind: "holding" }, { objectId: "other" }]) {
          await expect(
            store.ackQueueItem(id, undefined, { ...replacement, ...change }),
          ).rejects.toThrow("Replacement must match");
          expect(await store.get({ ...edit, ...change })).toBeNull();
          expect(await store.get(edit)).toEqual(local);
          expect((await store.drainQueue()).map((item) => item.id)).toEqual([id]);
        }
        // A NOT NULL violation fails inside the chosen-object write, after queue deletion.
        await expect(
          store.ackQueueItem(
            id,
            { version: 100n, serverSeq: 200n },
            {
              ...replacement,
              ciphertext: null as unknown as Uint8Array,
            },
          ),
        ).rejects.toThrow("NOT NULL");
        expect(await store.get(edit)).toEqual(local);
        expect((await store.drainQueue()).map((item) => item.id)).toEqual([id]);
        expect(await store.getCursor()).toBe(100n);
        await store.ackQueueItem(id, undefined, replacement);
        const chosen = await store.get(edit);
        expect(chosen).toEqual({
          kind: edit.kind,
          objectId: edit.objectId,
          ciphertext: replacement.ciphertext,
          nonce: replacement.nonce,
          version: replacement.version,
          serverSeq: replacement.serverSeq,
          updatedAt: 1234,
          tombstone,
        });
        expect(await store.drainQueue()).toEqual([]);
        // A repeated/stale choice cannot overwrite the now-accepted server data.
        await store.ackQueueItem(id, { version: 1n, serverSeq: 1n }, edit);
        expect(await store.get(edit)).toEqual(chosen);
        await store.close();
        store = createLocalStore({ workerUrl, dbFilename });
        await store.init();
        expect(await store.get(edit)).toEqual(mode === "opfs" ? chosen : null);
        expect(await store.getCursor()).toBe(mode === "opfs" ? 100n : null);
        expect(await store.drainQueue()).toEqual([]);
        const captured = await store.putAndEnqueue(edit);
        const later = { ...edit, ciphertext: new Uint8Array([7]), version: edit.version + 1n };
        const nextId = await store.putAndEnqueue(later);
        const next = await store.get(edit);
        await store.ackQueueItem(captured, undefined, replacement);
        expect(await store.get(edit)).toEqual(next);
        expect((await store.drainQueue()).map((item) => item.id)).toEqual([nextId]);
      } finally {
        await store.destroy();
        if (mode === "memory") URL.revokeObjectURL(workerUrl);
      }
    },
    30_000,
  );

  it("rejects a worker with no storage mode rather than assuming durability", async () => {
    const workerUrl = URL.createObjectURL(
      new Blob(["self.postMessage({ ready: true });"], { type: "text/javascript" }),
    );
    const store = createLocalStore({ workerUrl });
    try {
      await expect(store.init()).rejects.toThrow("worker init failed");
      expect(() => store.mode).toThrow(StorageNotInitializedError);
    } finally {
      await store.close();
      URL.revokeObjectURL(workerUrl);
    }
  });
});
