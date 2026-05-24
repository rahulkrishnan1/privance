import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createHmac } from "node:crypto";

mock.module("../core/db.js", () => ({ db: {} }));

// Mock ./kdf.js (not hash-wasm) so the global hash-wasm module stays real for
// packages/core tests that run in the same bun process.
const MOCK_ENCODED = "$argon2id$v=19$m=65536,t=3,p=4$abc$def";
const mockVerifyAuthHash = mock(async (): Promise<boolean> => true);
const mockHashAuthHash = mock(
  async (): Promise<{ hash: string; salt: Buffer }> => ({
    hash: MOCK_ENCODED,
    salt: Buffer.from("mocksalt"),
  }),
);
const VALID_TOKEN_RAW = Buffer.alloc(32, 0xab);
const VALID_TOKEN_B64 = VALID_TOKEN_RAW.toString("base64url").replace(/=/g, "");

mock.module("./kdf.js", () => ({
  hashAuthHash: mockHashAuthHash,
  verifyAuthHash: mockVerifyAuthHash,
  generateSessionToken: () => ({ token: VALID_TOKEN_B64, raw: VALID_TOKEN_RAW }),
  hashSessionToken: (raw: Buffer) => raw,
  hashInviteToken: (raw: Buffer) => raw,
  decodeSessionToken: (encoded: string) => {
    const padded = encoded + "=".repeat(-encoded.length & 3);
    return Buffer.from(padded, "base64url");
  },
  deriveFakeKdfSalt: (_u: string, _s: Buffer) => Buffer.alloc(16, 0x11),
  deriveFakeRecoveryBlob: (_u: string, _s: Buffer) => ({
    wrappedBlob: Buffer.alloc(48, 0x22),
    blobIv: Buffer.alloc(12, 0x33),
  }),
  deriveFakeWrappedDekRecovery: (_u: string, _s: Buffer) => ({
    wrappedDekRecovery: Buffer.alloc(48, 0x44),
    wrappedDekRecoveryIv: Buffer.alloc(12, 0x55),
  }),
  SERVER_KDF_PARAMS: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 32 },
  CLIENT_KDF_PARAMS: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 64 },
}));

const VALID_TOKEN = VALID_TOKEN_B64;

import type { SessionRow, UserRow } from "./repo.js";

const DEFAULT_USER: UserRow = {
  userId: "user-uuid-1",
  username: "alice",
  authHashHash: Buffer.from("hash"),
  kdfParams: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 64 },
  recoveryBlob: Buffer.from("blob"),
  recoverySalt: Buffer.from("rsalt"),
  recoveryParams: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 64 },
  wrappedDek: Buffer.from("wdek"),
  wrappedDekIv: Buffer.from("wdekiv"),
  wrappedDekRecovery: Buffer.alloc(48, 0xaa),
  wrappedDekRecoveryIv: Buffer.alloc(12, 0xbb),
  kdfSalt: Buffer.from("kdfsalt"),
};

const DEFAULT_SESSION: SessionRow = {
  sessionId: "sess-uuid-1",
  userId: "user-uuid-1",
  tokenHash: Buffer.from("th"),
  expiresAt: new Date(Date.now() + 86400_000),
  revokedAt: null,
};

const mockGetUserByUsername = mock(async (): Promise<UserRow | null> => null);
const mockCreateUser = mock(async (): Promise<UserRow> => DEFAULT_USER);
const mockUpdateUserCredentials = mock(async (): Promise<void> => undefined);
const mockCreateSession = mock(async (): Promise<SessionRow> => DEFAULT_SESSION);
const mockGetSessionByTokenHash = mock(async (): Promise<SessionRow | null> => DEFAULT_SESSION);
const mockTouchSession = mock(async (): Promise<void> => undefined);
const mockRevokeSession = mock(async (): Promise<void> => undefined);
const mockRevokeAllUserSessions = mock(async (): Promise<void> => undefined);
const mockLogEvent = mock(async (): Promise<void> => undefined);
const mockClaimInviteToken = mock(
  async (): Promise<{ tokenId: string } | null> => ({ tokenId: "invite-uuid-1" }),
);
const mockCreateInviteToken = mock(
  async (): Promise<{ tokenId: string }> => ({ tokenId: "tok-mocked" }),
);

mock.module("./repo.js", () => ({
  AuthRepo: class {
    getUserByUsername = mockGetUserByUsername;
    createUser = mockCreateUser;
    updateUserCredentials = mockUpdateUserCredentials;
    createSession = mockCreateSession;
    getSessionByTokenHash = mockGetSessionByTokenHash;
    touchSession = mockTouchSession;
    revokeSession = mockRevokeSession;
    revokeAllUserSessions = mockRevokeAllUserSessions;
    logEvent = mockLogEvent;
    claimInviteToken = mockClaimInviteToken;
    createInviteToken = mockCreateInviteToken;
  },
}));

process.env.ENUMERATION_SECRET = Buffer.alloc(32, 0x42).toString("base64");

const { default: server } = await import("../index.js");
const { resetAll: resetRateLimit } = await import("./rate-limit.js");
const { _setHibpCheckerForTests, _resetHibpChecker, _resetCachedServicesForTests } = await import(
  "./wire.js"
);

let mockHibpResult: boolean | null = false;
_setHibpCheckerForTests(async () => mockHibpResult);

const BASE = "http://localhost";

const CSRF = { "X-Requested-With": "XMLHttpRequest" };
const JSON_CT = { "Content-Type": "application/json" };

function b64(s: string): string {
  return Buffer.from(s).toString("base64");
}

const VALID_SIGNUP_BODY = {
  username: "alice",
  auth_hash: b64("a".repeat(32)),
  kdf_salt: b64("s".repeat(16)),
  kdf_params: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 64 },
  recovery_blob: b64("rb".repeat(24)),
  recovery_salt: b64("rs".repeat(8)),
  recovery_params: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 64 },
  wrapped_dek: b64("wd".repeat(24)),
  wrapped_dek_iv: b64("iv".repeat(6)),
  wrapped_dek_recovery: b64("wdr".repeat(16)),
  wrapped_dek_recovery_iv: b64("ri".repeat(6)),
};

function resetMocks(): void {
  mockGetUserByUsername.mockImplementation(async () => null);
  mockCreateUser.mockImplementation(async () => DEFAULT_USER);
  mockGetSessionByTokenHash.mockImplementation(async () => DEFAULT_SESSION);
  mockCreateSession.mockImplementation(async () => DEFAULT_SESSION);
  mockTouchSession.mockImplementation(async () => undefined);
  mockHibpResult = false;
  mockLogEvent.mockImplementation(async () => undefined);
  mockUpdateUserCredentials.mockImplementation(async () => undefined);
  mockUpdateUserCredentials.mockClear();
  mockRevokeSession.mockImplementation(async () => undefined);
  mockRevokeAllUserSessions.mockImplementation(async () => undefined);
  mockVerifyAuthHash.mockImplementation(async () => true);
  mockHashAuthHash.mockImplementation(async () => ({
    hash: MOCK_ENCODED,
    salt: Buffer.from("mocksalt"),
  }));
  mockClaimInviteToken.mockImplementation(async () => ({ tokenId: "invite-uuid-1" }));
  mockCreateInviteToken.mockImplementation(async () => ({ tokenId: "tok-mocked" }));
  resetRateLimit();
}

describe("CSRF on auth routes", () => {
  beforeEach(resetMocks);

  it("POST /kdf-params without X-Requested-With → 403", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/kdf-params`, {
        method: "POST",
        headers: JSON_CT,
        body: JSON.stringify({ username: "alice" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("POST /signup without X-Requested-With → 403", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: JSON_CT,
        body: JSON.stringify(VALID_SIGNUP_BODY),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("POST /login without X-Requested-With → 403", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: JSON_CT,
        body: JSON.stringify({ username: "alice", auth_hash: b64("a".repeat(32)) }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("GET /session bypasses CSRF (read-only) → 401 (no cookie)", async () => {
    const res = await server.fetch(new Request(`${BASE}/api/auth/session`));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/kdf-params", () => {
  beforeEach(resetMocks);

  it("known user → returns real KDF params", async () => {
    mockGetUserByUsername.mockImplementation(async () => DEFAULT_USER);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/kdf-params`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "alice" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kdf_algo: string; kdf_salt: string };
    expect(body.kdf_algo).toBe("argon2id");
    expect(typeof body.kdf_salt).toBe("string");
  });

  it("unknown user → returns fake (deterministic) KDF params", async () => {
    mockGetUserByUsername.mockImplementation(async () => null);
    const res1 = await server.fetch(
      new Request(`${BASE}/api/auth/kdf-params`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "ghost" }),
      }),
    );
    const res2 = await server.fetch(
      new Request(`${BASE}/api/auth/kdf-params`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "ghost" }),
      }),
    );
    expect(res1.status).toBe(200);
    const b1 = (await res1.json()) as { kdf_salt: string };
    const b2 = (await res2.json()) as { kdf_salt: string };
    expect(b1.kdf_salt).toBe(b2.kdf_salt);
  });
});

describe("POST /api/auth/signup", () => {
  beforeEach(resetMocks);

  it("success path → 201 with user_id, sets Set-Cookie", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify(VALID_SIGNUP_BODY),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user_id: string };
    expect(body.user_id).toBe("user-uuid-1");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("privance_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("HIBP hit → 422 weak_password", async () => {
    mockHibpResult = true;
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify(VALID_SIGNUP_BODY),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("HIBP timeout → 503 hibp_unavailable (fail-open blocks)", async () => {
    mockHibpResult = null;
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify(VALID_SIGNUP_BODY),
      }),
    );
    expect(res.status).toBe(503);
  });

  it("username taken → 409", async () => {
    // Simulate the Drizzle-wrapped Postgres SQLSTATE 23505 shape:
    // outer DrizzleQueryError wraps the underlying PostgresError as .cause.
    const pgErr = Object.assign(new Error("unique constraint"), { code: "23505" });
    const drizzleErr = Object.assign(new Error("query failed"), { cause: pgErr });
    mockCreateUser.mockRejectedValue(drizzleErr);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify(VALID_SIGNUP_BODY),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("allowlist denied → 403", async () => {
    process.env.SIGNUP_ALLOWLIST = "bob,carol";
    _resetCachedServicesForTests();
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify(VALID_SIGNUP_BODY),
      }),
    );
    process.env.SIGNUP_ALLOWLIST = "";
    _resetCachedServicesForTests();
    expect(res.status).toBe(403);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(resetMocks);

  it("success → 200, sets cookie, returns wrapped_dek", async () => {
    mockGetUserByUsername.mockImplementation(async () => ({
      ...DEFAULT_USER,
      authHashHash: Buffer.from("$argon2id$v=19$m=65536,t=3,p=4$abc$def"),
    }));
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "alice", auth_hash: b64("a".repeat(32)) }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wrapped_dek: string };
    expect(typeof body.wrapped_dek).toBe("string");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("privance_session=");
  });

  it("wrong password → 401 invalid_credentials", async () => {
    mockGetUserByUsername.mockImplementation(async () => ({
      ...DEFAULT_USER,
      authHashHash: Buffer.from("$argon2id$v=19$m=65536,t=3,p=4$abc$def"),
    }));
    mockVerifyAuthHash.mockImplementation(async () => false);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "alice", auth_hash: b64("b".repeat(32)) }),
      }),
    );
    mockVerifyAuthHash.mockImplementation(async () => true);
    expect(res.status).toBe(401);
  });

  it("unknown username → 401 (enumeration-safe path)", async () => {
    mockGetUserByUsername.mockImplementation(async () => null);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "nobody", auth_hash: b64("a".repeat(32)) }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/auth/session", () => {
  beforeEach(resetMocks);

  it("no cookie → 401", async () => {
    const res = await server.fetch(new Request(`${BASE}/api/auth/session`));
    expect(res.status).toBe(401);
  });

  it("valid cookie → 200 with user_id and expires_at", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/session`, {
        headers: { Cookie: `privance_session=${VALID_TOKEN}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user_id: string; expires_at: string };
    expect(body.user_id).toBe("user-uuid-1");
    expect(typeof body.expires_at).toBe("string");
  });

  it("revoked/missing session → 401", async () => {
    mockGetSessionByTokenHash.mockImplementation(async () => null);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/session`, {
        headers: { Cookie: `privance_session=${VALID_TOKEN}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("expired session → 401", async () => {
    mockGetSessionByTokenHash.mockImplementation(async () => ({
      sessionId: "sess-uuid-1",
      userId: "user-uuid-1",
      tokenHash: Buffer.from("th"),
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
    }));
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/session`, {
        headers: { Cookie: `privance_session=${VALID_TOKEN}` },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  beforeEach(resetMocks);

  it("valid session → 200, clears cookie", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/logout`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF, Cookie: `privance_session=${VALID_TOKEN}` },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("Max-Age=0");
  });

  it("no cookie → 401", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/logout`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/recovery/derive-params", () => {
  beforeEach(resetMocks);

  it("unknown user → deterministic fake params", async () => {
    mockGetUserByUsername.mockImplementation(async () => null);
    const r1 = await server.fetch(
      new Request(`${BASE}/api/auth/recovery/derive-params`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "ghost" }),
      }),
    );
    const r2 = await server.fetch(
      new Request(`${BASE}/api/auth/recovery/derive-params`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "ghost" }),
      }),
    );
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { kdf_salt: string };
    const b2 = (await r2.json()) as { kdf_salt: string };
    expect(b1.kdf_salt).toBe(b2.kdf_salt);
  });

  it("known user → real recovery params", async () => {
    mockGetUserByUsername.mockImplementation(async () => DEFAULT_USER);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/recovery/derive-params`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "alice" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recovery_blob: string };
    expect(typeof body.recovery_blob).toBe("string");
  });

  it("known user → response includes wrapped_dek_recovery and wrapped_dek_recovery_iv", async () => {
    mockGetUserByUsername.mockImplementation(async () => DEFAULT_USER);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/recovery/derive-params`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "alice" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      wrapped_dek_recovery: string;
      wrapped_dek_recovery_iv: string;
    };
    expect(typeof body.wrapped_dek_recovery).toBe("string");
    expect(typeof body.wrapped_dek_recovery_iv).toBe("string");
    // Must be the login wrap, not the recovery wrap (distinct buffers)
    expect(body.wrapped_dek_recovery).toBe(DEFAULT_USER.wrappedDekRecovery.toString("base64"));
  });

  it("unknown user → response includes fake wrapped_dek_recovery (deterministic)", async () => {
    mockGetUserByUsername.mockImplementation(async () => null);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/recovery/derive-params`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "ghost" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      wrapped_dek_recovery: string;
      wrapped_dek_recovery_iv: string;
    };
    expect(typeof body.wrapped_dek_recovery).toBe("string");
    expect(typeof body.wrapped_dek_recovery_iv).toBe("string");
  });
});

describe("POST /api/auth/recovery/reset", () => {
  beforeEach(resetMocks);

  const VALID_RESET_BODY = {
    username: "alice",
    recovery_proof: b64("r".repeat(32)),
    new_auth_hash: b64("a".repeat(32)),
    new_kdf_salt: b64("s".repeat(16)),
    new_kdf_params: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 32 },
    new_recovery_blob: b64("rb".repeat(24)),
    new_recovery_salt: b64("rs".repeat(8)),
    new_recovery_params: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 32 },
    new_wrapped_dek: b64("wd".repeat(24)),
    new_wrapped_dek_iv: b64("iv".repeat(6)),
    new_wrapped_dek_recovery: b64("wdr".repeat(16)),
    new_wrapped_dek_recovery_iv: b64("ri".repeat(6)),
  };

  it("valid recovery proof → 200, sets cookie", async () => {
    mockGetUserByUsername.mockImplementation(async () => ({
      ...DEFAULT_USER,
      authHashHash: Buffer.from("$argon2id$v=19$m=65536,t=3,p=4$abc$def"),
      recoveryBlob: Buffer.from("$argon2id$v=19$m=65536,t=3,p=4$abc$def"),
    }));
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/recovery/reset`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify(VALID_RESET_BODY),
      }),
    );
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("privance_session=");
  });

  it("unknown username → 401 recovery_invalid", async () => {
    mockGetUserByUsername.mockImplementation(async () => null);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/recovery/reset`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify(VALID_RESET_BODY),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("passes new_wrapped_dek_recovery through to repo.updateUserCredentials", async () => {
    mockGetUserByUsername.mockImplementation(async () => ({
      ...DEFAULT_USER,
      authHashHash: Buffer.from("$argon2id$v=19$m=65536,t=3,p=4$abc$def"),
      recoveryBlob: Buffer.from("$argon2id$v=19$m=65536,t=3,p=4$abc$def"),
    }));
    await server.fetch(
      new Request(`${BASE}/api/auth/recovery/reset`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify(VALID_RESET_BODY),
      }),
    );
    expect(mockUpdateUserCredentials).toHaveBeenCalledTimes(1);
    const call = (mockUpdateUserCredentials.mock.calls[0] as unknown as [unknown])[0] as {
      wrappedDekRecovery: Buffer;
      wrappedDekRecoveryIv: Buffer;
    };
    expect(call.wrappedDekRecovery).toBeInstanceOf(Buffer);
    expect(call.wrappedDekRecoveryIv).toBeInstanceOf(Buffer);
  });
});

describe("POST /api/auth/password/change", () => {
  beforeEach(resetMocks);

  const VALID_PASSWORD_CHANGE_BODY = {
    new_auth_hash: b64("a".repeat(32)),
    new_kdf_salt: b64("s".repeat(16)),
    new_kdf_params: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 32 },
    new_recovery_blob: b64("rb".repeat(24)),
    new_recovery_salt: b64("rs".repeat(8)),
    new_recovery_params: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 32 },
    new_wrapped_dek: b64("wd".repeat(24)),
    new_wrapped_dek_iv: b64("iv".repeat(6)),
    new_wrapped_dek_recovery: b64("wdr".repeat(16)),
    new_wrapped_dek_recovery_iv: b64("ri".repeat(6)),
  };

  it("valid session → 200, rotates credentials including recovery wrap", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/password/change`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF, Cookie: `privance_session=${VALID_TOKEN}` },
        body: JSON.stringify(VALID_PASSWORD_CHANGE_BODY),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockUpdateUserCredentials).toHaveBeenCalledTimes(1);
    const call = (mockUpdateUserCredentials.mock.calls[0] as unknown as [unknown])[0] as {
      wrappedDekRecovery: Buffer;
      wrappedDekRecoveryIv: Buffer;
    };
    expect(call.wrappedDekRecovery).toBeInstanceOf(Buffer);
    expect(call.wrappedDekRecoveryIv).toBeInstanceOf(Buffer);
  });

  it("missing new_wrapped_dek_recovery → 400", async () => {
    const { new_wrapped_dek_recovery: _, ...bodyWithout } = VALID_PASSWORD_CHANGE_BODY;
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/password/change`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF, Cookie: `privance_session=${VALID_TOKEN}` },
        body: JSON.stringify(bodyWithout),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("hashIp (HMAC-SHA256 keyed on ENUMERATION_SECRET) only stores hashes, never raw IPs", () => {
  const secret = Buffer.alloc(32, 0x42);

  function hashIpRef(ip: string): string {
    return createHmac("sha256", secret).update(ip).digest("hex");
  }

  it("is deterministic for the same input", () => {
    const h1 = hashIpRef("192.0.2.1");
    const h2 = hashIpRef("192.0.2.1");
    expect(h1).toBe(h2);
  });

  it("different IPs produce different hashes", () => {
    expect(hashIpRef("192.0.2.1")).not.toBe(hashIpRef("10.0.0.1"));
  });

  it("hash does not contain the raw IP substring", () => {
    const ip = "203.0.113.42";
    const hash = hashIpRef(ip);
    expect(hash).not.toContain(ip);
  });

  it("'unknown' placeholder is also hashed (absent x-forwarded-for)", () => {
    const hash = hashIpRef("unknown");
    expect(hash).not.toContain("unknown");
    expect(hash).toHaveLength(64);
  });
});

const INVITE_TOKEN_RAW = Buffer.alloc(32, 0xcd);
const INVITE_TOKEN_B64 = INVITE_TOKEN_RAW.toString("base64url").replace(/=/g, "");

describe("POST /api/auth/signup with INVITE_REQUIRED", () => {
  beforeEach(resetMocks);

  it("INVITE_REQUIRED=true + missing invite_token → 403 invalid_invite", async () => {
    process.env.INVITE_REQUIRED = "true";
    _resetCachedServicesForTests();
    mockClaimInviteToken.mockImplementation(async () => null);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify(VALID_SIGNUP_BODY),
      }),
    );
    delete process.env.INVITE_REQUIRED;
    _resetCachedServicesForTests();
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("invalid_invite");
  });

  it("INVITE_REQUIRED=true + missing invite_token → claimInviteToken was called (matched-latency parity)", async () => {
    process.env.INVITE_REQUIRED = "true";
    _resetCachedServicesForTests();
    mockClaimInviteToken.mockImplementation(async () => null);
    await server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify(VALID_SIGNUP_BODY),
      }),
    );
    delete process.env.INVITE_REQUIRED;
    _resetCachedServicesForTests();
    expect(mockClaimInviteToken.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("INVITE_REQUIRED=true + used/expired invite_token (claimInviteToken returns null) → 403 invalid_invite", async () => {
    process.env.INVITE_REQUIRED = "true";
    _resetCachedServicesForTests();
    mockClaimInviteToken.mockImplementation(async () => null);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ ...VALID_SIGNUP_BODY, invite_token: INVITE_TOKEN_B64 }),
      }),
    );
    delete process.env.INVITE_REQUIRED;
    _resetCachedServicesForTests();
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("invalid_invite");
  });

  it("INVITE_REQUIRED=true + valid invite_token → 201 success", async () => {
    process.env.INVITE_REQUIRED = "true";
    _resetCachedServicesForTests();
    mockClaimInviteToken.mockImplementation(async () => ({ tokenId: "tok-1" }));
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ ...VALID_SIGNUP_BODY, invite_token: INVITE_TOKEN_B64 }),
      }),
    );
    delete process.env.INVITE_REQUIRED;
    _resetCachedServicesForTests();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user_id: string };
    expect(body.user_id).toBe("user-uuid-1");
  });

  it("INVITE_REQUIRED=true + malformed invite_token → 403 invalid_invite", async () => {
    process.env.INVITE_REQUIRED = "true";
    _resetCachedServicesForTests();
    mockClaimInviteToken.mockImplementation(async () => null);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ ...VALID_SIGNUP_BODY, invite_token: "!!!" }),
      }),
    );
    delete process.env.INVITE_REQUIRED;
    _resetCachedServicesForTests();
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("invalid_invite");
  });

  it("INVITE_REQUIRED unset + missing invite_token → existing signup behavior (201)", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify(VALID_SIGNUP_BODY),
      }),
    );
    expect(res.status).toBe(201);
  });
});
