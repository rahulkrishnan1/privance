import { logger } from "../core/logger.js";
import { decodeSessionToken, generateSessionToken, hashSessionToken } from "./kdf.js";
import type { AuthRepo } from "./repo.js";
import type { AuthenticatedSession } from "./types.js";
import { SESSION_LIFETIME_MS, SessionExpiredError, UnauthenticatedError } from "./types.js";

/** Refresh the session row only when more than this fraction of the original
 *  lifetime has elapsed. At 30 days / 0.75 that's a touch at most once every
 *  ~7.5 days, instead of every request. */
const SESSION_TOUCH_RATIO = 0.75;

export class SessionService {
  constructor(private readonly repo: AuthRepo) {}

  async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const { token, raw } = generateSessionToken();
    const tokenHash = hashSessionToken(raw);
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await this.repo.createSession({ userId, tokenHash, expiresAt });
    return { token, expiresAt };
  }

  async validateToken(token: string): Promise<AuthenticatedSession> {
    let raw: Buffer;
    try {
      raw = decodeSessionToken(token);
    } catch {
      throw new UnauthenticatedError("invalid token encoding");
    }
    if (raw.length !== 32) throw new UnauthenticatedError("invalid token length");

    const tokenHash = hashSessionToken(raw);
    const session = await this.repo.getSessionByTokenHash(tokenHash);
    if (!session) throw new UnauthenticatedError("session not found or revoked");
    if (session.expiresAt < new Date()) throw new SessionExpiredError();

    // Throttle expiry-extension writes. A polling client hits every endpoint
    // many times per minute; writing the sessions row on each one is pure
    // write amplification and serialises concurrent requests on the same row.
    // Only refresh when the remaining lifetime drops below the threshold.
    const remainingMs = session.expiresAt.getTime() - Date.now();
    const newExpiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    if (remainingMs < SESSION_LIFETIME_MS * SESSION_TOUCH_RATIO) {
      await this.repo.touchSession({ sessionId: session.sessionId, expiresAt: newExpiresAt });
      return { userId: session.userId, sessionId: session.sessionId, expiresAt: newExpiresAt };
    }
    return {
      userId: session.userId,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    };
  }

  async revokeSession(sessionId: string, userId: string): Promise<void> {
    await this.repo.revokeSession(sessionId);
    await this.repo.logEvent({ userId, eventClass: "logout" });
    logger.info({ event: "logout", userId }, "session revoked");
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.repo.revokeAllUserSessions(userId);
    await this.repo.logEvent({ userId, eventClass: "logout_all" });
    logger.info({ event: "logout_all", userId }, "all sessions revoked");
  }
}
