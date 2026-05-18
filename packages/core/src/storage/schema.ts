/**
 * SQL DDL for the local SQLite database.
 *
 * Column layout mirrors server/src/sync/schema.ts (sync_objects) so the sync
 * client can round-trip ciphertext envelopes without transformation.
 *
 * All values are stored as blobs/integers. The storage layer never interprets
 * ciphertext or nonce bytes.
 */

export const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sync_objects (
  kind        TEXT    NOT NULL,
  object_id   TEXT    NOT NULL,
  ciphertext  BLOB    NOT NULL,
  nonce       BLOB    NOT NULL,
  version     INTEGER NOT NULL,
  server_seq  INTEGER,               -- NULL until server confirms
  tombstone   INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,      -- Unix epoch milliseconds
  PRIMARY KEY (kind, object_id)
);

CREATE INDEX IF NOT EXISTS sync_objects_kind_idx
  ON sync_objects (kind, object_id);

-- Cursor table: one row with key='server_seq', value=<bigint as text>
CREATE TABLE IF NOT EXISTS sync_cursor (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Outbound queue for pending pushes not yet confirmed by the server
CREATE TABLE IF NOT EXISTS outbound_queue (
  id           TEXT    PRIMARY KEY,
  kind         TEXT    NOT NULL,
  object_id    TEXT    NOT NULL,
  ciphertext   BLOB    NOT NULL,
  nonce        BLOB    NOT NULL,
  version      INTEGER NOT NULL,
  prev_version INTEGER,              -- NULL for brand-new objects
  tombstone    INTEGER NOT NULL DEFAULT 0,
  enqueued_at  INTEGER NOT NULL      -- Unix epoch milliseconds
);

CREATE INDEX IF NOT EXISTS outbound_queue_enqueued_idx
  ON outbound_queue (enqueued_at ASC);
`;

export const CURSOR_KEY = "server_seq";
