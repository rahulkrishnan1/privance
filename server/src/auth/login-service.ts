import { logger } from "../core/logger.js";
import { CLIENT_KDF_PARAMS, deriveFakeKdfSalt, verifyAuthHash } from "./kdf.js";
import type { AuthRepo } from "./repo.js";
import { SessionService } from "./session-service.js";
import type { KdfParamsJson, LoginResult } from "./types.js";
import { InvalidCredentialsError } from "./types.js";

const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export class LoginService {
  private readonly repo: AuthRepo;
  private readonly enumerationSecret: Buffer;
  private readonly sessionService: SessionService;

  constructor(opts: { repo: AuthRepo; enumerationSecret: Buffer }) {
    this.repo = opts.repo;
    this.enumerationSecret = opts.enumerationSecret;
    this.sessionService = new SessionService({ repo: opts.repo });
  }

  async getKdfParams(username: string): Promise<{
    kdfSalt: Buffer;
    kdfParams: KdfParamsJson;
  }> {
    const user = await this.repo.getUserByUsername(username);
    await this.repo.logEvent({
      userId: user?.userId ?? null,
      eventClass: "kdf_params_query",
    });

    if (user) {
      return { kdfSalt: user.kdfSalt, kdfParams: user.kdfParams };
    }

    const fakeSalt = deriveFakeKdfSalt(username, this.enumerationSecret);
    return {
      kdfSalt: fakeSalt,
      kdfParams: CLIENT_KDF_PARAMS,
    };
  }

  async login(opts: { username: string; authHash: Buffer }): Promise<LoginResult> {
    const user = await this.repo.getUserByUsername(opts.username);

    if (!user) {
      await verifyAuthHash({ encoded: DUMMY_HASH, authHash: opts.authHash });
      await this.repo.logEvent({ userId: null, eventClass: "login_fail_unknown_user" });
      throw new InvalidCredentialsError();
    }

    const storedHash = user.authHashHash.toString("utf8");
    const ok = await verifyAuthHash({ encoded: storedHash, authHash: opts.authHash });

    if (!ok) {
      await this.repo.logEvent({ userId: user.userId, eventClass: "login_fail_bad_hash" });
      throw new InvalidCredentialsError();
    }

    const { token, expiresAt } = await this.sessionService.createSession(user.userId);
    await this.repo.logEvent({ userId: user.userId, eventClass: "login_succeeded" });
    logger.info({ event: "login_succeeded", userId: user.userId }, "user logged in");

    return {
      userId: user.userId,
      token,
      expiresAt,
      wrappedDek: user.wrappedDek,
      wrappedDekIv: user.wrappedDekIv,
    };
  }
}
