import { describe, expect, it, mock } from "bun:test";

// Mock ./kdf.js rather than hash-wasm to avoid poisoning the global module
// cache for packages/core tests that need the real hash-wasm in the same run.
const MOCK_ENCODED = "$argon2id$v=19$m=65536,t=3,p=4$abc$def";
mock.module("./kdf.js", () => ({
  hashAuthHash: async () => ({ hash: MOCK_ENCODED, salt: Buffer.from("mocksalt") }),
  verifyAuthHash: async () => true,
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

function makeRepo() {
  return {
    getUserByUsername: mock(async (): Promise<UserRow | null> => DEFAULT_USER),
    createUser: mock(async (): Promise<UserRow> => DEFAULT_USER),
    updateUserCredentials: mock(async (): Promise<void> => undefined),
    createSession: mock(async (): Promise<SessionRow> => DEFAULT_SESSION),
    getSessionByTokenHash: mock(async (): Promise<SessionRow | null> => DEFAULT_SESSION),
    touchSession: mock(async (): Promise<void> => undefined),
    revokeSession: mock(async (): Promise<void> => undefined),
    revokeAllUserSessions: mock(async (): Promise<void> => undefined),
    logEvent: mock(async (): Promise<void> => undefined),
  };
}

describe("PasswordService.changePassword", () => {
  it("rotates credentials and issues a new session token", async () => {
    const repo = makeRepo();
    const svc = new PasswordService(repo as never);

    const auth: AuthenticatedSession = {
      userId: "user-1",
      sessionId: "sess-1",
      expiresAt: new Date(Date.now() + 86400_000),
    };

    const result = await svc.changePassword(auth, {
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
    });

    expect(typeof result.token).toBe("string");
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(repo.updateUserCredentials).toHaveBeenCalledTimes(1);
    expect(repo.revokeSession).toHaveBeenCalledWith("sess-1");
    expect(repo.createSession).toHaveBeenCalledTimes(1);
    expect(repo.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventClass: "password_changed" }),
    );
  });
});
