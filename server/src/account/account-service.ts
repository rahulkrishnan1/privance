import { verifyAuthHash } from "../auth/kdf.js";
import { logger } from "../core/logger.js";
import type { AccountRepo } from "./repo.js";
import type { DestroyResult } from "./types.js";
import { InvalidPasswordError } from "./types.js";

export class AccountService {
  private readonly repo: AccountRepo;

  constructor(opts: { repo: AccountRepo }) {
    this.repo = opts.repo;
  }

  async destroy(opts: { userId: string; currentAuthHash: Buffer }): Promise<DestroyResult> {
    const storedHash = await this.repo.getUserAuthHashById({ userId: opts.userId });
    const ok =
      storedHash !== null &&
      (await verifyAuthHash({
        encoded: storedHash.toString("utf8"),
        authHash: opts.currentAuthHash,
      }));
    if (!ok) {
      throw new InvalidPasswordError();
    }

    await this.repo.destroyUser({ userId: opts.userId });

    // The user's audit_events rows are erased by destroyUser, so a destroy
    // audit record for that user is moot; log on the operational channel only.
    logger.info({ event: "account_destroyed", userId: opts.userId }, "account destroyed");

    return { userId: opts.userId };
  }
}
