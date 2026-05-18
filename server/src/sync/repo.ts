import type { AuditEventClass } from "@privance/core/audit-events";
import { and, eq, gt, sql } from "drizzle-orm";

import type { Db } from "../core/db.js";
import { syncObjects } from "./schema.js";
import type {
  BatchDeleteItem,
  BatchPutItem,
  BatchResultItem,
  ChangeRecord,
  GetResult,
  PutResult,
  SyncObject,
} from "./types.js";
import { ConflictError, NotFoundError } from "./types.js";

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
    const { userId, objectId, kind, ciphertext, nonce, version, prevVersion } = opts;

    return await this.db.transaction(async (tx) => {
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
    });
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
    const { userId, objectId, prevVersion } = opts;

    return await this.db.transaction(async (tx) => {
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
    });
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

  async batchPut(userId: string, puts: BatchPutItem[]): Promise<BatchResultItem[]> {
    // Never throw mid-batch. A per-item error becomes a per-item failure
    // result so the client can ack the items that succeeded and retry only
    // the ones that didn't. Throwing here aborts the request, the client gets
    // a 500, and items earlier in the batch never get acked even though the
    // server side committed them.
    const results: BatchResultItem[] = [];
    for (const item of puts) {
      try {
        const result = await this.put({
          userId,
          objectId: item.objectId,
          kind: item.kind,
          ciphertext: item.ciphertext,
          nonce: item.nonce,
          version: item.version,
          ...(item.prevVersion !== undefined ? { prevVersion: item.prevVersion } : {}),
        });
        results.push({ id: item.objectId, ok: true, ...result });
      } catch (err) {
        if (err instanceof ConflictError) {
          results.push({
            id: item.objectId,
            ok: false,
            conflict: { currentVersion: err.currentVersion },
          });
        } else {
          results.push({
            id: item.objectId,
            ok: false,
            error: err instanceof Error ? err.message : "unknown error",
          });
        }
      }
    }
    return results;
  }

  async batchDelete(userId: string, deletes: BatchDeleteItem[]): Promise<BatchResultItem[]> {
    const results: BatchResultItem[] = [];
    for (const item of deletes) {
      try {
        const tombstoned = await this.delete({
          userId,
          objectId: item.objectId,
          prevVersion: item.prevVersion,
        });
        results.push({
          id: item.objectId,
          ok: true,
          serverSeq: tombstoned.serverSeq,
          version: tombstoned.version,
        });
      } catch (err) {
        if (err instanceof ConflictError) {
          results.push({
            id: item.objectId,
            ok: false,
            conflict: { currentVersion: err.currentVersion },
          });
        } else if (err instanceof NotFoundError) {
          results.push({ id: item.objectId, ok: false, conflict: { currentVersion: 0n } });
        } else {
          results.push({
            id: item.objectId,
            ok: false,
            error: err instanceof Error ? err.message : "unknown error",
          });
        }
      }
    }
    return results;
  }

  // Signature matches AuthRepo.logEvent so the audit channel stays uniform when
  // sync audit events are added (sync-service.ts has placeholder comments).
  async logEvent(_opts: { userId: string | null; eventClass: AuditEventClass }): Promise<void> {
    // No-op until sync audit events are wired.
  }
}

export type { SyncObject };
