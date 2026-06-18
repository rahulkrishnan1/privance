import { createHmac } from "node:crypto";

import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";

import type { FeatureRouter } from "../core/app.js";
import { db } from "../core/db.js";
import { parseB64Buf, requireString } from "../core/wire-parse.js";
import { InviteService } from "./invite-service.js";
import { LoginService } from "./login-service.js";
import { PasswordService } from "./password-service.js";
import * as rateLimit from "./rate-limit.js";
import { RecoveryService } from "./recovery-service.js";
import { AuthRepo } from "./repo.js";
import { SessionService } from "./session-service.js";
import { SignupService } from "./signup-service.js";
import type { AuthenticatedSession } from "./types.js";

import {
  AllowlistDeniedError,
  InvalidCredentialsError,
  InvalidInviteError,
  RateLimitedError,
  RecoveryFailedError,
  SessionExpiredError,
  UnauthenticatedError,
  UsernameTakenError,
} from "./types.js";

const SESSION_COOKIE = "privance_session";
const SECURE_COOKIE = process.env.NODE_ENV !== "test";

let _enumerationSecret: Buffer | null = null;

// Decode + length-validate ENUMERATION_SECRET once, then reuse the buffer. Used
// for fake-KDF salt derivation and IP hashing; both run per request, so we
// avoid re-decoding base64 (and skipping the length check) on every call.
function getEnumerationSecret(): Buffer {
  if (_enumerationSecret) return _enumerationSecret;
  const raw = process.env.ENUMERATION_SECRET;
  if (!raw || raw.length < 44) {
    throw new Error("ENUMERATION_SECRET env var must be set (min 32 bytes base64)");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length < 32) throw new Error("ENUMERATION_SECRET too short");
  _enumerationSecret = buf;
  return buf;
}

// Number of trusted reverse-proxy hops in front of this server. The rightmost
// XFF entry is set by the nearest trusted proxy; entries further left are
// client-supplied and spoofable. Default 1 = a single self-hosted reverse proxy
// (nginx/Caddy/Traefik). Set to the real hop count if you chain more proxies,
// or 0 if the app is internet-facing with no proxy (then XFF is ignored).
// SECURITY: this server MUST sit behind exactly this many trusted proxies, or
// an attacker can forge their rate-limit identity.
const TRUSTED_PROXY_HOPS = Math.max(0, Number(process.env.TRUSTED_PROXY_HOPS ?? 1) || 0);

// Picks the client IP from X-Forwarded-For, counting TRUSTED_PROXY_HOPS from the
// right. Everything left of the trusted hops is attacker-controlled and ignored.
function clientIpFromXff(xff: string | undefined): string {
  if (!xff || TRUSTED_PROXY_HOPS === 0) return "unknown";
  const parts = xff
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const idx = parts.length - TRUSTED_PROXY_HOPS;
  return parts[idx] ?? "unknown";
}

function getSignupAllowlist(): ReadonlySet<string> {
  const raw = process.env.SIGNUP_ALLOWLIST ?? "";
  if (!raw.trim()) return new Set<string>();
  return new Set(raw.split(",").map((u) => u.trim().toLowerCase()));
}

function getInviteRequired(): boolean {
  return process.env.INVITE_REQUIRED === "true";
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
  const inviteService = new InviteService({ repo });
  _cachedServices = {
    signup: new SignupService({
      repo,
      allowedUsernames: allowlist,
      inviteService,
      inviteRequired: getInviteRequired(),
    }),
    login: new LoginService({ repo, enumerationSecret: secret }),
    session: new SessionService({ repo }),
    recovery: new RecoveryService({ repo, enumerationSecret: secret }),
    password: new PasswordService({ repo }),
    repo,
  };
  return _cachedServices;
}

export function initAuthServices(): void {
  getServices();
}

// For tests only, invalidates the cached services so env changes (e.g. SIGNUP_ALLOWLIST)
// take effect on the next request.
export function _resetCachedServicesForTests(): void {
  _cachedServices = null;
}

export function getAuthRepo(): AuthRepo {
  return getServices().repo;
}

// Fixed crypto field sizes (bytes), matching @privance/core's client output:
// auth hashes/recovery proofs = AUTH_HASH_BYTES, salts = SALT_BYTES, AES-GCM
// nonces = NONCE_BYTES, wrapped DEK = 32-byte key + 16-byte GCM tag.
const AUTH_HASH_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const WRAPPED_DEK_LEN = 48;

// Argon2id parameter bounds. The client's standard params (m=64MiB, t=3, p=4,
// hashLength=64) sit comfortably inside; the caps reject absurd values that
// would be stored and echoed back to other clients (a self-DoS where everyone
// who logs in is forced to compute a multi-GB hash).
const KDF_BOUNDS = {
  memoryCost: { min: 8 * 1024, max: 1024 * 1024 },
  timeCost: { min: 1, max: 16 },
  parallelism: { min: 1, max: 16 },
  hashLength: { min: 16, max: 128 },
} as const;

function parseKdfParams(value: unknown, field: string) {
  if (!value || typeof value !== "object") {
    throw new HTTPException(400, { message: `missing_field: ${field}` });
  }
  const v = value as Record<string, unknown>;

  function requireNum(
    camel: keyof typeof KDF_BOUNDS,
    snake: string,
    bounds: { min: number; max: number },
  ): number {
    const raw = v[camel] ?? v[snake];
    if (raw === undefined || raw === null) {
      throw new HTTPException(400, { message: `missing_kdf_field: ${field}.${camel}` });
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < bounds.min || n > bounds.max) {
      throw new HTTPException(400, { message: `invalid_kdf_field: ${field}.${camel}` });
    }
    return n;
  }

  return {
    memoryCost: requireNum("memoryCost", "memory_cost", KDF_BOUNDS.memoryCost),
    timeCost: requireNum("timeCost", "time_cost", KDF_BOUNDS.timeCost),
    parallelism: requireNum("parallelism", "parallelism", KDF_BOUNDS.parallelism),
    hashLength: requireNum("hashLength", "hash_length", KDF_BOUNDS.hashLength),
  };
}

function hashIp(ip: string): string {
  return createHmac("sha256", getEnumerationSecret()).update(ip).digest("hex");
}

function errorToHttp(err: unknown): never {
  if (err instanceof RateLimitedError) {
    throw new HTTPException(429, { message: err.message });
  }
  if (err instanceof AllowlistDeniedError) {
    throw new HTTPException(403, { message: err.code });
  }
  if (err instanceof InvalidInviteError) {
    throw new HTTPException(403, { message: err.code });
  }
  if (err instanceof UsernameTakenError) {
    throw new HTTPException(409, { message: err.code });
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
  const authHash = parseB64Buf(body.auth_hash, "auth_hash", AUTH_HASH_LEN);
  const kdfSalt = parseB64Buf(body.kdf_salt, "kdf_salt", SALT_LEN);
  const kdfParams = parseKdfParams(body.kdf_params, "kdf_params");
  const recoveryBlob = parseB64Buf(body.recovery_blob, "recovery_blob", AUTH_HASH_LEN);
  const recoverySalt = parseB64Buf(body.recovery_salt, "recovery_salt", SALT_LEN);
  const recoveryParams = parseKdfParams(body.recovery_params, "recovery_params");
  const wrappedDek = parseB64Buf(body.wrapped_dek, "wrapped_dek", WRAPPED_DEK_LEN);
  const wrappedDekIv = parseB64Buf(body.wrapped_dek_iv, "wrapped_dek_iv", IV_LEN);
  const wrappedDekRecovery = parseB64Buf(
    body.wrapped_dek_recovery,
    "wrapped_dek_recovery",
    WRAPPED_DEK_LEN,
  );
  const wrappedDekRecoveryIv = parseB64Buf(
    body.wrapped_dek_recovery_iv,
    "wrapped_dek_recovery_iv",
    IV_LEN,
  );
  const inviteToken = typeof body.invite_token === "string" ? body.invite_token : undefined;

  const ip = hashIp(clientIpFromXff(c.req.header("x-forwarded-for")));

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
      ...(inviteToken !== undefined ? { inviteToken } : {}),
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
  const authHash = parseB64Buf(body.auth_hash, "auth_hash", AUTH_HASH_LEN);

  const ip = hashIp(clientIpFromXff(c.req.header("x-forwarded-for")));

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
  await session.revokeByToken(token);
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
  const recoveryProof = parseB64Buf(body.recovery_proof, "recovery_proof", AUTH_HASH_LEN);
  const newAuthHash = parseB64Buf(body.new_auth_hash, "new_auth_hash", AUTH_HASH_LEN);
  const newKdfSalt = parseB64Buf(body.new_kdf_salt, "new_kdf_salt", SALT_LEN);
  const newKdfParams = parseKdfParams(body.new_kdf_params, "new_kdf_params");
  const newRecoveryBlob = parseB64Buf(body.new_recovery_blob, "new_recovery_blob", AUTH_HASH_LEN);
  const newRecoverySalt = parseB64Buf(body.new_recovery_salt, "new_recovery_salt", SALT_LEN);
  const newRecoveryParams = parseKdfParams(body.new_recovery_params, "new_recovery_params");
  const newWrappedDek = parseB64Buf(body.new_wrapped_dek, "new_wrapped_dek", WRAPPED_DEK_LEN);
  const newWrappedDekIv = parseB64Buf(body.new_wrapped_dek_iv, "new_wrapped_dek_iv", IV_LEN);
  const newWrappedDekRecovery = parseB64Buf(
    body.new_wrapped_dek_recovery,
    "new_wrapped_dek_recovery",
    WRAPPED_DEK_LEN,
  );
  const newWrappedDekRecoveryIv = parseB64Buf(
    body.new_wrapped_dek_recovery_iv,
    "new_wrapped_dek_recovery_iv",
    IV_LEN,
  );

  const ip = hashIp(clientIpFromXff(c.req.header("x-forwarded-for")));

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

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    throw new HTTPException(400, { message: "invalid_json" });
  }
  const currentAuthHash = parseB64Buf(body.current_auth_hash, "current_auth_hash", AUTH_HASH_LEN);
  const newAuthHash = parseB64Buf(body.new_auth_hash, "new_auth_hash", AUTH_HASH_LEN);
  const newKdfSalt = parseB64Buf(body.new_kdf_salt, "new_kdf_salt", SALT_LEN);
  const newKdfParams = parseKdfParams(body.new_kdf_params, "new_kdf_params");
  const newRecoveryBlob = parseB64Buf(body.new_recovery_blob, "new_recovery_blob", AUTH_HASH_LEN);
  const newRecoverySalt = parseB64Buf(body.new_recovery_salt, "new_recovery_salt", SALT_LEN);
  const newRecoveryParams = parseKdfParams(body.new_recovery_params, "new_recovery_params");
  const newWrappedDek = parseB64Buf(body.new_wrapped_dek, "new_wrapped_dek", WRAPPED_DEK_LEN);
  const newWrappedDekIv = parseB64Buf(body.new_wrapped_dek_iv, "new_wrapped_dek_iv", IV_LEN);
  const newWrappedDekRecovery = parseB64Buf(
    body.new_wrapped_dek_recovery,
    "new_wrapped_dek_recovery",
    WRAPPED_DEK_LEN,
  );
  const newWrappedDekRecoveryIv = parseB64Buf(
    body.new_wrapped_dek_recovery_iv,
    "new_wrapped_dek_recovery_iv",
    IV_LEN,
  );

  const { session, password } = getServices();
  let auth: AuthenticatedSession;
  try {
    auth = await session.validateToken(token);
  } catch (err) {
    errorToHttp(err);
  }

  try {
    await rateLimit.gatePasswordVerify(auth.userId);
  } catch (err) {
    errorToHttp(err);
  }

  try {
    const result = await password.changePassword(auth, {
      currentAuthHash,
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
    rateLimit.recordPasswordVerifySuccess(auth.userId);
    setSessionCookie(c, result.token, result.expiresAt);
    return c.json({});
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      rateLimit.recordPasswordVerifyFailure(auth.userId);
    }
    errorToHttp(err);
  }
});

export const featureRouter: FeatureRouter = {
  basePath: "/api/auth",
  router,
};

export { SESSION_COOKIE };
