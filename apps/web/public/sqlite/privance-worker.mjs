/**
 * Privance SQLite worker — served as a static asset and loaded via
 * `new Worker(url, { type: "module" })`. The Worker runtime resolves the
 * relative import below against this file's own URL, bypassing the bundler
 * entirely.
 *
 * All SQLite I/O runs here because FileSystemFileHandle.createSyncAccessHandle
 * is only available inside a Worker (Chrome/Firefox).
 *
 * Wire protocol:
 *   host → worker:  { id: string, method: string, args?: object }
 *   worker → host:  { id: string, ok: true, result: unknown }
 *                 | { id: string, ok: false, error: string }
 *   worker → host (startup): { ready: true }
 */

import sqlite3InitModule from "./index.mjs";

const CURSOR_KEY = "server_seq";

let sqlite3 = null;
let pool = null;
let db = null;
let dbFilename = "/privance.sqlite3";
let legacyUnlinkAttempted = false;

// ---------------------------------------------------------------------------
// Startup: install the SAHPool VFS, then signal readiness.
// ---------------------------------------------------------------------------

// Retry while a prior worker still holds the pool's access handles (release on
// terminate is async). forceReinitIfPreviouslyFailed is required: install
// caches its rejected promise, so without it retries re-throw the first failure
// instead of re-attempting. Jittered so two contexts don't retry in lockstep.
async function installVfsWithRetry({ attempts = 14, baseDelayMs = 50, maxDelayMs = 1000 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      // Per-user OPFS scoping means each signup needs its own slot (plus a
      // journal); the default of 6 only fits ~3 users on a shared browser
      // before new signups fail with "SAH pool is full".
      return await sqlite3.installOpfsSAHPoolVfs({
        initialCapacity: 16,
        forceReinitIfPreviouslyFailed: true,
      });
    } catch (e) {
      lastErr = e;
      if (!/access handle/i.test(e?.message ?? String(e))) throw e;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** i) + Math.random() * baseDelayMs;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr ?? new Error("installOpfsSAHPoolVfs exhausted retries");
}

// Serialize installs across the origin's workers: install grabs a handle on
// every pool file at once, so two concurrent installs (StrictMode double-mount,
// overlapping reload) both fail and thrash. The lock is released as soon as
// install resolves, so a second tab is never blocked. No Web Locks: install
// directly and rely on the retry above.
function installVfsSerialized() {
  if (typeof navigator !== "undefined" && navigator.locks?.request !== undefined) {
    return navigator.locks.request("privance-opfs-install", { mode: "exclusive" }, () =>
      installVfsWithRetry(),
    );
  }
  return installVfsWithRetry();
}

// OPFS is unavailable on Safari Private Browsing and some restricted WKWebView
// hosts; fall back to an in-memory DB so the app still functions per-tab. The
// sync client re-populates from the server's ciphertext each session.
try {
  sqlite3 = await sqlite3InitModule();
  try {
    pool = await installVfsSerialized();
  } catch {
    pool = null;
  }
  self.postMessage({ ready: true, mode: pool !== null ? "opfs" : "memory" });
} catch (e) {
  self.postMessage({ ready: false, error: e?.message ?? String(e) });
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function randomId() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function rowToStoredObject(row) {
  return {
    kind: row.kind,
    objectId: row.object_id,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    version: BigInt(row.version),
    serverSeq: row.server_seq != null ? BigInt(row.server_seq) : null,
    tombstone: row.tombstone !== 0,
    updatedAt: Number(row.updated_at),
  };
}

function rowToOutboundItem(row) {
  return {
    id: row.id,
    kind: row.kind,
    objectId: row.object_id,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    version: BigInt(row.version),
    prevVersion: row.prev_version != null ? BigInt(row.prev_version) : undefined,
    tombstone: row.tombstone !== 0,
    enqueuedAt: Number(row.enqueued_at),
  };
}

function assertOpen() {
  if (db === null) {
    throw new Error("database not initialised — call init first");
  }
  return db;
}

// ---------------------------------------------------------------------------
// Method implementations
// ---------------------------------------------------------------------------

async function openDbWithRetry({ attempts = 14, baseDelayMs = 50, maxDelayMs = 1000 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return new pool.OpfsSAHPoolDb(dbFilename);
    } catch (e) {
      lastErr = e;
      if (!/access handle/i.test(e?.message ?? String(e))) throw e;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** i) + Math.random() * baseDelayMs;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr ?? new Error("OpfsSAHPoolDb exhausted retries");
}

async function methodInit({ dbFilename: filename, ddl }) {
  if (db !== null) return null;
  if (filename) dbFilename = filename;
  // Legacy /privance.sqlite3 from before per-user scoping; unlinked once
  // when the current session uses a per-user filename. If the current
  // dbFilename IS /privance.sqlite3 (e.g. E2E tests or an unknown userId),
  // skip: deleting the file we are about to open destroys in-flight data.
  if (pool !== null && !legacyUnlinkAttempted && dbFilename !== "/privance.sqlite3") {
    legacyUnlinkAttempted = true;
    try {
      pool.unlink("/privance.sqlite3");
    } catch {
      // best-effort; the file may not exist or unlink may be unsupported
    }
  }
  db = pool !== null ? await openDbWithRetry() : new sqlite3.oo1.DB(":memory:");
  db.exec(ddl);
  return null;
}

function writeObject(d, { kind, objectId, ciphertext, nonce, version, serverSeq, tombstone, updatedAt }) {
  const now = updatedAt ?? Date.now();
  const seq = serverSeq ?? null;
  const tomb = tombstone ?? false;

  d.exec({
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
    bind: [kind, objectId, ciphertext, nonce, version, seq, tomb ? 1 : 0, now],
  });
}

function methodPut(input) {
  const d = assertOpen();
  d.transaction(() => writeObject(d, input));
  return null;
}

function methodPutAndEnqueue(input) {
  const d = assertOpen();
  const id = input.id ?? randomId();
  d.transaction(() => {
    writeObject(d, { ...input, serverSeq: null, updatedAt: Date.now() });
    insertQueueItem(d, { ...input, id });
  });
  return id;
}

function methodApplyRemote(input) {
  const d = assertOpen();
  let applied = false;
  d.transaction(() => {
    const pending = d.exec({
      sql: "SELECT 1 FROM outbound_queue WHERE object_id = ? LIMIT 1",
      bind: [input.objectId],
      returnValue: "resultRows",
      rowMode: "object",
    });
    if (pending.length === 0) {
      writeObject(d, input);
      applied = true;
    }
  });
  return applied;
}

function methodGet({ kind, objectId }) {
  const d = assertOpen();
  const rows = d.exec({
    sql: `
      SELECT kind, object_id, ciphertext, nonce, version, server_seq, tombstone, updated_at
      FROM sync_objects
      WHERE kind = ? AND object_id = ?
    `,
    bind: [kind, objectId],
    returnValue: "resultRows",
    rowMode: "object",
  });
  const row = rows[0];
  return row !== undefined ? rowToStoredObject(row) : null;
}

function methodList({ kind }) {
  const d = assertOpen();
  const rows = d.exec({
    sql: `
      SELECT kind, object_id, ciphertext, nonce, version, server_seq, tombstone, updated_at
      FROM sync_objects
      WHERE kind = ?
      ORDER BY object_id ASC
    `,
    bind: [kind],
    returnValue: "resultRows",
    rowMode: "object",
  });
  return rows.map(rowToStoredObject);
}

function methodDelete({ kind, objectId }) {
  const d = assertOpen();
  d.exec({ sql: `DELETE FROM sync_objects WHERE kind = ? AND object_id = ?`, bind: [kind, objectId] });
  return null;
}

function methodGetCursor() {
  const d = assertOpen();
  const rows = d.exec({
    sql: `SELECT value FROM sync_cursor WHERE key = ?`,
    bind: [CURSOR_KEY],
    returnValue: "resultRows",
    rowMode: "object",
  });
  const row = rows[0];
  return row?.value != null ? BigInt(row.value) : null;
}

function methodSetCursor({ seq }) {
  const d = assertOpen();
  d.exec({
    sql: `
      INSERT INTO sync_cursor (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `,
    bind: [CURSOR_KEY, seq.toString()],
  });
  return null;
}

function insertQueueItem(d, { id, kind, objectId, ciphertext, nonce, version, prevVersion, tombstone }) {
  const itemId = id ?? randomId();
  const now = Date.now();
  const prev = prevVersion != null ? prevVersion : null;

  d.exec({
    sql: `
      INSERT INTO outbound_queue
        (id, kind, object_id, ciphertext, nonce, version, prev_version, tombstone, enqueued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    bind: [itemId, kind, objectId, ciphertext, nonce, version, prev, tombstone ? 1 : 0, now],
  });
}

function methodEnqueue(input) {
  const d = assertOpen();
  d.transaction(() => insertQueueItem(d, input));
  return null;
}

function methodDrainQueue() {
  const d = assertOpen();
  const rows = d.exec({
    sql: `
      SELECT id, kind, object_id, ciphertext, nonce, version, prev_version, tombstone, enqueued_at
      FROM outbound_queue
      ORDER BY enqueued_at ASC, rowid ASC
    `,
    returnValue: "resultRows",
    rowMode: "object",
  });
  return rows.map(rowToOutboundItem);
}

function methodAckQueueItem({ id, confirmed, replacement }) {
  const d = assertOpen();
  d.transaction(() => {
    if (replacement !== undefined) {
      const [captured] = d.exec({
        sql: "SELECT kind, object_id FROM outbound_queue WHERE id = ?",
        bind: [id],
        returnValue: "resultRows",
        rowMode: "object",
      });
      if (captured === undefined) return;
      if (captured.kind !== replacement.kind || captured.object_id !== replacement.objectId)
        throw new Error("Replacement must match the captured queue object's kind and ID");
    }
    if (confirmed !== undefined) {
      d.exec({
        sql: `
          UPDATE sync_objects SET version = ?, server_seq = ?
          WHERE server_seq IS NULL AND EXISTS (
            SELECT 1 FROM outbound_queue AS q
            WHERE q.id = ? AND q.kind = sync_objects.kind
              AND q.object_id = sync_objects.object_id
              AND q.ciphertext = sync_objects.ciphertext
              AND q.nonce = sync_objects.nonce
              AND q.version = sync_objects.version
              AND q.tombstone = sync_objects.tombstone
              AND NOT EXISTS (
                SELECT 1 FROM outbound_queue AS newer
                WHERE newer.object_id = q.object_id AND newer.rowid > q.rowid
              )
          )
        `,
        bind: [confirmed.version, confirmed.serverSeq, id],
      });
    }
    d.exec({ sql: `DELETE FROM outbound_queue WHERE id = ?`, bind: [id] });
    if (replacement !== undefined) {
      const pending = d.exec({
        sql: "SELECT 1 FROM outbound_queue WHERE object_id = ? LIMIT 1",
        bind: [replacement.objectId],
        returnValue: "resultRows",
        rowMode: "object",
      });
      if (pending.length === 0) writeObject(d, replacement);
    }
  });
  return null;
}

// Release the pool's access handles now instead of waiting on async release at
// worker terminate, so the next worker can acquire them without a race. Runs
// only after the DB is closed: pauseVfs() throws if a handle is still open.
function releasePool() {
  if (pool === null) return;
  try {
    pool.pauseVfs();
  } catch {
    // A handle was still open; fall back to async release on worker terminate.
  }
}

function methodClose() {
  if (db !== null) db.close();
  db = null;
  releasePool();
  return null;
}

function methodDestroy() {
  const d = assertOpen();
  d.transaction(() => {
    d.exec("DELETE FROM sync_objects");
    d.exec("DELETE FROM sync_cursor");
    d.exec("DELETE FROM outbound_queue");
  });
  d.close();
  db = null;
  if (pool !== null) pool.unlink(dbFilename);
  releasePool();
  return null;
}

const DISPATCH = {
  init: methodInit,
  put: methodPut,
  putAndEnqueue: methodPutAndEnqueue,
  applyRemote: methodApplyRemote,
  get: methodGet,
  list: methodList,
  delete: methodDelete,
  getCursor: methodGetCursor,
  setCursor: methodSetCursor,
  enqueue: methodEnqueue,
  drainQueue: methodDrainQueue,
  ackQueueItem: methodAckQueueItem,
  close: methodClose,
  destroy: methodDestroy,
};

// ---------------------------------------------------------------------------
// Message loop
// ---------------------------------------------------------------------------

self.addEventListener("message", async (event) => {
  const { id, method, args } = event.data;
  const handler = DISPATCH[method];

  if (!handler) {
    self.postMessage({ id, ok: false, error: `unknown method: ${method}` });
    return;
  }

  try {
    const result = await handler(args ?? {});
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ id, ok: false, error: message });
  }
});
