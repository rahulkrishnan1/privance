import type { AuditEventClass } from "@privance/core/audit-events";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Db, Tx } from "../core/db.js";
import { auditEvents, inviteTokens, sessions, users } from "./schema.js";
import type { KdfParamsJson } from "./types.js";

// Deletes every auth-owned row for a user within the caller's transaction. Owned
// by this module so account deletion never reaches across into auth's schema.
// Deleting `users` cascades to `sessions` (FK ON DELETE CASCADE); sessions and
// audit_events are deleted explicitly first so the order is correct regardless.
export async function purgeUserData(opts: { tx: Tx; userId: string }): Promise<void> {
  const { tx, userId } = opts;
  await tx.delete(auditEvents).where(eq(auditEvents.userId, userId));
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx.delete(users).where(eq(users.userId, userId));
}

export type UserRow = {
  userId: string;
  username: string;
  authHashHash: Buffer;
  kdfParams: KdfParamsJson;
  recoveryBlob: Buffer;
  recoverySalt: Buffer;
  recoveryParams: KdfParamsJson;
  wrappedDek: Buffer;
  wrappedDekIv: Buffer;
  wrappedDekRecovery: Buffer;
  wrappedDekRecoveryIv: Buffer;
  kdfSalt: Buffer;
};

export type SessionRow = {
  sessionId: string;
  userId: string;
  tokenHash: Buffer;
  expiresAt: Date;
  revokedAt: Date | null;
};

export class AuthRepo {
  constructor(private readonly db: Db) {}

  async getUserByUsername(username: string): Promise<UserRow | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.username, username.toLowerCase()))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.userId,
      username: row.username,
      authHashHash: row.authHashHash,
      kdfParams: row.kdfParams as KdfParamsJson,
      recoveryBlob: row.recoveryBlob,
      recoverySalt: row.recoverySalt,
      recoveryParams: row.recoveryParams as KdfParamsJson,
      wrappedDek: row.wrappedDek,
      wrappedDekIv: row.wrappedDekIv,
      wrappedDekRecovery: row.wrappedDekRecovery,
      wrappedDekRecoveryIv: row.wrappedDekRecoveryIv,
      kdfSalt: row.kdfSalt,
    };
  }

  async getUserAuthHashById(userId: string): Promise<Buffer | null> {
    const rows = await this.db
      .select({ authHashHash: users.authHashHash })
      .from(users)
      .where(eq(users.userId, userId))
      .limit(1);
    return rows[0]?.authHashHash ?? null;
  }

  async createUser(opts: {
    userId?: string;
    username: string;
    authHashHash: Buffer;
    kdfParams: KdfParamsJson;
    recoveryBlob: Buffer;
    recoverySalt: Buffer;
    recoveryParams: KdfParamsJson;
    wrappedDek: Buffer;
    wrappedDekIv: Buffer;
    wrappedDekRecovery: Buffer;
    wrappedDekRecoveryIv: Buffer;
    kdfSalt: Buffer;
  }): Promise<UserRow> {
    const rows = await this.db
      .insert(users)
      .values({
        ...(opts.userId !== undefined ? { userId: opts.userId } : {}),
        username: opts.username.toLowerCase(),
        authHashHash: opts.authHashHash,
        kdfParams: opts.kdfParams,
        recoveryBlob: opts.recoveryBlob,
        recoverySalt: opts.recoverySalt,
        recoveryParams: opts.recoveryParams,
        wrappedDek: opts.wrappedDek,
        wrappedDekIv: opts.wrappedDekIv,
        wrappedDekRecovery: opts.wrappedDekRecovery,
        wrappedDekRecoveryIv: opts.wrappedDekRecoveryIv,
        kdfSalt: opts.kdfSalt,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("insert returned no rows");
    return {
      userId: row.userId,
      username: row.username,
      authHashHash: row.authHashHash,
      kdfParams: row.kdfParams as KdfParamsJson,
      recoveryBlob: row.recoveryBlob,
      recoverySalt: row.recoverySalt,
      recoveryParams: row.recoveryParams as KdfParamsJson,
      wrappedDek: row.wrappedDek,
      wrappedDekIv: row.wrappedDekIv,
      wrappedDekRecovery: row.wrappedDekRecovery,
      wrappedDekRecoveryIv: row.wrappedDekRecoveryIv,
      kdfSalt: row.kdfSalt,
    };
  }

  async updateUserCredentials(opts: {
    userId: string;
    authHashHash: Buffer;
    kdfParams: KdfParamsJson;
    recoveryBlob: Buffer;
    recoverySalt: Buffer;
    recoveryParams: KdfParamsJson;
    wrappedDek: Buffer;
    wrappedDekIv: Buffer;
    wrappedDekRecovery: Buffer;
    wrappedDekRecoveryIv: Buffer;
    kdfSalt: Buffer;
  }): Promise<void> {
    await this.db
      .update(users)
      .set({
        authHashHash: opts.authHashHash,
        kdfParams: opts.kdfParams,
        recoveryBlob: opts.recoveryBlob,
        recoverySalt: opts.recoverySalt,
        recoveryParams: opts.recoveryParams,
        wrappedDek: opts.wrappedDek,
        wrappedDekIv: opts.wrappedDekIv,
        wrappedDekRecovery: opts.wrappedDekRecovery,
        wrappedDekRecoveryIv: opts.wrappedDekRecoveryIv,
        kdfSalt: opts.kdfSalt,
        updatedAt: new Date(),
      })
      .where(eq(users.userId, opts.userId));
  }

  // Rotates a user's credentials atomically: update the user row, revoke every
  // existing session, and insert the caller's new session in one transaction so
  // a failure mid-rotation can't leave updated credentials with a stale session
  // set. Returns the new session row.
  async rotateCredentials(opts: {
    credentials: Parameters<AuthRepo["updateUserCredentials"]>[0];
    newSession: { userId: string; tokenHash: Buffer; expiresAt: Date };
  }): Promise<SessionRow> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          authHashHash: opts.credentials.authHashHash,
          kdfParams: opts.credentials.kdfParams,
          recoveryBlob: opts.credentials.recoveryBlob,
          recoverySalt: opts.credentials.recoverySalt,
          recoveryParams: opts.credentials.recoveryParams,
          wrappedDek: opts.credentials.wrappedDek,
          wrappedDekIv: opts.credentials.wrappedDekIv,
          wrappedDekRecovery: opts.credentials.wrappedDekRecovery,
          wrappedDekRecoveryIv: opts.credentials.wrappedDekRecoveryIv,
          kdfSalt: opts.credentials.kdfSalt,
          updatedAt: new Date(),
        })
        .where(eq(users.userId, opts.credentials.userId));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, opts.newSession.userId), isNull(sessions.revokedAt)));
      const rows = await tx
        .insert(sessions)
        .values({
          userId: opts.newSession.userId,
          tokenHash: opts.newSession.tokenHash,
          expiresAt: opts.newSession.expiresAt,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error("insert returned no rows");
      return {
        sessionId: row.sessionId,
        userId: row.userId,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt ?? null,
      };
    });
  }

  async createSession(opts: {
    userId: string;
    tokenHash: Buffer;
    expiresAt: Date;
  }): Promise<SessionRow> {
    const rows = await this.db
      .insert(sessions)
      .values({
        userId: opts.userId,
        tokenHash: opts.tokenHash,
        expiresAt: opts.expiresAt,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("insert returned no rows");
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt ?? null,
    };
  }

  async getSessionByTokenHash(tokenHash: Buffer): Promise<SessionRow | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt ?? null,
    };
  }

  async touchSession(opts: { sessionId: string; expiresAt: Date }): Promise<void> {
    await this.db
      .update(sessions)
      .set({ expiresAt: opts.expiresAt })
      .where(eq(sessions.sessionId, opts.sessionId));
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.sessionId, sessionId), isNull(sessions.revokedAt)));
  }

  async createInviteToken(opts: {
    tokenHash: Buffer;
    createdBy: string;
    expiresAt?: Date | null;
  }): Promise<{ tokenId: string }> {
    const rows = await this.db
      .insert(inviteTokens)
      .values({
        tokenHash: opts.tokenHash,
        createdBy: opts.createdBy,
        expiresAt: opts.expiresAt ?? null,
      })
      .returning({ tokenId: inviteTokens.tokenId });
    const row = rows[0];
    if (!row) throw new Error("insert returned no rows");
    return { tokenId: row.tokenId };
  }

  async claimInviteToken(opts: {
    tokenHash: Buffer;
    userId: string;
    now: Date;
  }): Promise<{ tokenId: string } | null> {
    const rows = await this.db
      .update(inviteTokens)
      .set({ usedAt: opts.now, usedByUserId: opts.userId })
      .where(
        and(
          eq(inviteTokens.tokenHash, opts.tokenHash),
          isNull(inviteTokens.usedAt),
          or(isNull(inviteTokens.expiresAt), gt(inviteTokens.expiresAt, opts.now)),
        ),
      )
      .returning({ tokenId: inviteTokens.tokenId });
    return rows[0] ?? null;
  }

  async logEvent(opts: { userId: string | null; eventClass: AuditEventClass }): Promise<void> {
    await this.db.insert(auditEvents).values({
      userId: opts.userId ?? undefined,
      eventClass: opts.eventClass,
    });
  }

  async pruneOldAuditEvents(): Promise<void> {
    const cutoff = sql`now() - interval '90 days'`;
    await this.db.delete(auditEvents).where(lt(auditEvents.occurredAt, cutoff));
  }
}
