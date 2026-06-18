import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Other auth test files register mock.module("./repo.js"); `?real` bypasses
// that override so this integration test runs the genuine AuthRepo SQL.
// TS can't model bun's query-suffixed specifier, so the runtime import is cast.
const { AuthRepo } = (await import(
  // @ts-expect-error bun resolves the `?real` suffix to the real module at runtime.
  "./repo.ts?real"
)) as typeof import("./repo.js");

// Integration tests for the invite-token claim invariant against real Postgres.
// The single-use + expiry guarantee lives in claimInviteToken's atomic UPDATE
// WHERE (usedAt IS NULL AND not expired), so it can only be proven end-to-end,
// not through the service test that mocks claimInviteToken.
//
// `?real` bypasses any mock.module("./repo.js") another auth test file registers.
const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://privance:privance@localhost:5432/privance",
);
const db = drizzle(sql);
const repo = new AuthRepo(db);

const CREATED_BY = "invite-repo-test";

async function cleanTestRows(): Promise<void> {
  await sql`DELETE FROM invite_tokens WHERE created_by = ${CREATED_BY}`;
}

beforeEach(async () => {
  await cleanTestRows();
});

afterAll(async () => {
  await cleanTestRows();
  await sql.end();
});

function freshTokenHash(): Buffer {
  return Buffer.from(randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""), "hex");
}

describe("AuthRepo.claimInviteToken (single-use)", () => {
  it("a fresh token claims once, then a second claim returns null", async () => {
    const tokenHash = freshTokenHash();
    await repo.createInviteToken({ tokenHash, createdBy: CREATED_BY });
    const now = new Date();

    const first = await repo.claimInviteToken({ tokenHash, userId: randomUUID(), now });
    expect(first).not.toBeNull();

    const second = await repo.claimInviteToken({ tokenHash, userId: randomUUID(), now });
    expect(second).toBeNull();
  });

  it("an unknown token hash never claims", async () => {
    const result = await repo.claimInviteToken({
      tokenHash: freshTokenHash(),
      userId: randomUUID(),
      now: new Date(),
    });
    expect(result).toBeNull();
  });
});

describe("AuthRepo.claimInviteToken (expiry)", () => {
  it("an expired token cannot be claimed", async () => {
    const tokenHash = freshTokenHash();
    await repo.createInviteToken({
      tokenHash,
      createdBy: CREATED_BY,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await repo.claimInviteToken({
      tokenHash,
      userId: randomUUID(),
      now: new Date(),
    });
    expect(result).toBeNull();
  });

  it("a not-yet-expired token claims successfully", async () => {
    const tokenHash = freshTokenHash();
    await repo.createInviteToken({
      tokenHash,
      createdBy: CREATED_BY,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await repo.claimInviteToken({
      tokenHash,
      userId: randomUUID(),
      now: new Date(),
    });
    expect(result).not.toBeNull();
  });
});
