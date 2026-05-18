import { logger } from "../core/logger.js";
import { hashAuthHash } from "./kdf.js";
import type { AuthRepo } from "./repo.js";
import { SessionService } from "./session-service.js";
import type { AuthenticatedSession, KdfParamsJson, PasswordChangeResult } from "./types.js";

export class PasswordService {
  private readonly sessionService: SessionService;

  constructor(private readonly repo: AuthRepo) {
    this.sessionService = new SessionService(repo);
  }

  async changePassword(
    auth: AuthenticatedSession,
    opts: {
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
    const { hash: newAuthHashHash } = await hashAuthHash(opts.newAuthHash);
    // Hash the new recovery blob (recoveryAuthHash bytes from the client) with
    // argon2id before storing, mirrors the signup-service convention.
    const { hash: newRecoveryBlobHash } = await hashAuthHash(opts.newRecoveryBlob);

    await this.repo.updateUserCredentials({
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
    });

    await this.repo.revokeSession(auth.sessionId);
    const { token, expiresAt } = await this.sessionService.createSession(auth.userId);
    await this.repo.logEvent({ userId: auth.userId, eventClass: "password_changed" });
    logger.info({ event: "password_changed", userId: auth.userId }, "password changed");

    return { token, expiresAt };
  }
}
