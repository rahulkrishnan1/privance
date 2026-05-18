import { createHmac } from "node:crypto";

import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";

import type { FeatureRouter } from "../core/app.js";
import { db } from "../core/db.js";
import { logger } from "../core/logger.js";
import { isBreached as defaultIsBreached } from "./hibp.js";
import { LoginService } from "./login-service.js";
import { PasswordService } from "./password-service.js";
import * as rateLimit from "./rate-limit.js";
import { RecoveryService } from "./recovery-service.js";
import { AuthRepo } from "./repo.js";
import { SessionService } from "./session-service.js";
import { SignupService } from "./signup-service.js";
import type { AuthenticatedSession } from "./types.js";

// Overrideable in tests without module mocking, avoids polluting bun's module cache.
let _hibpChecker: (hex: string) => Promise<boolean | null> = defaultIsBreached;
export function _setHibpCheckerForTests(fn: (hex: string) => Promise<boolean | null>): void {
  _hibpChecker = fn;
  // Reset cached services so the next request picks up the new checker.
  _cachedServices = null;
}
export function _resetHibpChecker(): void {
  _hibpChecker = defaultIsBreached;
  _cachedServices = null;
}

import {
  AllowlistDeniedError,
  HibpUnavailableError,
  InvalidCredentialsError,
  RateLimitedError,
  RecoveryFailedError,
  SessionExpiredError,
  UnauthenticatedError,
  UsernameTakenError,
  WeakPasswordError,
} from "./types.js";

const SESSION_COOKIE = "privance_session";
const SECURE_COOKIE = process.env.NODE_ENV !== "test";

function getEnumerationSecret(): Buffer {
  const raw = process.env.ENUMERATION_SECRET;
  if (!raw || raw.length < 44) {
    throw new Error("ENUMERATION_SECRET env var must be set (min 32 bytes base64)");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length < 32) throw new Error("ENUMERATION_SECRET too short");
  return buf;
}

function getSignupAllowlist(): ReadonlySet<string> {
  const raw = process.env.SIGNUP_ALLOWLIST ?? "";
  if (!raw.trim()) return new Set<string>();
  return new Set(raw.split(",").map((u) => u.trim().toLowerCase()));
}

type AuthServices = {
  signup: SignupService;
  login: LoginService;
  session: SessionService;
  recovery: RecoveryService;
  password: PasswordService;
  repo: AuthRepo;
};

// Lazy singleton, built once on first request so startup failures (missing
// env vars) are visible at boot time in production (index.ts calls getServices()
// during startup) but are still overrideable in tests via mock.module hoisting.
let _cachedServices: AuthServices | null = null;

function getServices(): AuthServices {
  if (_cachedServices) return _cachedServices;
  const repo = new AuthRepo(db);
  const secret = getEnumerationSecret();
  const allowlist = getSignupAllowlist();
  _cachedServices = {
    signup: new SignupService(repo, allowlist, _hibpChecker),
    login: new LoginService(repo, secret),
    session: new SessionService(repo),
    recovery: new RecoveryService(repo, secret),
    password: new PasswordService(repo),
    repo,
  };
  return _cachedServices;
}

// Called at server startup (index.ts) to validate env vars fail fast.
export function initAuthServices(): void {
  getServices();
}

// For tests only, invalidates the cached services so env changes (e.g. SIGNUP_ALLOWLIST)
// take effect on the next request.
export function _resetCachedServicesForTests(): void {
  _cachedServices = null;
}

// Exposes the shared AuthRepo for maintenance tasks (e.g. audit log pruning).
export function getAuthRepo(): AuthRepo {
  return getServices().repo;
}

function parseB64Buf(value: unknown, field: string): Buffer {
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `missing_field: ${field}` });
  }
  try {
    return Buffer.from(value, "base64");
  } catch {
    throw new HTTPException(400, { message: `invalid_base64: ${field}` });
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new HTTPException(400, { message: `missing_field: ${field}` });
  }
  return value;
}

function parseKdfParams(value: unknown, field: string) {
  if (!value || typeof value !== "object") {
    throw new HTTPException(400, { message: `missing_field: ${field}` });
  }
  const v = value as Record<string, unknown>;

  function requireNum(camel: string, snake: string): number {
    const raw = v[camel] ?? v[snake];
    if (raw === undefined || raw === null) {
      throw new HTTPException(400, { message: `missing_kdf_field: ${field}.${camel}` });
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new HTTPException(400, { message: `invalid_kdf_field: ${field}.${camel}` });
    }
    return n;
  }

  return {
    memoryCost: requireNum("memoryCost", "memory_cost"),
    timeCost: requireNum("timeCost", "time_cost"),
    parallelism: requireNum("parallelism", "parallelism"),
    hashLength: requireNum("hashLength", "hash_length"),
  };
}

function hashIp(ip: string): string {
  // Use the same secret already validated by getEnumerationSecret() at request time.
  // Reading it here (lazily) avoids a module-init throw that would break index.test.ts.
  const raw = process.env.ENUMERATION_SECRET ?? "";
  const secret = Buffer.from(raw, "base64");
  return createHmac("sha256", secret).update(ip).digest("hex");
}

function errorToHttp(err: unknown): never {
  if (err instanceof RateLimitedError) {
    throw new HTTPException(429, { message: err.message });
  }
  if (err instanceof AllowlistDeniedError) {
    throw new HTTPException(403, { message: err.code });
  }
  if (err instanceof UsernameTakenError) {
    throw new HTTPException(409, { message: err.code });
  }
  if (err instanceof WeakPasswordError) {
    throw new HTTPException(422, { message: err.code });
  }
  if (err instanceof HibpUnavailableError) {
    throw new HTTPException(503, { message: err.code });
  }
  if (err instanceof InvalidCredentialsError) {
    throw new HTTPException(401, { message: err.code });
  }
  if (err instanceof RecoveryFailedError) {
    throw new HTTPException(401, { message: err.code });
  }
  if (err instanceof SessionExpiredError) {
    throw new HTTPException(401, { message: err.code });
  }
  if (err instanceof UnauthenticatedError) {
    throw new HTTPException(401, { message: err.code });
  }
  throw err;
}

function setSessionCookie(
  c: { header: (k: string, v: string) => void },
  token: string,
  expiresAt: Date,
): void {
  const expires = expiresAt.toUTCString();
  const secure = SECURE_COOKIE ? "; Secure" : "";
  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Expires=${expires}`,
  );
}

function clearSessionCookieHeader(c: { header: (k: string, v: string) => void }): void {
  const secure = SECURE_COOKIE ? "; Secure" : "";
  c.header("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`);
}

const router = new Hono();

router.post("/kdf-params", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const username = requireString(body.username, "username");
  const { session: _, login, ...__ } = getServices();
  try {
    const result = await login.getKdfParams(username);
    return c.json({
      kdf_algo: "argon2id",
      kdf_params: result.kdfParams,
      kdf_salt: result.kdfSalt.toString("base64"),
    });
  } catch (err) {
    errorToHttp(err);
  }
});

router.post("/signup", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const username = requireString(body.username, "username");
  const authHash = parseB64Buf(body.auth_hash, "auth_hash");
  const kdfSalt = parseB64Buf(body.kdf_salt, "kdf_salt");
  const kdfParams = parseKdfParams(body.kdf_params, "kdf_params");
  const recoveryBlob = parseB64Buf(body.recovery_blob, "recovery_blob");
  const recoverySalt = parseB64Buf(body.recovery_salt, "recovery_salt");
  const recoveryParams = parseKdfParams(body.recovery_params, "recovery_params");
  const wrappedDek = parseB64Buf(body.wrapped_dek, "wrapped_dek");
  const wrappedDekIv = parseB64Buf(body.wrapped_dek_iv, "wrapped_dek_iv");
  const wrappedDekRecovery = parseB64Buf(body.wrapped_dek_recovery, "wrapped_dek_recovery");
  const wrappedDekRecoveryIv = parseB64Buf(body.wrapped_dek_recovery_iv, "wrapped_dek_recovery_iv");

  const ip = hashIp(c.req.header("x-forwarded-for") ?? "unknown");

  try {
    rateLimit.gateSignup(ip);
  } catch (err) {
    errorToHttp(err);
  }

  const { signup } = getServices();
  try {
    const result = await signup.signup({
      username,
      authHash,
      kdfSalt,
      kdfParams,
      recoveryBlob,
      recoverySalt,
      recoveryParams,
      wrappedDek,
      wrappedDekIv,
      wrappedDekRecovery,
      wrappedDekRecoveryIv,
    });
    setSessionCookie(c, result.token, result.expiresAt);
    return c.json({ user_id: result.userId }, 201);
  } catch (err) {
    errorToHttp(err);
  }
});

router.post("/login", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const username = requireString(body.username, "username");
  const authHash = parseB64Buf(body.auth_hash, "auth_hash");

  const ip = hashIp(c.req.header("x-forwarded-for") ?? "unknown");

  try {
    await rateLimit.gateLogin(username, ip);
  } catch (err) {
    errorToHttp(err);
  }

  const { login } = getServices();
  try {
    const result = await login.login({ username, authHash });
    rateLimit.recordLoginSuccess(username);
    setSessionCookie(c, result.token, result.expiresAt);
    return c.json({
      user_id: result.userId,
      wrapped_dek: result.wrappedDek.toString("base64"),
      wrapped_dek_iv: result.wrappedDekIv.toString("base64"),
    });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      rateLimit.recordLoginFailure(username);
    }
    errorToHttp(err);
  }
});

router.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    throw new HTTPException(401, { message: "unauthenticated" });
  }
  const { session } = getServices();
  try {
    const auth = await session.validateToken(token);
    await session.revokeSession(auth.sessionId, auth.userId);
  } catch (err) {
    if (err instanceof UnauthenticatedError || err instanceof SessionExpiredError) {
      // Best-effort logout, clear cookie regardless
      logger.info({ event: "logout_stale_token" }, "logout with stale token");
    } else {
      errorToHttp(err);
    }
  }
  clearSessionCookieHeader(c);
  return c.json({ status: "ok" });
});

router.get("/session", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw new HTTPException(401, { message: "unauthenticated" });
  const { session } = getServices();
  try {
    const auth = await session.validateToken(token);
    return c.json({ user_id: auth.userId, expires_at: auth.expiresAt.toISOString() });
  } catch (err) {
    errorToHttp(err);
  }
});

router.post("/recovery/derive-params", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const username = requireString(body.username, "username");

  const { recovery } = getServices();
  try {
    const result = await recovery.getRecoveryParams(username);
    return c.json({
      kdf_algo: "argon2id",
      kdf_params: result.kdfParams,
      kdf_salt: result.kdfSalt.toString("base64"),
      recovery_blob: result.recoveryBlob.toString("base64"),
      recovery_salt: result.recoverySalt.toString("base64"),
      recovery_params: result.recoveryParams,
      wrapped_dek_recovery: result.wrappedDekRecovery.toString("base64"),
      wrapped_dek_recovery_iv: result.wrappedDekRecoveryIv.toString("base64"),
    });
  } catch (err) {
    errorToHttp(err);
  }
});

router.post("/recovery/reset", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const username = requireString(body.username, "username");
  const recoveryProof = parseB64Buf(body.recovery_proof, "recovery_proof");
  const newAuthHash = parseB64Buf(body.new_auth_hash, "new_auth_hash");
  const newKdfSalt = parseB64Buf(body.new_kdf_salt, "new_kdf_salt");
  const newKdfParams = parseKdfParams(body.new_kdf_params, "new_kdf_params");
  const newRecoveryBlob = parseB64Buf(body.new_recovery_blob, "new_recovery_blob");
  const newRecoverySalt = parseB64Buf(body.new_recovery_salt, "new_recovery_salt");
  const newRecoveryParams = parseKdfParams(body.new_recovery_params, "new_recovery_params");
  const newWrappedDek = parseB64Buf(body.new_wrapped_dek, "new_wrapped_dek");
  const newWrappedDekIv = parseB64Buf(body.new_wrapped_dek_iv, "new_wrapped_dek_iv");
  const newWrappedDekRecovery = parseB64Buf(
    body.new_wrapped_dek_recovery,
    "new_wrapped_dek_recovery",
  );
  const newWrappedDekRecoveryIv = parseB64Buf(
    body.new_wrapped_dek_recovery_iv,
    "new_wrapped_dek_recovery_iv",
  );

  const ip = hashIp(c.req.header("x-forwarded-for") ?? "unknown");

  try {
    await rateLimit.gateRecovery(username, ip);
  } catch (err) {
    errorToHttp(err);
  }

  const { recovery } = getServices();
  try {
    const result = await recovery.recoveryReset({
      username,
      recoveryProof,
      newAuthHash,
      newKdfSalt,
      newKdfParams,
      newRecoveryBlob,
      newRecoverySalt,
      newRecoveryParams,
      newWrappedDek,
      newWrappedDekIv,
      newWrappedDekRecovery,
      newWrappedDekRecoveryIv,
    });
    rateLimit.recordRecoverySuccess(username);
    setSessionCookie(c, result.token, result.expiresAt);
    return c.json({ user_id: result.userId });
  } catch (err) {
    if (err instanceof RecoveryFailedError) {
      rateLimit.recordRecoveryFailure(username);
    }
    errorToHttp(err);
  }
});

router.post("/password/change", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw new HTTPException(401, { message: "unauthenticated" });

  const body = await c.req.json<Record<string, unknown>>();
  const newAuthHash = parseB64Buf(body.new_auth_hash, "new_auth_hash");
  const newKdfSalt = parseB64Buf(body.new_kdf_salt, "new_kdf_salt");
  const newKdfParams = parseKdfParams(body.new_kdf_params, "new_kdf_params");
  const newRecoveryBlob = parseB64Buf(body.new_recovery_blob, "new_recovery_blob");
  const newRecoverySalt = parseB64Buf(body.new_recovery_salt, "new_recovery_salt");
  const newRecoveryParams = parseKdfParams(body.new_recovery_params, "new_recovery_params");
  const newWrappedDek = parseB64Buf(body.new_wrapped_dek, "new_wrapped_dek");
  const newWrappedDekIv = parseB64Buf(body.new_wrapped_dek_iv, "new_wrapped_dek_iv");
  const newWrappedDekRecovery = parseB64Buf(
    body.new_wrapped_dek_recovery,
    "new_wrapped_dek_recovery",
  );
  const newWrappedDekRecoveryIv = parseB64Buf(
    body.new_wrapped_dek_recovery_iv,
    "new_wrapped_dek_recovery_iv",
  );

  const { session, password } = getServices();
  let auth: AuthenticatedSession;
  try {
    auth = await session.validateToken(token);
  } catch (err) {
    errorToHttp(err);
  }

  try {
    const result = await password.changePassword(auth, {
      newAuthHash,
      newKdfSalt,
      newKdfParams,
      newRecoveryBlob,
      newRecoverySalt,
      newRecoveryParams,
      newWrappedDek,
      newWrappedDekIv,
      newWrappedDekRecovery,
      newWrappedDekRecoveryIv,
    });
    setSessionCookie(c, result.token, result.expiresAt);
    return c.json({});
  } catch (err) {
    errorToHttp(err);
  }
});

export const featureRouter: FeatureRouter = {
  basePath: "/api/auth",
  router,
};

export { SESSION_COOKIE };
