import { hashInviteToken } from "./kdf.js";
import type { AuthRepo } from "./repo.js";
import { InvalidInviteError } from "./types.js";

export class InviteService {
  constructor(private readonly repo: AuthRepo) {}

  async validateAndClaim(opts: {
    token: string | undefined;
    userId: string;
    now?: Date;
  }): Promise<void> {
    const now = opts.now ?? new Date();

    // Missing/malformed tokens fall through to a zero buffer so the hash + DB
    // round-trip still fires (matched-latency parity).
    let buf: Buffer;
    let tokenWasProvided: boolean;
    if (!opts.token) {
      buf = Buffer.alloc(32);
      tokenWasProvided = false;
    } else {
      tokenWasProvided = true;
      try {
        const padded = opts.token + "=".repeat(-opts.token.length & 3);
        const decoded = Buffer.from(padded, "base64url");
        if (decoded.length !== 32) {
          buf = Buffer.alloc(32);
        } else {
          buf = decoded;
        }
      } catch {
        buf = Buffer.alloc(32);
      }
    }

    const tokenHash = hashInviteToken(buf);
    const result = await this.repo.claimInviteToken({ tokenHash, userId: opts.userId, now });

    if (result === null) {
      const eventClass = tokenWasProvided
        ? "signup_fail_invite_invalid"
        : "signup_fail_invite_required";
      await this.repo.logEvent({ userId: null, eventClass });
      throw new InvalidInviteError();
    }
  }
}
