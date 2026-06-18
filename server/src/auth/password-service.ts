import { logger } from "../core/logger.js";
import { generateSessionToken, hashAuthHash, hashSessionToken, verifyAuthHash } from "./kdf.js";
import type { AuthRepo } from "./repo.js";
import type { AuthenticatedSession, KdfParamsJson, PasswordChangeResult } from "./types.js";
import { InvalidCredentialsError, SESSION_LIFETIME_MS } from "./types.js";

export class PasswordService {
  private readonly repo: AuthRepo;

  constructor(opts: { repo: AuthRepo }) {
    this.repo = opts.repo;
  }

  async changePassword(
    auth: AuthenticatedSession,
    opts: {
      currentAuthHash: Buffer;
      newAuthHash: Buffer;
      newKdfSalt: Buffer;
      newKdfParams: KdfParamsJson;
      newRecoveryBlob: Buffer;
      newRecoverySalt: Buffer;
      newRecoveryParams: KdfParamsJson;
      newWrappedDek: Buffer;
      newWrappedDekIv: Buffer;
      newWrappedDekRecovery: Buffer;
      newWrappedDekRecoveryIv: Buffer;
    },
  ): Promise<PasswordChangeResult> {
    const storedHash = await this.repo.getUserAuthHashById(auth.userId);
    const ok =
      storedHash !== null &&
      (await verifyAuthHash({
        encoded: storedHash.toString("utf8"),
        authHash: opts.currentAuthHash,
      }));
    if (!ok) {
      await this.repo.logEvent({ userId: auth.userId, eventClass: "login_fail_bad_hash" });
      throw new InvalidCredentialsError();
    }

    const { hash: newAuthHashHash } = await hashAuthHash(opts.newAuthHash);
    // Hash the new recovery blob (recoveryAuthHash bytes from the client) with
    // argon2id before storing, mirrors the signup-service convention.
    const { hash: newRecoveryBlobHash } = await hashAuthHash(opts.newRecoveryBlob);

    // Changing the password invalidates every existing session for the user;
    // credential update, revoke-all, and new-session insert run in one
    // transaction so a failure can't leave new credentials with live old
    // sessions (or no usable session at all).
    const { token, raw } = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await this.repo.rotateCredentials({
      credentials: {
        userId: auth.userId,
        authHashHash: Buffer.from(newAuthHashHash),
        kdfParams: opts.newKdfParams,
        recoveryBlob: Buffer.from(newRecoveryBlobHash),
        recoverySalt: opts.newRecoverySalt,
        recoveryParams: opts.newRecoveryParams,
        wrappedDek: opts.newWrappedDek,
        wrappedDekIv: opts.newWrappedDekIv,
        wrappedDekRecovery: opts.newWrappedDekRecovery,
        wrappedDekRecoveryIv: opts.newWrappedDekRecoveryIv,
        kdfSalt: opts.newKdfSalt,
      },
      newSession: { userId: auth.userId, tokenHash: hashSessionToken(raw), expiresAt },
    });
    await this.repo.logEvent({ userId: auth.userId, eventClass: "password_changed" });
    logger.info({ event: "password_changed", userId: auth.userId }, "password changed");

    return { token, expiresAt };
  }
}
