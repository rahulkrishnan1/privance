import { and, eq, gt, sql } from "drizzle-orm";

import type { Db, Tx } from "../core/db.js";
import { syncObjects } from "./schema.js";
import type {
  BatchDeleteItem,
  BatchInput,
  BatchPutItem,
  BatchResult,
  BatchResultItem,
  ChangeRecord,
  GetResult,
  PutResult,
} from "./types.js";
import { ConflictError, NotFoundError } from "./types.js";

// Deletes every sync row for a user within the caller's transaction. Owned by
// this module so account deletion never reaches across into sync's schema.
export async function purgeUserData(opts: { tx: Tx; userId: string }): Promise<void> {
  await opts.tx.delete(syncObjects).where(eq(syncObjects.userId, opts.userId));
}

export class SyncRepo {
  constructor(private readonly db: Db) {}

  async put(opts: {
    userId: string;
    objectId: string;
    kind: string;
    ciphertext: Buffer;
    nonce: Buffer;
    version: bigint;
    prevVersion?: bigint;
  }): Promise<PutResult> {
    return this.db.transaction((tx) => this.putTx(tx, opts));
  }

  private async putTx(
    tx: Tx,
    opts: {
      userId: string;
      objectId: string;
      kind: string;
      ciphertext: Buffer;
      nonce: Buffer;
      version: bigint;
      prevVersion?: bigint;
    },
  ): Promise<PutResult> {
    const { userId, objectId, kind, ciphertext, nonce, version, prevVersion } = opts;

    const existing = await tx
      .select({ version: syncObjects.version, tombstone: syncObjects.tombstone })
      .from(syncObjects)
      .where(and(eq(syncObjects.userId, userId), eq(syncObjects.objectId, objectId)))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0];
      if (row === undefined) throw new Error("unreachable");
      const expectedPrev = prevVersion ?? 0n;
      if (row.version !== expectedPrev) {
        throw new ConflictError(objectId, row.version);
      }
    } else if (prevVersion !== undefined && prevVersion !== 0n) {
      throw new ConflictError(objectId, 0n);
    }

    const inserted = await tx
      .insert(syncObjects)
      .values({ userId, objectId, kind, ciphertext, nonce, version, tombstone: false })
      .onConflictDoUpdate({
        target: [syncObjects.userId, syncObjects.objectId],
        set: {
          kind,
          ciphertext,
          nonce,
          version,
          tombstone: false,
          serverSeq: sql`nextval(pg_get_serial_sequence('sync_objects', 'server_seq'))`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ serverSeq: syncObjects.serverSeq, version: syncObjects.version });

    const result = inserted[0];
    if (!result) throw new Error("insert returned no rows");
    return { serverSeq: result.serverSeq, version: result.version };
  }

  async get(opts: { userId: string; objectId: string }): Promise<GetResult> {
    const { userId, objectId } = opts;
    const rows = await this.db
      .select()
      .from(syncObjects)
      .where(and(eq(syncObjects.userId, userId), eq(syncObjects.objectId, objectId)))
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundError(objectId);

    return {
      objectId: row.objectId,
      kind: row.kind,
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      version: row.version,
      serverSeq: row.serverSeq,
      tombstone: row.tombstone,
    };
  }

  async delete(opts: {
    userId: string;
    objectId: string;
    prevVersion: bigint;
  }): Promise<{ serverSeq: bigint; version: bigint }> {
    return this.db.transaction((tx) => this.deleteTx(tx, opts));
  }

  private async deleteTx(
    tx: Tx,
    opts: { userId: string; objectId: string; prevVersion: bigint },
  ): Promise<{ serverSeq: bigint; version: bigint }> {
    const { userId, objectId, prevVersion } = opts;

    const existing = await tx
      .select({ version: syncObjects.version })
      .from(syncObjects)
      .where(and(eq(syncObjects.userId, userId), eq(syncObjects.objectId, objectId)))
      .limit(1);

    if (existing.length === 0) throw new NotFoundError(objectId);

    const row = existing[0];
    if (row === undefined) throw new Error("unreachable");
    if (row.version !== prevVersion) {
      throw new ConflictError(objectId, row.version);
    }

    const updated = await tx
      .update(syncObjects)
      .set({
        tombstone: true,
        serverSeq: sql`nextval(pg_get_serial_sequence('sync_objects', 'server_seq'))`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(syncObjects.userId, userId), eq(syncObjects.objectId, objectId)))
      .returning({ serverSeq: syncObjects.serverSeq, version: syncObjects.version });

    const newRow = updated[0];
    if (newRow === undefined) throw new Error("unreachable");
    return { serverSeq: newRow.serverSeq, version: newRow.version };
  }

  async changes(opts: {
    userId: string;
    since: bigint;
    limit: number;
  }): Promise<{ changes: ChangeRecord[]; next: bigint | null }> {
    const { userId, since, limit } = opts;

    const rows = await this.db
      .select()
      .from(syncObjects)
      .where(and(eq(syncObjects.userId, userId), gt(syncObjects.serverSeq, since)))
      .orderBy(syncObjects.serverSeq)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;

    const changes: ChangeRecord[] = slice.map((row) => ({
      id: row.objectId,
      kind: row.kind,
      version: row.version,
      serverSeq: row.serverSeq,
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      tombstone: row.tombstone,
    }));

    const last = slice[slice.length - 1];
    const next = hasMore && last ? last.serverSeq : null;

    return { changes, next };
  }

  // Applies every put and delete in a single transaction. Per-item conflicts
  // (ConflictError) and missing-on-delete (NotFoundError) are expected outcomes:
  // they're collected as per-item failures and do NOT roll back. Any other error
  // is infrastructure-level and propagates out, rolling back the whole batch so
  // the client never acks items whose siblings were lost.
  async batch(opts: BatchInput): Promise<BatchResult> {
    const { userId, puts, deletes } = opts;
    return this.db.transaction(async (tx) => {
      const results: BatchResultItem[] = [];
      for (const item of puts) {
        results.push(await this.batchPut({ tx, userId, item }));
      }
      for (const item of deletes) {
        results.push(await this.batchDelete({ tx, userId, item }));
      }
      return { results };
    });
  }

  private async batchPut(opts: {
    tx: Tx;
    userId: string;
    item: BatchPutItem;
  }): Promise<BatchResultItem> {
    const { tx, userId, item } = opts;
    try {
      const result = await this.putTx(tx, {
        userId,
        objectId: item.objectId,
        kind: item.kind,
        ciphertext: item.ciphertext,
        nonce: item.nonce,
        version: item.version,
        ...(item.prevVersion !== undefined ? { prevVersion: item.prevVersion } : {}),
      });
      return { id: item.objectId, ok: true, ...result };
    } catch (err) {
      if (err instanceof ConflictError) {
        return { id: item.objectId, ok: false, conflict: { currentVersion: err.currentVersion } };
      }
      throw err;
    }
  }

  private async batchDelete(opts: {
    tx: Tx;
    userId: string;
    item: BatchDeleteItem;
  }): Promise<BatchResultItem> {
    const { tx, userId, item } = opts;
    try {
      const tombstoned = await this.deleteTx(tx, {
        userId,
        objectId: item.objectId,
        prevVersion: item.prevVersion,
      });
      return {
        id: item.objectId,
        ok: true,
        serverSeq: tombstoned.serverSeq,
        version: tombstoned.version,
      };
    } catch (err) {
      if (err instanceof ConflictError) {
        return { id: item.objectId, ok: false, conflict: { currentVersion: err.currentVersion } };
      }
      if (err instanceof NotFoundError) {
        return { id: item.objectId, ok: false, conflict: { currentVersion: 0n } };
      }
      throw err;
    }
  }
}
