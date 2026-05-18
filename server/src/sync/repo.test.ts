import { describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Repo unit tests: covers class instantiation, logEvent (no DB dependency),
// and constructor shape. Full integration-level coverage (actual SQL) requires
// a running Postgres and is covered by E2E tests.
// ---------------------------------------------------------------------------

mock.module("../core/db.js", () => ({ db: {} }));

const { SyncRepo } = await import("./repo.js");

describe("SyncRepo", () => {
  it("instantiates with a db dependency", () => {
    const repo = new SyncRepo(
      {} as Parameters<typeof SyncRepo.prototype.get>[0] extends never
        ? never
        : // biome-ignore lint/suspicious/noExplicitAny: test-only stub
          any,
    );
    expect(repo).toBeInstanceOf(SyncRepo);
  });

  it("logEvent resolves without error (stub implementation, no DB)", async () => {
    const repo = new SyncRepo(
      // biome-ignore lint/suspicious/noExplicitAny: test-only stub
      {} as any,
    );
    await expect(
      repo.logEvent({ userId: "user-1", eventClass: "login_succeeded" }),
    ).resolves.toBeUndefined();
  });
});
