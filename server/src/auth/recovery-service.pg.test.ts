import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { CLIENT_KDF_PARAMS } from "./kdf.js";
import { LoginService } from "./login-service.js";
import { RecoveryService } from "./recovery-service.js";
import { SessionService } from "./session-service.js";
import { SignupService } from "./signup-service.js";
import { InvalidCredentialsError, RecoveryFailedError, UnauthenticatedError } from "./types.js";

// Run with --isolate (as in scripts/test.ts) so other auth tests' KDF mocks
// cannot replace the real signup hashing used for the response-shape regression.
const { AuthRepo, purgeUserData } = (await import(
  // @ts-expect-error bun resolves the `?real` suffix to the real module at runtime.
  "./repo.ts?real"
)) as typeof import("./repo.js");
const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://privance:privance@localhost:5432/privance",
);
const db = drizzle(sql);
const repo = new AuthRepo(db);
const enumerationSecret = randomBytes(32);
const recovery = new RecoveryService({ repo, enumerationSecret });
const login = new LoginService({ repo, enumerationSecret });
const session = new SessionService({ repo });
const signup = new SignupService({ repo, allowedUsernames: new Set() });
const username = `recovery-${randomUUID()}`;
const credentials = {
  authHash: randomBytes(32),
  kdfSalt: randomBytes(16),
  kdfParams: CLIENT_KDF_PARAMS,
  recoveryBlob: randomBytes(32),
  recoverySalt: randomBytes(16),
  recoveryParams: CLIENT_KDF_PARAMS,
  wrappedDek: randomBytes(48),
  wrappedDekIv: randomBytes(12),
  wrappedDekRecovery: randomBytes(48),
  wrappedDekRecoveryIv: randomBytes(12),
};
let signupResult: Awaited<ReturnType<SignupService["signup"]>>;

beforeEach(async () => {
  signupResult = await signup.signup({ username, ...credentials });
});

afterEach(async () => {
  const user = await repo.getUserByUsername(username);
  if (user) await db.transaction((tx) => purgeUserData({ tx, userId: user.userId }));
});

afterAll(async () => {
  await sql.end();
});

function verifierShape(blob: Buffer) {
  const encoded = blob.toString("utf8");
  expect(encoded).toMatch(
    /^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
  );
  const fields = encoded.split("$");
  for (const [value, length] of [
    [fields[4] ?? "", 16],
    [fields[5] ?? "", 32],
  ] as const) {
    expect(Buffer.from(value, "base64")).toHaveLength(length);
    expect(Buffer.from(value, "base64").toString("base64").replace(/=+$/, "")).toBe(value);
  }
  return { prefix: fields.slice(0, 4), lengths: fields.slice(4).map((value) => value.length) };
}

function responseShape(params: Awaited<ReturnType<RecoveryService["getRecoveryParams"]>>) {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Buffer.isBuffer(value)
        ? { bytes: value.length, base64Length: value.toString("base64").length }
        : value,
    ]),
  );
}

describe("RecoveryService with real signup credentials", () => {
  it("unknown responses match real salt lengths, PHC encoding, parameters, and every field shape", async () => {
    const known = await recovery.getRecoveryParams(username);
    const unknown = await recovery.getRecoveryParams(`${username}-unknown`);

    expect(known.kdfSalt).toEqual(credentials.kdfSalt);
    expect(known.recoverySalt).toEqual(credentials.recoverySalt);
    expect(known.recoverySalt).toHaveLength(16);
    expect(unknown.recoverySalt).toHaveLength(known.recoverySalt.length);
    const realVerifierShape = verifierShape(known.recoveryBlob);
    expect(verifierShape(unknown.recoveryBlob)).toEqual(realVerifierShape);
    expect(responseShape(unknown)).toEqual(responseShape(known));
  });

  it("unknown responses are deterministic, case-insensitive, and distinct per username", async () => {
    const first = await recovery.getRecoveryParams(`${username}-ghost`);
    const repeated = await recovery.getRecoveryParams(`${username}-ghost`);
    const upperCase = await recovery.getRecoveryParams(`${username}-ghost`.toUpperCase());
    const other = await recovery.getRecoveryParams(`${username}-other`);

    expect(repeated).toEqual(first);
    expect(upperCase).toEqual(first);
    for (const key of [
      "kdfSalt",
      "recoverySalt",
      "recoveryBlob",
      "wrappedDekRecovery",
      "wrappedDekRecoveryIv",
    ] as const) {
      expect(other[key]).not.toEqual(first[key]);
    }
  });

  it("retains signup/login and recovery reset, revoking old sessions and accepting only new credentials", async () => {
    const loggedIn = await login.login({ username, authHash: credentials.authHash });
    expect(loggedIn.wrappedDek).toEqual(credentials.wrappedDek);
    const newAuthHash = randomBytes(32);
    const newRecoveryBlob = randomBytes(32);
    const resetInput = {
      username,
      recoveryProof: credentials.recoveryBlob,
      newAuthHash,
      newKdfSalt: randomBytes(16),
      newKdfParams: CLIENT_KDF_PARAMS,
      newRecoveryBlob,
      newRecoverySalt: randomBytes(16),
      newRecoveryParams: CLIENT_KDF_PARAMS,
      newWrappedDek: randomBytes(48),
      newWrappedDekIv: randomBytes(12),
      newWrappedDekRecovery: randomBytes(48),
      newWrappedDekRecoveryIv: randomBytes(12),
    };
    const reset = await recovery.recoveryReset(resetInput);

    await expect(session.validateToken(signupResult.token)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(session.validateToken(loggedIn.token)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect((await session.validateToken(reset.token)).userId).toBe(signupResult.userId);
    await expect(login.login({ username, authHash: credentials.authHash })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect((await login.login({ username, authHash: newAuthHash })).wrappedDek).toEqual(
      resetInput.newWrappedDek,
    );
    const params = await recovery.getRecoveryParams(username);
    expect(params.recoverySalt).toEqual(resetInput.newRecoverySalt);
    expect(params.wrappedDekRecovery).toEqual(resetInput.newWrappedDekRecovery);
    verifierShape(params.recoveryBlob);
    await expect(recovery.recoveryReset(resetInput)).rejects.toBeInstanceOf(RecoveryFailedError);
    const secondReset = await recovery.recoveryReset({
      ...resetInput,
      recoveryProof: newRecoveryBlob,
    });
    expect((await session.validateToken(secondReset.token)).userId).toBe(signupResult.userId);
  });
});
