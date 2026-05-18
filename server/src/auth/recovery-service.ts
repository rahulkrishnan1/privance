import { logger } from "../core/logger.js";
import {
  CLIENT_KDF_PARAMS,
  deriveFakeKdfSalt,
  deriveFakeRecoveryBlob,
  deriveFakeWrappedDekRecovery,
  hashAuthHash,
  verifyAuthHash,
} from "./kdf.js";
import type { AuthRepo } from "./repo.js";
import { SessionService } from "./session-service.js";
import type { KdfParamsJson, RecoveryResult } from "./types.js";
import { RecoveryFailedError } from "./types.js";

const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export class RecoveryService {
  private readonly sessionService: SessionService;

  constructor(
    private readonly repo: AuthRepo,
    private readonly enumerationSecret: Buffer,
  ) {
    this.sessionService = new SessionService(repo);
  }

  async getRecoveryParams(username: string): Promise<{
    kdfSalt: Buffer;
    kdfParams: KdfParamsJson;
    recoveryBlob: Buffer;
    recoverySalt: Buffer;
    recoveryParams: KdfParamsJson;
    wrappedDekRecovery: Buffer;
    wrappedDekRecoveryIv: Buffer;
  }> {
    const user = await this.repo.getUserByUsername(username);
    await this.repo.logEvent({
      userId: user?.userId ?? null,
      eventClass: "recovery_params_query",
    });

    if (user) {
      return {
        kdfSalt: user.kdfSalt,
        kdfParams: user.kdfParams,
        recoveryBlob: user.recoveryBlob,
        recoverySalt: user.recoverySalt,
        recoveryParams: user.recoveryParams,
        wrappedDekRecovery: user.wrappedDekRecovery,
        wrappedDekRecoveryIv: user.wrappedDekRecoveryIv,
      };
    }

    const fakeSalt = deriveFakeKdfSalt(username, this.enumerationSecret);
    const { wrappedBlob, blobIv } = deriveFakeRecoveryBlob(username, this.enumerationSecret);
    const { wrappedDekRecovery, wrappedDekRecoveryIv } = deriveFakeWrappedDekRecovery(
      username,
      this.enumerationSecret,
    );
    return {
      kdfSalt: fakeSalt,
      kdfParams: CLIENT_KDF_PARAMS,
      recoveryBlob: wrappedBlob,
      recoverySalt: blobIv,
      recoveryParams: CLIENT_KDF_PARAMS,
      wrappedDekRecovery,
      wrappedDekRecoveryIv,
    };
  }

  async recoveryReset(opts: {
    username: string;
    recoveryProof: Buffer;
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
  }): Promise<RecoveryResult> {
    const user = await this.repo.getUserByUsername(opts.username);

    if (!user) {
      await verifyAuthHash({ encoded: DUMMY_HASH, authHash: opts.recoveryProof });
      await this.repo.logEvent({ userId: null, eventClass: "recovery_fail_unknown_user" });
      throw new RecoveryFailedError();
    }

    const storedRecoveryHash = user.recoveryBlob.toString("utf8");
    const ok = await verifyAuthHash({
      encoded: storedRecoveryHash,
      authHash: opts.recoveryProof,
    });

    if (!ok) {
      await this.repo.logEvent({ userId: user.userId, eventClass: "recovery_fail_bad_proof" });
      throw new RecoveryFailedError();
    }

    const { hash: newAuthHashHash } = await hashAuthHash(opts.newAuthHash);
    // Hash the new recovery blob (recoveryAuthHash bytes from the client) with
    // argon2id before storing, mirrors the signup-service convention.
    const { hash: newRecoveryBlobHash } = await hashAuthHash(opts.newRecoveryBlob);

    await this.repo.updateUserCredentials({
      userId: user.userId,
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

    await this.repo.revokeAllUserSessions(user.userId);
    const { token, expiresAt } = await this.sessionService.createSession(user.userId);
    await this.repo.logEvent({ userId: user.userId, eventClass: "recovery_succeeded" });
    logger.info({ event: "recovery_succeeded", userId: user.userId }, "recovery reset completed");

    return { userId: user.userId, token, expiresAt };
  }
}
