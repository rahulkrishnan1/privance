import { logger } from "../core/logger.js";
import type { InviteService } from "./invite-service.js";
import { hashAuthHash as hashArgon2 } from "./kdf.js";
import type { AuthRepo } from "./repo.js";
import { SessionService } from "./session-service.js";
import type { KdfParamsJson, SignupResult } from "./types.js";
import { AllowlistDeniedError, UsernameTakenError } from "./types.js";

// PostgreSQL unique-constraint violation (SQLSTATE 23505).
// Drizzle wraps the raw DB error; the original PostgresError is attached as
// .cause and carries code "23505". Walk one level of cause chain to reach it.
function isUniqueConstraintError(err: unknown): boolean {
  const candidates = [err, (err as Record<string, unknown> | null)?.cause];
  for (const e of candidates) {
    if (e !== null && e !== undefined && typeof e === "object") {
      if ((e as Record<string, unknown>).code === "23505") return true;
    }
  }
  return false;
}

export class SignupService {
  private readonly sessionService: SessionService;
  private readonly inviteService: InviteService | undefined;
  private readonly inviteRequired: boolean;
  private readonly repo: AuthRepo;
  private readonly allowedUsernames: ReadonlySet<string>;

  constructor(opts: {
    repo: AuthRepo;
    allowedUsernames: ReadonlySet<string>;
    inviteService?: InviteService;
    inviteRequired?: boolean;
  }) {
    this.repo = opts.repo;
    this.allowedUsernames = opts.allowedUsernames;
    this.sessionService = new SessionService({ repo: opts.repo });
    this.inviteService = opts.inviteService;
    this.inviteRequired = opts.inviteRequired ?? false;
  }

  async signup(opts: {
    username: string;
    authHash: Buffer;
    kdfSalt: Buffer;
    kdfParams: KdfParamsJson;
    recoveryBlob: Buffer;
    recoverySalt: Buffer;
    recoveryParams: KdfParamsJson;
    wrappedDek: Buffer;
    wrappedDekIv: Buffer;
    wrappedDekRecovery: Buffer;
    wrappedDekRecoveryIv: Buffer;
    inviteToken?: string;
  }): Promise<SignupResult> {
    const username = opts.username.toLowerCase();

    // Invite gate runs before allowlist and Argon2id so reject is cheap.
    // Pre-allocate userId so the token claim records the consumer before the user row exists.
    let preAllocatedUserId: string | undefined;
    if (this.inviteRequired) {
      preAllocatedUserId = crypto.randomUUID();
      await this.inviteService?.validateAndClaim({
        token: opts.inviteToken,
        userId: preAllocatedUserId,
        now: new Date(),
      });
    }

    if (this.allowedUsernames.size > 0 && !this.allowedUsernames.has(username)) {
      await this.repo.logEvent({ userId: null, eventClass: "signup_blocked_allowlist" });
      throw new AllowlistDeniedError();
    }

    const { hash: authHashHash } = await hashArgon2(opts.authHash);
    // Hash the recovery blob (which is recoveryAuthHash bytes from the client) with
    // argon2id so we store a verifiable hash, not raw key material.
    const { hash: recoveryBlobHash } = await hashArgon2(opts.recoveryBlob);

    let user: Awaited<ReturnType<AuthRepo["createUser"]>>;
    try {
      user = await this.repo.createUser({
        ...(preAllocatedUserId !== undefined ? { userId: preAllocatedUserId } : {}),
        username,
        authHashHash: Buffer.from(authHashHash),
        kdfParams: opts.kdfParams,
        recoveryBlob: Buffer.from(recoveryBlobHash),
        recoverySalt: opts.recoverySalt,
        recoveryParams: opts.recoveryParams,
        wrappedDek: opts.wrappedDek,
        wrappedDekIv: opts.wrappedDekIv,
        wrappedDekRecovery: opts.wrappedDekRecovery,
        wrappedDekRecoveryIv: opts.wrappedDekRecoveryIv,
        kdfSalt: opts.kdfSalt,
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        await this.repo.logEvent({ userId: null, eventClass: "signup_fail_username_taken" });
        throw new UsernameTakenError();
      }
      throw err;
    }

    const { token, expiresAt } = await this.sessionService.createSession(user.userId);
    await this.repo.logEvent({ userId: user.userId, eventClass: "signup_succeeded" });
    logger.info({ event: "signup_succeeded", userId: user.userId }, "user signed up");

    return { userId: user.userId, token, expiresAt };
  }
}
