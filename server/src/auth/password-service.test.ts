import { describe, expect, it, mock } from "bun:test";

// Mock ./kdf.js rather than hash-wasm to avoid poisoning the global module
// cache for packages/core tests that need the real hash-wasm in the same run.
const MOCK_ENCODED = "$argon2id$v=19$m=65536,t=3,p=4$abc$def";
const mockVerifyAuthHash = mock(async (): Promise<boolean> => true);
mock.module("./kdf.js", () => ({
  hashAuthHash: async () => ({ hash: MOCK_ENCODED, salt: Buffer.from("mocksalt") }),
  verifyAuthHash: mockVerifyAuthHash,
  generateSessionToken: () => ({
    token: Buffer.alloc(32, 0xcd).toString("base64url").replace(/=/g, ""),
    raw: Buffer.alloc(32, 0xcd),
  }),
  hashSessionToken: (raw: Buffer) => raw,
  decodeSessionToken: (encoded: string) => {
    const padded = encoded + "=".repeat(-encoded.length & 3);
    return Buffer.from(padded, "base64url");
  },
  deriveFakeKdfSalt: () => Buffer.alloc(16, 0x11),
  deriveFakeRecoveryBlob: () => ({
    wrappedBlob: Buffer.alloc(48, 0x22),
    blobIv: Buffer.alloc(12, 0x33),
  }),
  SERVER_KDF_PARAMS: { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 32 },
}));

import { PasswordService } from "./password-service.js";
import type { SessionRow, UserRow } from "./repo.js";
import type { AuthenticatedSession, KdfParamsJson } from "./types.js";
import { InvalidCredentialsError } from "./types.js";

const DEFAULT_KDF: KdfParamsJson = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
};

const DEFAULT_SESSION: SessionRow = {
  sessionId: "sess-1",
  userId: "user-1",
  tokenHash: Buffer.from("th"),
  expiresAt: new Date(Date.now() + 86400_000),
  revokedAt: null,
};

const DEFAULT_USER: UserRow = {
  userId: "user-1",
  username: "alice",
  authHashHash: Buffer.from("hash"),
  kdfParams: DEFAULT_KDF,
  recoveryBlob: Buffer.from("blob"),
  recoverySalt: Buffer.from("rsalt"),
  recoveryParams: DEFAULT_KDF,
  wrappedDek: Buffer.from("wdek"),
  wrappedDekIv: Buffer.from("wdekiv"),
  wrappedDekRecovery: Buffer.alloc(48, 0xaa),
  wrappedDekRecoveryIv: Buffer.alloc(12, 0xbb),
  kdfSalt: Buffer.from("kdfsalt"),
};

// Two live sessions for user-1. rotateCredentials revokes all of them.
function makeSessions(): SessionRow[] {
  return [
    { ...DEFAULT_SESSION, sessionId: "sess-1", revokedAt: null },
    { ...DEFAULT_SESSION, sessionId: "sess-2", revokedAt: null },
  ];
}

function makeRepo(liveSessions: SessionRow[] = makeSessions()) {
  return {
    getUserByUsername: mock(async (): Promise<UserRow | null> => DEFAULT_USER),
    getUserAuthHashById: mock(async (): Promise<Buffer | null> => Buffer.from(MOCK_ENCODED)),
    createUser: mock(async (): Promise<UserRow> => DEFAULT_USER),
    updateUserCredentials: mock(async (): Promise<void> => undefined),
    rotateCredentials: mock(async (): Promise<SessionRow> => {
      for (const s of liveSessions) s.revokedAt = new Date();
      const fresh = { ...DEFAULT_SESSION, sessionId: "sess-new", revokedAt: null };
      liveSessions.push(fresh);
      return fresh;
    }),
    createSession: mock(async (): Promise<SessionRow> => DEFAULT_SESSION),
    getSessionByTokenHash: mock(async (): Promise<SessionRow | null> => DEFAULT_SESSION),
    touchSession: mock(async (): Promise<void> => undefined),
    revokeSession: mock(async (): Promise<void> => undefined),
    logEvent: mock(async (): Promise<void> => undefined),
  };
}

const AUTH: AuthenticatedSession = {
  userId: "user-1",
  sessionId: "sess-1",
  expiresAt: new Date(Date.now() + 86400_000),
};

const CHANGE_OPTS = {
  currentAuthHash: Buffer.alloc(32, 0x99),
  newAuthHash: Buffer.alloc(32, 0xab),
  newKdfSalt: Buffer.alloc(16, 0x01),
  newKdfParams: DEFAULT_KDF,
  newRecoveryBlob: Buffer.alloc(48, 0x02),
  newRecoverySalt: Buffer.alloc(12, 0x03),
  newRecoveryParams: DEFAULT_KDF,
  newWrappedDek: Buffer.alloc(48, 0x04),
  newWrappedDekIv: Buffer.alloc(12, 0x05),
  newWrappedDekRecovery: Buffer.alloc(48, 0x06),
  newWrappedDekRecoveryIv: Buffer.alloc(12, 0x07),
};

describe("PasswordService.changePassword", () => {
  it("rotates credentials, revokes ALL the user's sessions, and issues a new token", async () => {
    mockVerifyAuthHash.mockResolvedValueOnce(true);
    const sessions = makeSessions();
    const repo = makeRepo(sessions);
    const svc = new PasswordService({ repo: repo as never });

    const result = await svc.changePassword(AUTH, CHANGE_OPTS);

    expect(typeof result.token).toBe("string");
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(repo.rotateCredentials).toHaveBeenCalledTimes(1);
    // Both originally-live sessions are now revoked, not just the caller's.
    expect(sessions.find((s) => s.sessionId === "sess-1")?.revokedAt).not.toBeNull();
    expect(sessions.find((s) => s.sessionId === "sess-2")?.revokedAt).not.toBeNull();
    // The new session is the only live one.
    expect(sessions.filter((s) => s.revokedAt === null).map((s) => s.sessionId)).toEqual([
      "sess-new",
    ]);
    expect(repo.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventClass: "password_changed" }),
    );
  });

  it("rejects a wrong current password and changes nothing", async () => {
    mockVerifyAuthHash.mockResolvedValueOnce(false);
    const repo = makeRepo();
    const svc = new PasswordService({ repo: repo as never });

    await expect(svc.changePassword(AUTH, CHANGE_OPTS)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );

    expect(repo.rotateCredentials).not.toHaveBeenCalled();
  });

  it("rolls back atomically: if the session insert fails, nothing is committed", async () => {
    mockVerifyAuthHash.mockResolvedValueOnce(true);
    const sessions = makeSessions();
    const repo = makeRepo(sessions);
    // Simulate the transaction failing at the new-session insert step: the
    // update + revoke are staged but discarded, so no observable state changes.
    repo.rotateCredentials.mockImplementation(async () => {
      throw new Error("createSession failed");
    });
    const svc = new PasswordService({ repo: repo as never });

    await expect(svc.changePassword(AUTH, CHANGE_OPTS)).rejects.toThrow("createSession failed");

    // Rotation threw inside the transaction; the original sessions stay live and
    // no password_changed audit/log side-effect fires after the failed commit.
    expect(sessions.every((s) => s.revokedAt === null)).toBe(true);
    expect(repo.logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventClass: "password_changed" }),
    );
  });
});
