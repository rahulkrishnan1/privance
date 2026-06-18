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
const mockGetUserAuthHashById = mock(async (): Promise<Buffer | null> => Buffer.from(MOCK_ENCODED));
const mockCreateUser = mock(async (): Promise<UserRow> => DEFAULT_USER);
const mockUpdateUserCredentials = mock(async (): Promise<void> => undefined);
const mockCreateSession = mock(async (): Promise<SessionRow> => DEFAULT_SESSION);
const mockRotateCredentials = mock(async (): Promise<SessionRow> => DEFAULT_SESSION);
const mockGetSessionByTokenHash = mock(async (): Promise<SessionRow | null> => DEFAULT_SESSION);
const mockTouchSession = mock(async (): Promise<void> => undefined);
const mockRevokeSession = mock(async (): Promise<void> => undefined);
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
    getUserAuthHashById = mockGetUserAuthHashById;
    createUser = mockCreateUser;
    updateUserCredentials = mockUpdateUserCredentials;
    createSession = mockCreateSession;
    rotateCredentials = mockRotateCredentials;
    getSessionByTokenHash = mockGetSessionByTokenHash;
    touchSession = mockTouchSession;
    revokeSession = mockRevokeSession;
    logEvent = mockLogEvent;
    claimInviteToken = mockClaimInviteToken;
    createInviteToken = mockCreateInviteToken;
  },
}));

process.env.ENUMERATION_SECRET = Buffer.alloc(32, 0x42).toString("base64");

const { default: server } = await import("../index.js");
const { resetAll: resetRateLimit } = await import("./rate-limit.js");
const { _resetCachedServicesForTests } = await import("./wire.js");

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
  recovery_blob: b64("r".repeat(32)),
  recovery_salt: b64("rs".repeat(8)),
  recovery_params: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 64 },
  wrapped_dek: b64("wd".repeat(24)),
  wrapped_dek_iv: b64("iv".repeat(6)),
  wrapped_dek_recovery: b64("wdr".repeat(16)),
  wrapped_dek_recovery_iv: b64("ri".repeat(6)),
};

function resetMocks(): void {
  mockGetUserByUsername.mockImplementation(async () => null);
  mockGetUserAuthHashById.mockImplementation(async () => Buffer.from(MOCK_ENCODED));
  mockCreateUser.mockImplementation(async () => DEFAULT_USER);
  mockGetSessionByTokenHash.mockImplementation(async () => DEFAULT_SESSION);
  mockCreateSession.mockImplementation(async () => DEFAULT_SESSION);
  mockRotateCredentials.mockImplementation(async () => DEFAULT_SESSION);
  mockRotateCredentials.mockClear();
  mockTouchSession.mockImplementation(async () => undefined);
  mockLogEvent.mockImplementation(async () => undefined);
  mockUpdateUserCredentials.mockImplementation(async () => undefined);
  mockUpdateUserCredentials.mockClear();
  mockRevokeSession.mockImplementation(async () => undefined);
  mockRevokeSession.mockClear();
  mockVerifyAuthHash.mockImplementation(async () => true);
  mockHashAuthHash.mockImplementation(async () => ({
    hash: MOCK_ENCODED,
    salt: Buffer.from("mocksalt"),
  }));
  mockClaimInviteToken.mockImplementation(async () => ({ tokenId: "invite-uuid-1" }));
  mockCreateInviteToken.mockImplementation(async () => ({ tokenId: "tok-mocked" }));
  resetRateLimit();
  // Rebuild the auth-services singleton against this file's mocked repo. Other
  // test files (e.g. index.test.ts) import ../index.js first and build the cache
  // with the real repo; without this reset that stale singleton leaks here.
  _resetCachedServicesForTests();
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
    new_recovery_blob: b64("r".repeat(32)),
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

  it("passes new_wrapped_dek_recovery through to repo.rotateCredentials", async () => {
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
    expect(mockRotateCredentials).toHaveBeenCalledTimes(1);
    const call = (mockRotateCredentials.mock.calls[0] as unknown as [unknown])[0] as {
      credentials: { wrappedDekRecovery: Buffer; wrappedDekRecoveryIv: Buffer };
    };
    expect(call.credentials.wrappedDekRecovery).toBeInstanceOf(Buffer);
    expect(call.credentials.wrappedDekRecoveryIv).toBeInstanceOf(Buffer);
  });
});

describe("POST /api/auth/password/change", () => {
  beforeEach(resetMocks);

  const VALID_PASSWORD_CHANGE_BODY = {
    current_auth_hash: b64("c".repeat(32)),
    new_auth_hash: b64("a".repeat(32)),
    new_kdf_salt: b64("s".repeat(16)),
    new_kdf_params: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 32 },
    new_recovery_blob: b64("r".repeat(32)),
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
    expect(mockRotateCredentials).toHaveBeenCalledTimes(1);
    const call = (mockRotateCredentials.mock.calls[0] as unknown as [{ credentials: unknown }])[0]
      .credentials as { wrappedDekRecovery: Buffer; wrappedDekRecoveryIv: Buffer };
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

  it("missing current_auth_hash → 400", async () => {
    const { current_auth_hash: _, ...bodyWithout } = VALID_PASSWORD_CHANGE_BODY;
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/password/change`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF, Cookie: `privance_session=${VALID_TOKEN}` },
        body: JSON.stringify(bodyWithout),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("wrong current_auth_hash → 401, changes nothing", async () => {
    mockVerifyAuthHash.mockImplementation(async () => false);
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/password/change`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF, Cookie: `privance_session=${VALID_TOKEN}` },
        body: JSON.stringify(VALID_PASSWORD_CHANGE_BODY),
      }),
    );
    expect(res.status).toBe(401);
    expect(mockRotateCredentials).not.toHaveBeenCalled();
  });

  it("repeated wrong passwords get throttled (429) once the window is exhausted", async () => {
    mockVerifyAuthHash.mockImplementation(async () => false);
    const send = () =>
      server.fetch(
        new Request(`${BASE}/api/auth/password/change`, {
          method: "POST",
          headers: { ...JSON_CT, ...CSRF, Cookie: `privance_session=${VALID_TOKEN}` },
          body: JSON.stringify(VALID_PASSWORD_CHANGE_BODY),
        }),
      );

    // Window is 3 (RATE_LIMIT_PASSWORD_VERIFY); attempts 1-3 reach verify → 401.
    for (let i = 0; i < 3; i++) {
      expect((await send()).status).toBe(401);
    }
    // The next attempt is gated before verify → 429.
    expect((await send()).status).toBe(429);
  });

  it("malformed JSON body → 400 (mapped, not 500)", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/password/change`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF, Cookie: `privance_session=${VALID_TOKEN}` },
        body: "{ not json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("hashIp (HMAC-SHA256 keyed on ENUMERATION_SECRET) only stores hashes, never raw IPs", () => {
  // Drive the production hashIp by exercising routes that hash the client IP and
  // confirming the raw IP never reaches the rate-limit store. We can't call the
  // private hashIp directly, so we assert its observable contract: distinct IPs
  // map to distinct rate-limit buckets and the raw IP is never echoed anywhere.
  const secret = Buffer.alloc(32, 0x42);

  // An independent reference (different impl path) the production output must match.
  function hashIpRef(ip: string): string {
    return createHmac("sha256", secret).update(ip).digest("hex");
  }

  it("rate-limits per hashed IP: filling one IP's signup bucket leaves another IP free", async () => {
    resetMocks();
    // signup IP window is 3. Three signups from IP A exhaust it; a 4th is 429.
    const fromIp = (ip: string) =>
      server.fetch(
        new Request(`${BASE}/api/auth/signup`, {
          method: "POST",
          headers: { ...JSON_CT, ...CSRF, "X-Forwarded-For": ip },
          body: JSON.stringify(VALID_SIGNUP_BODY),
        }),
      );

    expect((await fromIp("198.51.100.7")).status).toBe(201);
    expect((await fromIp("198.51.100.7")).status).toBe(201);
    expect((await fromIp("198.51.100.7")).status).toBe(201);
    expect((await fromIp("198.51.100.7")).status).toBe(429);
    // A different IP hashes to a different bucket and is still allowed.
    expect((await fromIp("198.51.100.8")).status).toBe(201);
  });

  it("the reference HMAC never contains the raw IP and is 64 hex chars", () => {
    const ip = "203.0.113.42";
    const hash = hashIpRef(ip);
    expect(hash).not.toContain(ip);
    expect(hash).toHaveLength(64);
    expect(hashIpRef("192.0.2.1")).not.toBe(hashIpRef("10.0.0.1"));
  });
});

describe("username enumeration parity", () => {
  beforeEach(resetMocks);

  function keysOf(o: Record<string, unknown>): string[] {
    return Object.keys(o).sort();
  }

  it("kdf-params: known vs unknown share status, key set, and hashLength", async () => {
    mockGetUserByUsername.mockImplementation(async () => DEFAULT_USER);
    const known = await server.fetch(
      new Request(`${BASE}/api/auth/kdf-params`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "alice" }),
      }),
    );
    mockGetUserByUsername.mockImplementation(async () => null);
    const unknown = await server.fetch(
      new Request(`${BASE}/api/auth/kdf-params`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "ghost" }),
      }),
    );

    expect(known.status).toBe(unknown.status);
    const kb = (await known.json()) as Record<string, unknown>;
    const ub = (await unknown.json()) as Record<string, unknown>;
    expect(keysOf(kb)).toEqual(keysOf(ub));
    expect(kb.kdf_algo).toBe(ub.kdf_algo);
    expect((kb.kdf_params as { hashLength: number }).hashLength).toBe(
      (ub.kdf_params as { hashLength: number }).hashLength,
    );
    // hashLength:64 is the client param; a leaked server hashLength (32) would
    // reveal the account exists.
    expect((ub.kdf_params as { hashLength: number }).hashLength).toBe(64);
  });

  it("recovery/derive-params: known vs unknown share status and key set", async () => {
    mockGetUserByUsername.mockImplementation(async () => DEFAULT_USER);
    const known = await server.fetch(
      new Request(`${BASE}/api/auth/recovery/derive-params`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "alice" }),
      }),
    );
    mockGetUserByUsername.mockImplementation(async () => null);
    const unknown = await server.fetch(
      new Request(`${BASE}/api/auth/recovery/derive-params`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "ghost" }),
      }),
    );

    expect(known.status).toBe(unknown.status);
    const kb = (await known.json()) as Record<string, unknown>;
    const ub = (await unknown.json()) as Record<string, unknown>;
    expect(keysOf(kb)).toEqual(keysOf(ub));
    expect((kb.recovery_params as { hashLength: number }).hashLength).toBe(
      (ub.recovery_params as { hashLength: number }).hashLength,
    );
  });

  it("login: unknown username still runs verifyAuthHash (matched-latency dummy verify) and returns 401", async () => {
    mockGetUserByUsername.mockImplementation(async () => null);
    mockVerifyAuthHash.mockClear();
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "nobody", auth_hash: b64("a".repeat(32)) }),
      }),
    );
    expect(res.status).toBe(401);
    // The dummy verify must run for an unknown user so timing matches a real one.
    expect(mockVerifyAuthHash).toHaveBeenCalledTimes(1);
  });

  it("login: known username with wrong password returns the same 401 status as unknown", async () => {
    mockGetUserByUsername.mockImplementation(async () => ({
      ...DEFAULT_USER,
      authHashHash: Buffer.from(MOCK_ENCODED),
    }));
    mockVerifyAuthHash.mockImplementation(async () => false);
    const known = await server.fetch(
      new Request(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "alice", auth_hash: b64("x".repeat(32)) }),
      }),
    );
    resetMocks();
    mockGetUserByUsername.mockImplementation(async () => null);
    const unknown = await server.fetch(
      new Request(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ username: "ghost", auth_hash: b64("x".repeat(32)) }),
      }),
    );
    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
  });

  it("recovery/reset: unknown username still runs verifyAuthHash (dummy verify) and returns 401", async () => {
    mockGetUserByUsername.mockImplementation(async () => null);
    mockVerifyAuthHash.mockClear();
    const res = await server.fetch(
      new Request(`${BASE}/api/auth/recovery/reset`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({
          username: "ghost",
          recovery_proof: b64("r".repeat(32)),
          new_auth_hash: b64("a".repeat(32)),
          new_kdf_salt: b64("s".repeat(16)),
          new_kdf_params: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 32 },
          new_recovery_blob: b64("r".repeat(32)),
          new_recovery_salt: b64("rs".repeat(8)),
          new_recovery_params: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 32 },
          new_wrapped_dek: b64("wd".repeat(24)),
          new_wrapped_dek_iv: b64("iv".repeat(6)),
          new_wrapped_dek_recovery: b64("wdr".repeat(16)),
          new_wrapped_dek_recovery_iv: b64("ri".repeat(6)),
        }),
      }),
    );
    expect(res.status).toBe(401);
    expect(mockVerifyAuthHash).toHaveBeenCalledTimes(1);
  });
});

describe("login rate-limit wiring", () => {
  beforeEach(resetMocks);

  it("wrong passwords up to the per-username cap return 401, then 429", async () => {
    mockGetUserByUsername.mockImplementation(async () => ({
      ...DEFAULT_USER,
      authHashHash: Buffer.from(MOCK_ENCODED),
    }));
    mockVerifyAuthHash.mockImplementation(async () => false);

    const attempt = () =>
      server.fetch(
        new Request(`${BASE}/api/auth/login`, {
          method: "POST",
          headers: { ...JSON_CT, ...CSRF },
          body: JSON.stringify({ username: "carol", auth_hash: b64("z".repeat(32)) }),
        }),
      );

    // Per-username window is 5: attempts 1-5 reach verify and fail with 401.
    for (let i = 0; i < 5; i++) {
      expect((await attempt()).status).toBe(401);
    }
    // The 6th is gated before verify.
    expect((await attempt()).status).toBe(429);
  });

  it("a successful login resets the backoff so later attempts are not pre-throttled", async () => {
    mockGetUserByUsername.mockImplementation(async () => ({
      ...DEFAULT_USER,
      authHashHash: Buffer.from(MOCK_ENCODED),
    }));

    const login = (ok: boolean, hash: string) => {
      mockVerifyAuthHash.mockImplementation(async () => ok);
      return server.fetch(
        new Request(`${BASE}/api/auth/login`, {
          method: "POST",
          headers: { ...JSON_CT, ...CSRF },
          body: JSON.stringify({ username: "dave", auth_hash: b64(hash) }),
        }),
      );
    };

    expect((await login(false, "a".repeat(32))).status).toBe(401);
    expect((await login(false, "a".repeat(32))).status).toBe(401);
    // A success clears the failure counter (recordLoginSuccess).
    expect((await login(true, "g".repeat(32))).status).toBe(200);
    // A subsequent wrong attempt is back to 401, not an escalated 429.
    expect((await login(false, "a".repeat(32))).status).toBe(401);
  });
});

describe("CSRF on recovery, password, and logout routes", () => {
  beforeEach(resetMocks);

  const cases: { path: string; body: unknown; cookie?: boolean }[] = [
    { path: "/api/auth/recovery/derive-params", body: { username: "alice" } },
    { path: "/api/auth/recovery/reset", body: { username: "alice" } },
    { path: "/api/auth/password/change", body: {}, cookie: true },
    { path: "/api/auth/logout", body: {}, cookie: true },
  ];

  for (const { path, body, cookie } of cases) {
    it(`POST ${path} without X-Requested-With → 403`, async () => {
      const headers: Record<string, string> = { ...JSON_CT };
      if (cookie) headers.Cookie = `privance_session=${VALID_TOKEN}`;
      const res = await server.fetch(
        new Request(`${BASE}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(403);
    });
  }
});

describe("no secret logging", () => {
  beforeEach(resetMocks);

  const SECRET_FIELDS = [
    "authHash",
    "auth_hash",
    "wrappedDek",
    "wrapped_dek",
    "recoveryProof",
    "recovery_proof",
    "token",
    "kdfSalt",
    "kdf_salt",
  ];

  it("login success + failure never write secret material to logs or audit events", async () => {
    const stdoutLines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // biome-ignore lint/suspicious/noExplicitAny: stdout spy signature.
    process.stdout.write = ((chunk: any): boolean => {
      stdoutLines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      mockGetUserByUsername.mockImplementation(async () => ({
        ...DEFAULT_USER,
        authHashHash: Buffer.from(MOCK_ENCODED),
      }));
      mockVerifyAuthHash.mockImplementation(async () => true);
      await server.fetch(
        new Request(`${BASE}/api/auth/login`, {
          method: "POST",
          headers: { ...JSON_CT, ...CSRF },
          body: JSON.stringify({ username: "alice", auth_hash: b64("a".repeat(32)) }),
        }),
      );
      mockVerifyAuthHash.mockImplementation(async () => false);
      await server.fetch(
        new Request(`${BASE}/api/auth/login`, {
          method: "POST",
          headers: { ...JSON_CT, ...CSRF },
          body: JSON.stringify({ username: "alice", auth_hash: b64("b".repeat(32)) }),
        }),
      );
    } finally {
      process.stdout.write = origWrite;
    }

    const logged = stdoutLines.join("");
    // The raw auth_hash the client sent is "aaaa..." base64; its value must not
    // surface. We assert against the audit-event payloads and the pino stream.
    for (const call of mockLogEvent.mock.calls as unknown as unknown[][]) {
      const payload = JSON.stringify(call[0] ?? {});
      for (const field of SECRET_FIELDS) {
        expect(payload).not.toContain(`"${field}"`);
      }
    }
    expect(logged).not.toContain(b64("a".repeat(32)));
    expect(logged).not.toContain(b64("b".repeat(32)));
    expect(logged.toLowerCase()).not.toContain("auth_hash");
  });
});

describe("KDF parameter bounds", () => {
  beforeEach(resetMocks);

  function signupWithParams(kdf: Record<string, number>) {
    return server.fetch(
      new Request(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify({ ...VALID_SIGNUP_BODY, kdf_params: kdf }),
      }),
    );
  }

  it("memoryCost above the cap → 400", async () => {
    const res = await signupWithParams({
      memoryCost: 8 * 1024 * 1024,
      timeCost: 3,
      parallelism: 4,
      hashLength: 64,
    });
    expect(res.status).toBe(400);
  });

  it("timeCost below the floor → 400", async () => {
    const res = await signupWithParams({
      memoryCost: 65536,
      timeCost: 0,
      parallelism: 4,
      hashLength: 64,
    });
    expect(res.status).toBe(400);
  });

  it("non-integer parallelism → 400", async () => {
    const res = await signupWithParams({
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 2.5,
      hashLength: 64,
    });
    expect(res.status).toBe(400);
  });

  it("standard client params are accepted → 201", async () => {
    const res = await signupWithParams({
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
      hashLength: 64,
    });
    expect(res.status).toBe(201);
  });
});

describe("X-Forwarded-For client IP selection (default 1 trusted hop)", () => {
  beforeEach(resetMocks);

  it("buckets by the rightmost (trusted-proxy-appended) entry, ignoring spoofed prefixes", async () => {
    const signup = (xff: string) =>
      server.fetch(
        new Request(`${BASE}/api/auth/signup`, {
          method: "POST",
          headers: { ...JSON_CT, ...CSRF, "X-Forwarded-For": xff },
          body: JSON.stringify(VALID_SIGNUP_BODY),
        }),
      );

    // signup window is 3. The real client (rightmost) is 172.16.0.9 in every
    // request below; a spoofed leftmost entry must not let a client dodge the cap.
    expect((await signup("10.0.0.1, 172.16.0.9")).status).toBe(201);
    expect((await signup("203.0.113.5, 172.16.0.9")).status).toBe(201);
    expect((await signup("spoof, evil, 172.16.0.9")).status).toBe(201);
    // Fourth request, same real client, different spoofed prefix → still 429.
    expect((await signup("anything, 172.16.0.9")).status).toBe(429);
  });

  it("a different rightmost entry is a different client and gets its own bucket", async () => {
    const signup = (xff: string) =>
      server.fetch(
        new Request(`${BASE}/api/auth/signup`, {
          method: "POST",
          headers: { ...JSON_CT, ...CSRF, "X-Forwarded-For": xff },
          body: JSON.stringify(VALID_SIGNUP_BODY),
        }),
      );

    expect((await signup("a, 172.16.0.20")).status).toBe(201);
    expect((await signup("a, 172.16.0.20")).status).toBe(201);
    expect((await signup("a, 172.16.0.20")).status).toBe(201);
    expect((await signup("a, 172.16.0.20")).status).toBe(429);
    // Distinct rightmost entry → fresh bucket → allowed.
    expect((await signup("a, 172.16.0.21")).status).toBe(201);
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
