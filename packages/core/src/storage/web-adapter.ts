/**
 * Web SQLite adapter.
 *
 * Production path: spawns a Worker that hosts the SAHPool VFS. All sqlite
 * operations are dispatched through a message-based RPC protocol so they run
 * inside the Worker where createSyncAccessHandle is available.
 *
 * Test path: accepts an injected synchronous Database object (from the Node
 * build of @sqlite.org/sqlite-wasm) so the full suite runs without OPFS.
 */
import { CURSOR_KEY, DDL } from "./schema.js";
import type {
  EnqueueInput,
  LocalStore,
  OutboundItem,
  PutObjectInput,
  StoredObject,
} from "./types.js";
import { StorageNotInitializedError } from "./types.js";

// ---------------------------------------------------------------------------
// Minimal interface for the injected test database
// ---------------------------------------------------------------------------

/**
 * Synchronous subset of @sqlite.org/sqlite-wasm Database used only by the
 * test path. Typed here to avoid importing the sqlite-wasm package into
 * production bundles.
 */
interface TestDb {
  exec(opts: {
    sql: string;
    bind?: unknown[];
    returnValue?: string;
    rowMode?: string;
  }): Record<string, unknown>[];
  exec(sql: string): void;
  transaction(fn: () => void): void;
  close(): void;
}

// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------

function randomId(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function rowToStoredObject(row: Record<string, unknown>): StoredObject {
  return {
    kind: row.kind as string,
    objectId: row.object_id as string,
    ciphertext: row.ciphertext as Uint8Array,
    nonce: row.nonce as Uint8Array,
    version: BigInt(row.version as number | bigint),
    serverSeq: row.server_seq != null ? BigInt(row.server_seq as number | bigint) : null,
    tombstone: (row.tombstone as number | bigint) !== 0,
    updatedAt: Number(row.updated_at as number | bigint),
  };
}

function rowToOutboundItem(row: Record<string, unknown>): OutboundItem {
  return {
    id: row.id as string,
    kind: row.kind as string,
    objectId: row.object_id as string,
    ciphertext: row.ciphertext as Uint8Array,
    nonce: row.nonce as Uint8Array,
    version: BigInt(row.version as number | bigint),
    prevVersion: row.prev_version != null ? BigInt(row.prev_version as number | bigint) : undefined,
    tombstone: (row.tombstone as number | bigint) !== 0,
    enqueuedAt: Number(row.enqueued_at as number | bigint),
  };
}

// ---------------------------------------------------------------------------
// Internal interface shared by both implementations
// ---------------------------------------------------------------------------

interface LocalStoreImpl {
  put(input: PutObjectInput): Promise<void>;
  get(input: { kind: string; objectId: string }): Promise<StoredObject | null>;
  list(input: { kind: string }): Promise<StoredObject[]>;
  delete(input: { kind: string; objectId: string }): Promise<void>;
  getCursor(): Promise<bigint | null>;
  setCursor(seq: bigint): Promise<void>;
  enqueue(item: EnqueueInput): Promise<void>;
  drainQueue(): Promise<OutboundItem[]>;
  ackQueueItem(id: string): Promise<void>;
  close(): Promise<void>;
  destroy(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Synchronous (test-path) implementation
// ---------------------------------------------------------------------------

function makeSyncImpl(db: TestDb): LocalStoreImpl {
  return {
    put(input: PutObjectInput): Promise<void> {
      const now = input.updatedAt ?? Date.now();
      const serverSeq = input.serverSeq ?? null;
      const tombstone = input.tombstone ?? false;
      db.transaction(() => {
        db.exec({
          sql: `
            INSERT INTO sync_objects
              (kind, object_id, ciphertext, nonce, version, server_seq, tombstone, updated_at)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (kind, object_id) DO UPDATE SET
              ciphertext  = excluded.ciphertext,
              nonce       = excluded.nonce,
              version     = excluded.version,
              server_seq  = excluded.server_seq,
              tombstone   = excluded.tombstone,
              updated_at  = excluded.updated_at
          `,
          bind: [
            input.kind,
            input.objectId,
            input.ciphertext,
            input.nonce,
            input.version,
            serverSeq,
            tombstone ? 1 : 0,
            now,
          ],
        });
      });
      return Promise.resolve();
    },

    get(input: { kind: string; objectId: string }): Promise<StoredObject | null> {
      const rows = db.exec({
        sql: `
          SELECT kind, object_id, ciphertext, nonce, version, server_seq, tombstone, updated_at
          FROM sync_objects
          WHERE kind = ? AND object_id = ?
        `,
        bind: [input.kind, input.objectId],
        returnValue: "resultRows",
        rowMode: "object",
      });
      const row = rows[0];
      return Promise.resolve(row !== undefined ? rowToStoredObject(row) : null);
    },

    list(input: { kind: string }): Promise<StoredObject[]> {
      const rows = db.exec({
        sql: `
          SELECT kind, object_id, ciphertext, nonce, version, server_seq, tombstone, updated_at
          FROM sync_objects
          WHERE kind = ?
          ORDER BY object_id ASC
        `,
        bind: [input.kind],
        returnValue: "resultRows",
        rowMode: "object",
      });
      return Promise.resolve(rows.map(rowToStoredObject));
    },

    delete(input: { kind: string; objectId: string }): Promise<void> {
      db.exec({
        sql: `DELETE FROM sync_objects WHERE kind = ? AND object_id = ?`,
        bind: [input.kind, input.objectId],
      });
      return Promise.resolve();
    },

    getCursor(): Promise<bigint | null> {
      const rows = db.exec({
        sql: `SELECT value FROM sync_cursor WHERE key = ?`,
        bind: [CURSOR_KEY],
        returnValue: "resultRows",
        rowMode: "object",
      });
      const row = rows[0];
      return Promise.resolve(row !== undefined ? BigInt(row.value as string) : null);
    },

    setCursor(seq: bigint): Promise<void> {
      db.exec({
        sql: `
          INSERT INTO sync_cursor (key, value) VALUES (?, ?)
          ON CONFLICT (key) DO UPDATE SET value = excluded.value
        `,
        bind: [CURSOR_KEY, seq.toString()],
      });
      return Promise.resolve();
    },

    enqueue(item: EnqueueInput): Promise<void> {
      const id = item.id ?? randomId();
      const now = Date.now();
      const prevVersion = item.prevVersion != null ? item.prevVersion : null;
      db.transaction(() => {
        db.exec({
          sql: `
            INSERT INTO outbound_queue
              (id, kind, object_id, ciphertext, nonce, version, prev_version, tombstone, enqueued_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          bind: [
            id,
            item.kind,
            item.objectId,
            item.ciphertext,
            item.nonce,
            item.version,
            prevVersion,
            item.tombstone ? 1 : 0,
            now,
          ],
        });
      });
      return Promise.resolve();
    },

    drainQueue(): Promise<OutboundItem[]> {
      const rows = db.exec({
        sql: `
          SELECT id, kind, object_id, ciphertext, nonce, version, prev_version, tombstone, enqueued_at
          FROM outbound_queue
          ORDER BY enqueued_at ASC
        `,
        returnValue: "resultRows",
        rowMode: "object",
      });
      return Promise.resolve(rows.map(rowToOutboundItem));
    },

    ackQueueItem(id: string): Promise<void> {
      db.exec({ sql: `DELETE FROM outbound_queue WHERE id = ?`, bind: [id] });
      return Promise.resolve();
    },

    close(): Promise<void> {
      db.close();
      return Promise.resolve();
    },

    destroy(): Promise<void> {
      db.transaction(() => {
        db.exec("DELETE FROM sync_objects");
        db.exec("DELETE FROM sync_cursor");
        db.exec("DELETE FROM outbound_queue");
      });
      db.close();
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// Worker RPC types (browser path only)
// ---------------------------------------------------------------------------

interface WorkerRequest {
  id: string;
  method: string;
  args: Record<string, unknown> | undefined;
}

interface WorkerReply {
  id?: string;
  ready?: boolean;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Worker-path implementation (browser only, not exercised in Node tests)
// ---------------------------------------------------------------------------

/* c8 ignore start, worker path requires a browser (OPFS/Worker API) */
function makeWorkerImpl(
  workerUrl: string,
  dbFilename: string,
): {
  init(): Promise<void>;
  impl: LocalStoreImpl;
} {
  let worker: Worker | null = null;
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let pagehideHandler: (() => void) | null = null;

  function removePagehideHandler(): void {
    if (
      pagehideHandler !== null &&
      typeof globalThis !== "undefined" &&
      typeof globalThis.removeEventListener === "function"
    ) {
      globalThis.removeEventListener("pagehide", pagehideHandler);
    }
    pagehideHandler = null;
  }

  function send<T>(method: string, args?: Record<string, unknown>): Promise<T> {
    if (worker === null) throw new StorageNotInitializedError();
    // Random IDs prevent a recreated worker from cross-wiring late replies from
    // a previous worker (each WebSqliteAdapter instance gets a fresh pending Map
    // but message ids overlap if both use a counter starting from 0).
    const id = randomId();
    const request: WorkerRequest = { id, method, args: args };
    const w = worker;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: (v) => resolve(v as T), reject });
      w.postMessage(request);
    });
  }

  function sendVoid(method: string, args?: Record<string, unknown>): Promise<void> {
    return send<unknown>(method, args).then(() => undefined);
  }

  async function init(): Promise<void> {
    if (worker !== null) return;

    let readyResolve: (() => void) | null = null;
    let readyReject: ((e: Error) => void) | null = null;
    const readyPromise = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });

    worker = new Worker(workerUrl, { type: "module" });

    worker.addEventListener("message", (ev: MessageEvent<WorkerReply>) => {
      const msg = ev.data;

      if (msg.ready !== undefined) {
        if (msg.ready === true) {
          readyResolve?.();
        } else {
          readyReject?.(new Error(`worker init failed: ${msg.error ?? "unknown"}`));
        }
        readyResolve = null;
        readyReject = null;
        return;
      }

      const id = msg.id;
      if (id === undefined) return;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (msg.ok === true) {
        p.resolve(msg.result);
      } else {
        p.reject(new Error(`worker error: ${msg.error ?? "unknown"}`));
      }
    });

    worker.addEventListener("error", (ev: ErrorEvent) => {
      readyReject?.(new Error(`worker startup error: ${ev.message}`));
      readyResolve = null;
      readyReject = null;
      const err = new Error(`worker error: ${ev.message}`);
      for (const { reject } of pending.values()) reject(err);
      pending.clear();
    });

    // Release OPFS access handles on unload so the next worker can claim them.
    // Tracked so close()/destroy() can remove it, otherwise repeated
    // login/logout cycles accumulate listeners on globalThis.
    if (typeof globalThis !== "undefined" && typeof globalThis.addEventListener === "function") {
      pagehideHandler = () => {
        worker?.terminate();
        worker = null;
      };
      globalThis.addEventListener("pagehide", pagehideHandler);
    }

    await readyPromise;

    await sendVoid("init", { dbFilename, ddl: DDL });
  }

  const impl: LocalStoreImpl = {
    put: (input) =>
      sendVoid("put", {
        kind: input.kind,
        objectId: input.objectId,
        ciphertext: input.ciphertext,
        nonce: input.nonce,
        version: input.version,
        serverSeq: input.serverSeq ?? null,
        tombstone: input.tombstone ?? false,
        updatedAt: input.updatedAt ?? Date.now(),
      }),
    get: (input) =>
      send<StoredObject | null>("get", {
        kind: input.kind,
        objectId: input.objectId,
      }),
    list: (input) => send<StoredObject[]>("list", { kind: input.kind }),
    delete: (input) => sendVoid("delete", { kind: input.kind, objectId: input.objectId }),
    getCursor: () => send<bigint | null>("getCursor"),
    setCursor: (seq) => sendVoid("setCursor", { seq }),
    enqueue: (item) =>
      sendVoid("enqueue", {
        id: item.id,
        kind: item.kind,
        objectId: item.objectId,
        ciphertext: item.ciphertext,
        nonce: item.nonce,
        version: item.version,
        prevVersion: item.prevVersion,
        tombstone: item.tombstone,
      }),
    drainQueue: () => send<OutboundItem[]>("drainQueue"),
    ackQueueItem: (id) => sendVoid("ackQueueItem", { id }),
    async close() {
      if (worker !== null) {
        await sendVoid("close");
        const closedErr = new Error("WebSqliteAdapter closed");
        for (const { reject } of pending.values()) reject(closedErr);
        pending.clear();
        worker.terminate();
        worker = null;
      }
      removePagehideHandler();
    },
    async destroy() {
      await sendVoid("destroy");
      const closedErr = new Error("WebSqliteAdapter closed");
      for (const { reject } of pending.values()) reject(closedErr);
      pending.clear();
      worker?.terminate();
      removePagehideHandler();
      worker = null;
    },
  };

  return { init, impl };
}
/* c8 ignore stop */

// ---------------------------------------------------------------------------
// WebSqliteAdapter, public class, delegates to one of the two impls above
// ---------------------------------------------------------------------------

export class WebSqliteAdapter implements LocalStore {
  readonly #workerUrl: string;
  readonly #dbFilename: string;
  readonly #injectedDb: TestDb | null;

  // Bound after init(). Null before init() or after close()/destroy().
  #impl: LocalStoreImpl | null = null;

  /**
   * @param options.workerUrl  - Absolute URL the host serves the worker at (web).
   * @param options.dbFilename - SAHPool database filename. Defaults to "/privance.sqlite3".
   * @param options.injectedDb - Synchronous Database for tests only; skips the Worker.
   */
  constructor(options: {
    workerUrl: string;
    dbFilename?: string;
    injectedDb?: TestDb | null;
  }) {
    this.#workerUrl = options.workerUrl;
    this.#dbFilename = options.dbFilename ?? "/privance.sqlite3";
    this.#injectedDb = options.injectedDb ?? null;
  }

  async init(): Promise<void> {
    if (this.#impl !== null) return; // idempotent

    if (this.#injectedDb !== null) {
      this.#injectedDb.exec(DDL);
      this.#impl = makeSyncImpl(this.#injectedDb);
      return;
    }

    /* c8 ignore next 3, worker path requires a browser (OPFS/Worker API) */
    const { init, impl } = makeWorkerImpl(this.#workerUrl, this.#dbFilename);
    await init();
    this.#impl = impl;
  }

  #assertImpl(): LocalStoreImpl {
    if (this.#impl === null) throw new StorageNotInitializedError();
    return this.#impl;
  }

  async put(input: PutObjectInput): Promise<void> {
    return this.#assertImpl().put(input);
  }

  async get(input: { kind: string; objectId: string }): Promise<StoredObject | null> {
    return this.#assertImpl().get(input);
  }

  async list(input: { kind: string }): Promise<StoredObject[]> {
    return this.#assertImpl().list(input);
  }

  async delete(input: { kind: string; objectId: string }): Promise<void> {
    return this.#assertImpl().delete(input);
  }

  async getCursor(): Promise<bigint | null> {
    return this.#assertImpl().getCursor();
  }

  async setCursor(seq: bigint): Promise<void> {
    return this.#assertImpl().setCursor(seq);
  }

  async enqueue(item: EnqueueInput): Promise<void> {
    return this.#assertImpl().enqueue(item);
  }

  async drainQueue(): Promise<OutboundItem[]> {
    return this.#assertImpl().drainQueue();
  }

  async ackQueueItem(id: string): Promise<void> {
    return this.#assertImpl().ackQueueItem(id);
  }

  async close(): Promise<void> {
    if (this.#impl !== null) {
      await this.#impl.close();
      this.#impl = null;
    }
  }

  async destroy(): Promise<void> {
    await this.#assertImpl().destroy();
    this.#impl = null;
  }
}
