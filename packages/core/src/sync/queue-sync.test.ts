import initSqlite, { type Database } from "@sqlite.org/sqlite-wasm";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnqueueInput } from "../storage/types.js";
import { WebSqliteAdapter } from "../storage/web-adapter.js";
import { createSyncClient, type SyncClient } from "./client.js";
import { toBase64 } from "./envelope.js";
import { pullChanges } from "./pull.js";
import { pushPending } from "./push.js";
import { type SyncClientConfig, SyncProtocolError } from "./types.js";

const edit: EnqueueInput = {
  objectId: "account",
  kind: "account",
  ciphertext: new Uint8Array([1]),
  nonce: new Uint8Array(12),
  version: 1n,
  prevVersion: undefined,
  tombstone: false,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
type Wire = { object_id: string; version?: string; prev_version?: string; ciphertext?: string };
type Batch = { puts: Wire[]; deletes: Wire[] };
const parse = (init?: RequestInit): Batch => JSON.parse(String(init?.body));
const success = (batch: Batch, seq = 1) =>
  json({
    results: [...batch.puts, ...batch.deletes].map((row, i) => ({
      id: row.object_id,
      ok: true,
      version: row.version ?? String(BigInt(row.prev_version ?? "0") + 1n),
      server_seq: String(seq + i),
    })),
  });
const remote = (overrides: Record<string, unknown> = {}) => ({
  id: edit.objectId,
  object_id: edit.objectId,
  kind: edit.kind,
  ciphertext: toBase64(new Uint8Array([9])),
  nonce: toBase64(edit.nonce),
  version: "5",
  server_seq: "10",
  tombstone: false,
  ...overrides,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let db: Database;
let store: WebSqliteAdapter;
const decrypt = vi.fn(async ({ ciphertext }: { ciphertext: Uint8Array }) => ciphertext);
const encrypt = async ({ plaintext }: { plaintext: Uint8Array }) => ({
  ciphertext: plaintext,
  nonce: edit.nonce,
});
function client(
  fetcher: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
  onApplied?: () => void,
  onConfirmed?: SyncClientConfig["onConfirmed"],
): SyncClient {
  return createSyncClient({
    config: {
      serverUrl: "https://sync.test",
      fetch: fetcher as typeof fetch,
      ...(onApplied ? { onApplied } : {}),
      ...(onConfirmed ? { onConfirmed } : {}),
    },
    store,
    encryptEnvelope: encrypt,
    decryptEnvelope: decrypt,
  });
}
beforeEach(async () => {
  const sqlite = await initSqlite();
  db = new sqlite.oo1.DB(":memory:");
  store = new WebSqliteAdapter({ workerUrl: "unused", injectedDb: db });
  await store.init();
  decrypt.mockClear();
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await store.close();
});

describe("ordered queue push", () => {
  it("drains timestamp-tied put/delete/put revisions separately and exactly, rebasing confirmed predecessors", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1);
    const ids = [];
    for (const [index, tombstone] of [false, true, false].entries()) {
      ids.push(
        await store.putAndEnqueue({
          ...edit,
          id: ["z", "a", "b"][index],
          version: BigInt(index + 1),
          prevVersion: index ? 1n : undefined,
          tombstone,
          ciphertext: new Uint8Array([index]),
        }),
      );
    }
    const batches: Batch[] = [];
    const api = client(async (_url, init) => {
      const body = parse(init);
      batches.push(body);
      return success(body, batches.length);
    });
    expect((await api.pushPending()).confirmedQueueIds).toEqual(ids);
    expect(batches.map((b) => (b.puts.length ? "put" : "delete"))).toEqual([
      "put",
      "delete",
      "put",
    ]);
    expect(batches[1]?.deletes[0]?.prev_version).toBe("1");
    expect(batches[2]?.puts[0]?.prev_version).toBe("2");
    expect(await store.drainQueue()).toEqual([]);
    expect(await store.get(edit)).toMatchObject({
      ciphertext: new Uint8Array([2]),
      version: 3n,
      serverSeq: 3n,
      tombstone: false,
    });
  });

  it("serializes standalone, explicit, and background pushes without duplicates", async () => {
    const id = await store.putAndEnqueue(edit);
    const gate = deferred<Response>();
    const entered = deferred<void>();
    let calls = 0;
    const fetcher = vi.fn(async (_url, init) => {
      if (init?.method !== "POST") return json({ changes: [], next: null });
      calls++;
      entered.resolve();
      return gate.promise;
    });
    const api = client(fetcher);
    const first = api.pushPending();
    await entered.promise;
    const standalone = pushPending({
      config: { serverUrl: "", fetch: fetcher as typeof fetch },
      store,
      encryptEnvelope: encrypt,
      decryptEnvelope: decrypt,
      onConflict: null,
    });
    api.start({ pollIntervalMs: 60_000 });
    const explicit = api.pushPending();
    gate.resolve(success({ puts: [{ object_id: edit.objectId, version: "1" }], deletes: [] }));
    expect((await first).confirmedQueueIds).toEqual([id]);
    await standalone;
    await explicit;
    api.stop();
    expect(calls).toBe(1);
  });

  it("never overwrites ciphertext saved while a push is in flight", async () => {
    const firstId = await store.putAndEnqueue(edit);
    const gate = deferred<Response>();
    const entered = deferred<void>();
    let calls = 0;
    const api = client(async (_url, init) => {
      if (++calls === 1) {
        entered.resolve();
        return gate.promise;
      }
      return json({
        results: parse(init).puts.map((row) => ({
          id: row.object_id,
          ok: false,
          error: "try later",
        })),
      });
    });
    const pushing = api.pushPending();
    await entered.promise;
    const next = { ...edit, ciphertext: new Uint8Array([7]), version: 2n, prevVersion: 1n };
    const nextId = await store.putAndEnqueue(next);
    gate.resolve(success({ puts: [{ object_id: edit.objectId, version: "1" }], deletes: [] }));
    expect((await pushing).confirmedQueueIds).toEqual([firstId]);
    expect((await store.drainQueue()).map((i) => i.id)).toEqual([nextId]);
    expect(await store.get(edit)).toMatchObject({
      ciphertext: next.ciphertext,
      serverSeq: null,
      version: 2n,
    });
  });

  it("drains 501 records in two bounded requests", async () => {
    for (let i = 0; i < 501; i++) await store.putAndEnqueue({ ...edit, objectId: `a-${i}` });
    const sizes: number[] = [];
    const api = client(async (_url, init) => {
      const body = parse(init);
      sizes.push(body.puts.length);
      return success(body);
    });
    expect((await api.pushPending()).confirmedQueueIds).toHaveLength(501);
    expect(sizes).toEqual([500, 1]);
    expect(await store.drainQueue()).toEqual([]);
  });

  it("retains only later work when a later batch fails", async () => {
    for (let i = 0; i < 501; i++)
      await store.putAndEnqueue({ ...edit, objectId: `a-${i}`, id: `q-${i}` });
    let calls = 0;
    const api = client(async (_url, init) =>
      ++calls === 1 ? success(parse(init)) : json({}, 503),
    );
    await expect(api.pushPending()).rejects.toThrow("503");
    expect((await store.drainQueue()).map((i) => i.id)).toEqual(["q-500"]);
  });

  it("bounds actual UTF-8 body bytes including Unicode and JSON/base64 overhead", async () => {
    // Exact 5MiB boundary: fill metadata with ASCII after computing envelope overhead.
    const base = {
      object_id: "emoji-💰",
      kind: "account",
      ciphertext: "AQ==",
      nonce: toBase64(edit.nonce),
      version: "1",
    };
    const overhead = new TextEncoder().encode(JSON.stringify({ puts: [base], deletes: [] })).length;
    const kind = base.kind + "x".repeat(5 * 1024 * 1024 - overhead);
    await store.putAndEnqueue({ ...edit, objectId: base.object_id, kind });
    await store.putAndEnqueue({ ...edit, objectId: "small" });
    const bytes: number[] = [];
    const api = client(async (_url, init) => {
      bytes.push(new TextEncoder().encode(String(init?.body)).length);
      return success(parse(init));
    });
    expect((await api.pushPending()).confirmedQueueIds).toHaveLength(2);
    expect(bytes).toEqual([5 * 1024 * 1024, expect.any(Number)]);
    expect(bytes[1]).toBeLessThan(500);
  });

  it("keeps an oversized singleton queued with actionable error without starving small records", async () => {
    const largeId = await store.putAndEnqueue({ ...edit, kind: "x".repeat(5 * 1024 * 1024) });
    const smallId = await store.putAndEnqueue({ ...edit, objectId: "small" });
    const api = client(async (_url, init) => success(parse(init)));
    const result = await api.pushPending();
    expect(result.confirmedQueueIds).toEqual([smallId]);
    expect(result.results[0]).toMatchObject({
      ok: false,
      error: expect.stringContaining("Reduce its size"),
    });
    expect((await store.drainQueue()).map((i) => i.id)).toEqual([largeId]);
  });

  it.each(["unknown", "duplicate", "missing", "invalid"])(
    "rejects %s batch results before acknowledging anything",
    async (problem) => {
      const id = await store.putAndEnqueue(edit);
      const row = { id: edit.objectId, ok: true, server_seq: "1", version: "1" };
      const results =
        problem === "unknown"
          ? [{ ...row, id: "other" }]
          : problem === "duplicate"
            ? [row, row]
            : problem === "missing"
              ? []
              : [null];
      await expect(client(async () => json({ results })).pushPending()).rejects.toThrow(
        SyncProtocolError,
      );
      expect((await store.drainQueue()).map((i) => i.id)).toEqual([id]);
    },
  );
});

describe("pending conflicts and explicit decisions", () => {
  it("retains conflicts across repeated push/pull polls and continues unrelated work", async () => {
    const id = await store.putAndEnqueue(edit);
    await store.putAndEnqueue({ ...edit, objectId: "other" });
    const api = client(async (_url, init) => {
      if (init?.method !== "POST") return json({ changes: [remote()], next: null });
      const results = [...parse(init).puts].map((row) =>
        row.object_id === edit.objectId
          ? { id: row.object_id, ok: false, conflict: { current_version: "5" } }
          : { id: row.object_id, ok: true, version: "1", server_seq: "11" },
      );
      return json({ results });
    });
    for (let i = 0; i < 3; i++) {
      await api.pushPending();
      expect((await api.pullChanges()).applied).toBe(0);
    }
    expect((await store.drainQueue()).map((i) => i.id)).toEqual([id]);
    expect((await store.get(edit))?.ciphertext).toEqual(edit.ciphertext);
  });

  it("property: remote equal/newer versions and tombstones cannot clobber pending ciphertext", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 1n, max: 1000n }),
        fc.boolean(),
        fc.uint8Array({ minLength: 1, maxLength: 30 }),
        async (version, tombstone, ciphertext) => {
          const id = await store.putAndEnqueue({ ...edit, ciphertext });
          const api = client(async () =>
            json({ changes: [remote({ version: version.toString(), tombstone })], next: null }),
          );
          expect((await api.pullChanges()).applied).toBe(0);
          expect((await store.get(edit))?.ciphertext).toEqual(ciphertext);
          expect((await store.drainQueue()).map((row) => row.id)).toContain(id);
          await store.ackQueueItem(id);
        },
      ),
      { numRuns: 40 },
    );
  });

  it.each([false, true])(
    "uses server live/deleted version explicitly, never counts it as upload (deleted=%s)",
    async (tombstone) => {
      const id = await store.putAndEnqueue(edit);
      const api = client(async () => json(remote({ tombstone })));
      expect(await api.resolveConflict(id, { action: "keep-theirs" })).toEqual({
        confirmedQueueIds: [],
      });
      expect(await store.drainQueue()).toEqual([]);
      expect(await store.get(edit)).toMatchObject({
        tombstone,
        version: 5n,
        serverSeq: 10n,
        ciphertext: tombstone ? new Uint8Array(0) : new Uint8Array([9]),
      });
      if (tombstone)
        expect(decrypt).not.toHaveBeenCalledWith(
          expect.objectContaining({ ciphertext: new Uint8Array([9]) }),
        );
    },
  );

  it.each([false, true])(
    "keeps this device's live/deleted intent via CAS without resurrection mistakes (deleted=%s)",
    async (tombstone) => {
      const id = await store.putAndEnqueue({ ...edit, tombstone });
      const requests: RequestInit[] = [];
      const api = client(async (_url, init) => {
        requests.push(init ?? {});
        if (init?.method === "GET") return json(remote({ tombstone: !tombstone }));
        return init?.method === "POST"
          ? success(parse(init), 11)
          : json({ version: "6", server_seq: "11" });
      });
      expect((await api.resolveConflict(id, { action: "keep-mine" })).confirmedQueueIds).toEqual([
        id,
      ]);
      expect(requests[1]?.method).toBe(tombstone ? "POST" : "PUT");
      const wire = JSON.parse(String(requests[1]?.body));
      expect(tombstone ? wire.deletes[0].prev_version : wire.prev_version).toBe("5");
      expect(await store.get(edit)).toMatchObject({ tombstone, version: 6n, serverSeq: 11n });
      expect(await store.drainQueue()).toEqual([]);
    },
  );

  it.each(["keep-mine", "keep-theirs", "keep-both"] as const)(
    "preserves later edits during a %s decision, resolving only the intended queue ID",
    async (action) => {
      const id = await store.putAndEnqueue(edit);
      const decision = deferred<{ action: typeof action; newObjectId: string }>();
      const notified = deferred<void>();
      const api = client(async (_url, init) =>
        init?.method === "POST"
          ? json({
              results: [{ id: edit.objectId, ok: false, conflict: { current_version: "5" } }],
            })
          : init?.method === "PUT"
            ? json({ version: "6", server_seq: "11" })
            : json(remote()),
      );
      api.onConflict(async () => {
        notified.resolve();
        return decision.promise;
      });
      const pushing = api.pushPending();
      await notified.promise;
      const newer = {
        ...edit,
        version: 2n,
        prevVersion: 1n,
        ciphertext: new Uint8Array([7]),
        tombstone: true,
      };
      const nextId = await store.putAndEnqueue(newer);
      decision.resolve({ action, newObjectId: "copy" });
      const result = await pushing;
      expect(result.confirmedQueueIds).toEqual(action === "keep-mine" ? [id] : []);
      expect((await store.drainQueue()).map((row) => row.id)).toEqual([nextId]);
      expect(await store.get(edit)).toMatchObject({
        ciphertext: newer.ciphertext,
        tombstone: true,
        serverSeq: null,
      });
    },
  );

  it("defers a visible decision without blocking unrelated pushes, and resolves by exact queue ID", async () => {
    const id = await store.putAndEnqueue(edit);
    const notice = vi.fn(async () => ({ action: "defer" as const }));
    const api = client(async (_url, init) =>
      init?.method === "POST"
        ? json({
            results: parse(init).puts.map((row) =>
              row.object_id === edit.objectId
                ? { id: row.object_id, ok: false, conflict: { current_version: "5" } }
                : { id: row.object_id, ok: true, version: "1", server_seq: "11" },
            ),
          })
        : json(remote()),
    );
    api.onConflict(notice);
    expect((await api.pushPending()).confirmedQueueIds).toEqual([]);
    const otherId = await store.putAndEnqueue({ ...edit, objectId: "unrelated" });
    expect((await api.pushPending()).confirmedQueueIds).toEqual([otherId]);
    expect(notice).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: id, myTombstone: false, theirTombstone: false }),
    );
    await api.resolveConflict(id, { action: "keep-theirs" });
    expect(await store.drainQueue()).toEqual([]);
  });

  it.each(["keep-mine", "keep-theirs"] as const)(
    "protects an edit inserted after exact acknowledgement but before %s application",
    async (action) => {
      const id = await store.putAndEnqueue(edit);
      const acknowledge = store.ackQueueItem.bind(store);
      const newer = {
        ...edit,
        id: "post-ack-edit",
        version: 7n,
        prevVersion: 6n,
        ciphertext: new Uint8Array([8]),
        tombstone: true,
      };
      vi.spyOn(store, "ackQueueItem").mockImplementation(
        async (queueId, confirmation, replacement) => {
          await acknowledge(queueId, confirmation, replacement);
          if (queueId === id) await store.putAndEnqueue(newer);
        },
      );
      const api = client(async (_url, init) =>
        init?.method === "PUT" ? json({ version: "6", server_seq: "11" }) : json(remote()),
      );
      await api.resolveConflict(id, { action });
      expect((await store.drainQueue()).map((row) => row.id)).toEqual([newer.id]);
      expect(await store.get(edit)).toMatchObject({
        ciphertext: newer.ciphertext,
        tombstone: true,
        version: 7n,
        serverSeq: null,
      });
    },
  );

  it.each([false, true])(
    "rolls back a failed server choice beyond the pull cursor, then retries and reopens (deleted=%s)",
    async (tombstone) => {
      const filename = `/conflict-discard-${crypto.randomUUID()}.sqlite3`;
      const sqlite = await initSqlite();
      await store.close();
      const db = new sqlite.oo1.DB(filename, "c");
      store = new WebSqliteAdapter({ workerUrl: "unused", injectedDb: db });
      await store.init();
      try {
        const id = await store.putAndEnqueue(edit);
        const local = await store.get(edit);
        const onConfirmed = vi.fn();
        const onApplied = vi.fn();
        let pulled = false;
        const api = client(
          async (url) => {
            if (!String(url).includes("/changes")) return json(remote({ tombstone }));
            const changes = pulled ? [] : [remote({ tombstone })];
            if (pulled) expect(String(url)).toContain("since=10");
            pulled = true;
            return json({ changes, next: null });
          },
          onApplied,
          onConfirmed,
        );
        expect((await api.pullChanges()).applied).toBe(0);
        expect(await store.getCursor()).toBe(10n);
        db.exec(`CREATE TRIGGER fail_choice BEFORE INSERT ON sync_objects
          BEGIN SELECT RAISE(ABORT, 'chosen envelope failed'); END`);
        await expect(api.resolveConflict(id, { action: "keep-theirs" })).rejects.toThrow(
          "chosen envelope failed",
        );
        expect(await store.get(edit)).toEqual(local);
        expect((await store.drainQueue()).map((item) => item.id)).toEqual([id]);
        expect(onApplied).not.toHaveBeenCalled();
        expect(onConfirmed).not.toHaveBeenCalled();
        expect((await api.pullChanges()).applied).toBe(0);
        db.exec("DROP TRIGGER fail_choice");
        expect(await api.resolveConflict(id, { action: "keep-theirs" })).toEqual({
          confirmedQueueIds: [],
        });
        expect(onApplied).toHaveBeenCalledTimes(1);
        expect(onConfirmed).not.toHaveBeenCalled();
        await store.close();
        store = new WebSqliteAdapter({
          workerUrl: "unused",
          injectedDb: new sqlite.oo1.DB(filename, "w"),
        });
        await store.init();
        expect(await store.getCursor()).toBe(10n);
        expect(await store.drainQueue()).toEqual([]);
        expect(await store.get(edit)).toMatchObject({
          ciphertext: tombstone ? new Uint8Array(0) : new Uint8Array([9]),
          version: 5n,
          serverSeq: 10n,
          tombstone,
        });
      } finally {
        await store.close();
      }
    },
  );

  it("keep-both retains original intent if accepting its server counterpart fails", async () => {
    const id = await store.putAndEnqueue(edit);
    const local = await store.get(edit);
    const onConfirmed = vi.fn();
    const api = client(
      async (_url, init) =>
        init?.method === "PUT" ? json({ version: "1", server_seq: "11" }) : json(remote()),
      undefined,
      onConfirmed,
    );
    db.exec(`CREATE TRIGGER fail_original_choice BEFORE INSERT ON sync_objects
      WHEN NEW.object_id = 'account'
      BEGIN SELECT RAISE(ABORT, 'original choice failed'); END`);
    await expect(
      api.resolveConflict(id, { action: "keep-both", newObjectId: "copy" }),
    ).rejects.toThrow("original choice failed");
    expect((await store.drainQueue()).map((item) => item.id)).toEqual([id]);
    expect(await store.get(edit)).toEqual(local);
    expect(await store.get({ ...edit, objectId: "copy" })).toMatchObject({
      ciphertext: edit.ciphertext,
      version: 1n,
      serverSeq: 11n,
    });
    db.exec("DROP TRIGGER fail_original_choice");
    await api.resolveConflict(id, { action: "keep-theirs" });
    expect(await store.drainQueue()).toEqual([]);
    expect(await store.get(edit)).toMatchObject({
      ciphertext: new Uint8Array([9]),
      serverSeq: 10n,
    });
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("preserves queue and ciphertext when explicit resolution fails", async () => {
    const id = await store.putAndEnqueue(edit);
    const api = client(async (_url, init) =>
      init?.method === "GET" ? json(remote()) : json({}, 409),
    );
    await expect(api.resolveConflict(id, { action: "keep-mine" })).rejects.toThrow("409");
    expect((await store.drainQueue()).map((row) => row.id)).toEqual([id]);
    expect((await store.get(edit))?.ciphertext).toEqual(edit.ciphertext);
  });
});

describe("queue sync edge cases", () => {
  it("does not starve other batches when fetching a conflicted record fails", async () => {
    await store.putAndEnqueue(edit);
    for (let i = 0; i < 501; i++) await store.putAndEnqueue({ ...edit, objectId: `other-${i}` });
    const api = client(async (_url, init) =>
      init?.method === "GET"
        ? json({}, 500)
        : json({
            results: parse(init).puts.map((row) =>
              row.object_id === edit.objectId
                ? { id: row.object_id, ok: false, conflict: { current_version: "5" } }
                : { id: row.object_id, ok: true, version: "1", server_seq: "11" },
            ),
          }),
    );
    api.onConflict(async () => ({ action: "defer" }));
    await expect(api.pushPending()).rejects.toThrow("500");
    expect((await store.drainQueue()).map((item) => item.objectId)).toEqual([edit.objectId]);
  });

  it.each(["keep-mine", "keep-theirs"] as const)(
    "distinguishes genuinely absent version0 with an explicit %s decision",
    async (action) => {
      const id = await store.putAndEnqueue({
        ...edit,
        version: 3n,
        prevVersion: 2n,
        tombstone: action === "keep-mine",
      });
      const api = client(async (_url, init) =>
        init?.method === "POST"
          ? json({
              results: [{ id: edit.objectId, ok: false, conflict: { current_version: "0" } }],
            })
          : json({}, 404),
      );
      const notify = vi.fn(async () => ({ action: "defer" as const }));
      api.onConflict(notify);
      await api.pushPending();
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ theirVersion: 0n, theirTombstone: true }),
      );
      expect((await store.drainQueue()).map((row) => row.id)).toEqual([id]);
      expect(await api.resolveConflict(id, { action })).toEqual({ confirmedQueueIds: [] });
      expect(await store.drainQueue()).toEqual([]);
      expect((await store.get(edit))?.tombstone).toBe(true);
    },
  );

  it("restores an explicitly chosen live revision when server confirms physical absence", async () => {
    const id = await store.putAndEnqueue({ ...edit, prevVersion: 2n });
    const api = client(async (_url, init) =>
      init?.method === "POST"
        ? json({ results: [{ id: edit.objectId, ok: false, conflict: { current_version: "0" } }] })
        : init?.method === "PUT"
          ? json({ version: "1", server_seq: "12" })
          : json({}, 404),
    );
    api.onConflict(async () => ({ action: "keep-mine" }));
    expect((await api.pushPending()).confirmedQueueIds).toEqual([id]);
    expect(await store.drainQueue()).toEqual([]);
    expect(await store.get(edit)).toMatchObject({ tombstone: false, serverSeq: 12n });
  });

  it("rejects duplicating a tombstone instead of creating a live object accidentally", async () => {
    const id = await store.putAndEnqueue({ ...edit, tombstone: true });
    await expect(
      client(async () => json(remote())).resolveConflict(id, {
        action: "keep-both",
        newObjectId: "copy",
      }),
    ).rejects.toThrow("deletion cannot be duplicated");
    expect((await store.drainQueue()).map((row) => row.id)).toEqual([id]);
    expect(await store.get({ ...edit, objectId: "copy" })).toBeNull();
  });

  it.each(["network", "conflict", "bad-id"])(
    "keeps deletion queued after a resolution %s failure",
    async (failure) => {
      const id = await store.putAndEnqueue({ ...edit, tombstone: true });
      const api = client(async (_url, init) =>
        init?.method === "GET"
          ? json(remote())
          : failure === "network"
            ? json({}, 503)
            : json({
                results: [{ id: failure === "bad-id" ? "wrong" : edit.objectId, ok: false }],
              }),
      );
      await expect(api.resolveConflict(id, { action: "keep-mine" })).rejects.toThrow();
      expect((await store.drainQueue()).map((row) => row.id)).toEqual([id]);
      expect((await store.get(edit))?.tombstone).toBe(true);
    },
  );

  it("defer and missing queue IDs do not invalidate the store", async () => {
    const id = await store.putAndEnqueue(edit);
    const tick = vi.fn();
    const api = client(async () => json(remote()), tick);
    await api.resolveConflict(id, { action: "defer" });
    await api.resolveConflict("missing", { action: "keep-mine" });
    expect(tick).not.toHaveBeenCalled();
    expect((await store.drainQueue()).map((row) => row.id)).toEqual([id]);
  });

  it("a failed serialized request does not poison future pushes", async () => {
    const id = await store.putAndEnqueue(edit);
    let calls = 0;
    const api = client(async (_url, init) =>
      ++calls === 1 ? json({}, 503) : success(parse(init)),
    );
    await expect(api.pushPending()).rejects.toThrow("503");
    expect((await api.pushPending()).confirmedQueueIds).toEqual([id]);
  });

  it("accounts for base64 expansion when raw ciphertext alone would fit", async () => {
    for (const objectId of ["large-a", "large-b"])
      await store.putAndEnqueue({ ...edit, objectId, ciphertext: new Uint8Array(2 * 1024 * 1024) });
    const sizes: number[] = [];
    const api = client(async (_url, init) => {
      sizes.push(new TextEncoder().encode(String(init?.body)).length);
      return success(parse(init));
    });
    expect((await api.pushPending()).confirmedQueueIds).toHaveLength(2);
    expect(sizes).toHaveLength(2);
    expect(sizes.every((size) => size <= 5 * 1024 * 1024)).toBe(true);
  });

  it.each([null, { current_version: null }])(
    "treats malformed conflict metadata as a protocol error",
    async (conflict) => {
      const id = await store.putAndEnqueue(edit);
      await expect(
        client(async () =>
          json({ results: [{ id: edit.objectId, ok: false, conflict }] }),
        ).pushPending(),
      ).rejects.toThrow(SyncProtocolError);
      expect((await store.drainQueue()).map((row) => row.id)).toEqual([id]);
    },
  );
});

describe("pull notifications and synchronization", () => {
  it("serializes an old pull/decrypt with explicit push acknowledgement, preventing confirmed downgrade", async () => {
    await store.putAndEnqueue(edit);
    const decrypting = deferred<void>();
    const release = deferred<Uint8Array>();
    const decryptEnvelope = vi.fn(async () => {
      decrypting.resolve();
      return release.promise;
    });
    const fetcher = vi.fn(async (_url, init) =>
      init?.method === "POST"
        ? success(parse(init), 20)
        : json({ changes: [remote({ version: "1" })], next: null }),
    );
    const pulling = pullChanges({
      config: { serverUrl: "", fetch: fetcher as typeof fetch },
      store,
      decryptEnvelope,
    });
    await decrypting.promise;
    const pushing = client(fetcher).pushPending();
    // Let a bypassed push finish its SQLite/fetch microtasks while decrypt remains blocked.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher).toHaveBeenCalledTimes(1);
    release.resolve(new Uint8Array([9]));
    expect((await pulling).applied).toBe(0);
    await pushing;
    expect(await store.get(edit)).toMatchObject({
      ciphertext: edit.ciphertext,
      version: 1n,
      serverSeq: 20n,
    });
  });

  it("notifies once per applied page/drain, never for empty or already-confirmed pulls", async () => {
    const onApplied = vi.fn();
    let step = 0;
    const pages = [
      { changes: [remote(), remote({ id: "other", server_seq: "11" })], next: null },
      { changes: [remote()], next: null },
      { changes: [], next: null },
      { changes: [remote({ id: "page2", server_seq: "12" })], next: "12" },
      { changes: [remote({ id: "page3", server_seq: "13" })], next: null },
    ];
    const api = client(async () => json(pages[step++]), onApplied);
    expect((await api.pullChanges()).applied).toBe(2);
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect((await api.pullChanges()).applied).toBe(0);
    await api.pullChanges();
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect((await api.drainAllChanges()).totalApplied).toBe(2);
    expect(onApplied).toHaveBeenCalledTimes(2);
  });

  it("notifies applied drain pages even if a later page fails", async () => {
    const onApplied = vi.fn();
    let count = 0;
    const api = client(
      async () => (++count === 1 ? json({ changes: [remote()], next: "10" }) : json({}, 503)),
      onApplied,
    );
    await expect(api.drainAllChanges()).rejects.toThrow("503");
    expect(onApplied).toHaveBeenCalledTimes(1);
  });
});

describe("exact upload notifications", () => {
  it("notifies committed exact IDs before a later batch fails", async () => {
    const ids = [];
    for (let i = 0; i < 501; i++)
      ids.push(await store.putAndEnqueue({ ...edit, objectId: `notice-${i}` }));
    const confirmed: string[] = [];
    let calls = 0;
    const api = client(
      async (_url, init) => {
        if (++calls === 2) {
          expect(confirmed).toEqual(ids.slice(0, 500));
          expect((await store.drainQueue()).map((item) => item.id)).toEqual(ids.slice(500));
          throw new Error("unavailable");
        }
        return success(parse(init));
      },
      undefined,
      (queueIds) => confirmed.push(...queueIds),
    );
    await expect(api.pushPending()).rejects.toThrow();
    expect(confirmed).toEqual(ids.slice(0, 500));
  });

  it.each(["keep-mine", "keep-theirs"] as const)(
    "only notifies uploaded %s resolutions",
    async (action) => {
      const id = await store.putAndEnqueue(edit);
      const confirmed: string[] = [];
      const api = client(
        async (_url, init) => {
          if (init?.method === "POST")
            return json({
              results: [{ id: edit.objectId, ok: false, conflict: { current_version: "5" } }],
            });
          if (init?.method === "PUT") return json({ version: "6", server_seq: "11" });
          return json(remote());
        },
        undefined,
        (queueIds) => confirmed.push(...queueIds),
      );
      api.onConflict(async () => ({ action: "defer" }));
      await api.pushPending();
      expect(confirmed).toEqual([]);
      await api.resolveConflict(id, { action });
      expect(confirmed).toEqual(action === "keep-mine" ? [id] : []);
    },
  );

  it("does not notify when atomic acknowledgement fails", async () => {
    await store.putAndEnqueue(edit);
    vi.spyOn(store, "ackQueueItem").mockRejectedValue(new Error("disk failed"));
    const onConfirmed = vi.fn();
    const api = client(async (_url, init) => success(parse(init)), undefined, onConfirmed);
    await expect(api.pushPending()).rejects.toThrow("disk failed");
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});
