import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomInt, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Bypass the process-global repo mock registered by wire.test.ts.
const { SyncRepo } = (await import(
  // @ts-expect-error bun resolves the `?real` suffix to the real module at runtime.
  "./repo.ts?real"
)) as typeof import("./repo.js");
const { ConflictError } = await import("./types.js");

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://privance:privance@localhost:5432/privance";
// Each writer, the observer, and the trigger gate must have independent sessions.
const observer = postgres(databaseUrl, { max: 1 });
const first = postgres(databaseUrl, { max: 1 });
const second = postgres(databaseUrl, { max: 1 });
const gate = postgres(databaseUrl, { max: 1 });
const firstRepo = new SyncRepo(drizzle(first));
const secondRepo = new SyncRepo(drizzle(second));
const reader = new SyncRepo(drizzle(observer));
const suffix = randomUUID().replaceAll("-", "");
const userId = `sync-repo-pg-${suffix}`;
const triggerName = `sync_repo_gate_${suffix}`;
const gateKey = randomInt(1, 2 ** 31 - 1);
const gateNamespace = 1937337955;
let firstPid: number;
let secondPid: number;
let gatePid: number;

function putInput(objectId: string, version = 1n, prevVersion?: bigint) {
  return {
    userId,
    objectId,
    kind: "account",
    ciphertext: Buffer.from(`revision-${version}`),
    nonce: Buffer.alloc(12, 7),
    version,
    ...(prevVersion !== undefined ? { prevVersion } : {}),
  };
}

async function blockers(pid: number): Promise<number[]> {
  const [row] = await observer<{ pids: number[] }[]>`
    SELECT pg_blocking_pids(${pid}) AS pids
  `;
  return row?.pids ?? [];
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for PostgreSQL writer barrier");
    await Bun.sleep(5);
  }
}

beforeAll(async () => {
  const backendPid = async (connection: typeof first) => {
    const [row] = await connection<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    if (!row) throw new Error("Missing PostgreSQL backend PID");
    return row.pid;
  };
  [firstPid, secondPid, gatePid] = await Promise.all([
    backendPid(first),
    backendPid(second),
    backendPid(gate),
  ]);
  // BEFORE triggers run after the INSERT/UPDATE sequence expression, but before
  // the row is written. Only this test's first writer and tenant can be delayed.
  await observer.unsafe(`
    CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.user_id = '${userId}' AND pg_backend_pid() = ${firstPid} THEN
        PERFORM pg_advisory_xact_lock(${gateNamespace}, ${gateKey});
      END IF;
      RETURN NEW;
    END $$
  `);
  await observer.unsafe(`
    CREATE TRIGGER ${triggerName} BEFORE INSERT OR UPDATE ON sync_objects
    FOR EACH ROW EXECUTE FUNCTION ${triggerName}()
  `);
});

beforeEach(async () => {
  await observer`DELETE FROM sync_objects WHERE user_id = ${userId}`;
});

afterAll(async () => {
  // Release the barrier even if a test/setup assertion failed.
  await gate`SELECT pg_advisory_unlock_all()`;
  try {
    await observer.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON sync_objects`);
    await observer.unsafe(`DROP FUNCTION IF EXISTS ${triggerName}()`);
    await observer`DELETE FROM sync_objects WHERE user_id = ${userId}`;
  } finally {
    await Promise.all([first.end(), second.end(), observer.end(), gate.end()]);
  }
});

// Hold the first write after sequence allocation. Start the second only once
// PG confirms that barrier; inspect once it either blocks or finishes. No race
// depends on guessed sleep durations or on reaching into private repo methods.
async function overlap(
  startFirst: () => Promise<unknown>,
  startSecond: () => Promise<unknown>,
  during?: () => Promise<void>,
): Promise<PromiseSettledResult<unknown>[]> {
  await gate`SELECT pg_advisory_lock(${gateNamespace}, ${gateKey})`;
  const pending: Promise<unknown>[] = [];
  try {
    const firstWrite = startFirst();
    pending.push(firstWrite);
    // Attach rejection handlers immediately, including on a barrier timeout.
    void firstWrite.catch(() => {});
    await waitUntil(async () => (await blockers(firstPid)).includes(gatePid));
    let secondSettled = false;
    const secondWrite = startSecond().finally(() => {
      secondSettled = true;
    });
    pending.push(secondWrite);
    void secondWrite.catch(() => {});
    await waitUntil(async () => secondSettled || (await blockers(secondPid)).length > 0);
    await during?.();
  } finally {
    await gate`SELECT pg_advisory_unlock(${gateNamespace}, ${gateKey})`;
    // Drain even on failed assertions before dropping triggers or deleting rows.
    await Promise.allSettled(pending);
  }
  return Promise.allSettled(pending);
}

describe("SyncRepo PostgreSQL transaction ordering", () => {
  for (const mode of ["put", "delete", "batch"] as const) {
    it(`${mode}: a pull cursor cannot pass a delayed lower-sequence write`, async () => {
      let since = 0n;
      if (mode === "delete") {
        await firstRepo.put(putInput("slow"));
        since = (await firstRepo.put(putInput("fast"))).serverSeq;
      }
      const write = (repo: InstanceType<typeof SyncRepo>, objectId: string) => {
        if (mode === "delete") return repo.delete({ userId, objectId, prevVersion: 1n });
        if (mode === "batch") {
          return repo.batch({ userId, puts: [putInput(objectId)], deletes: [] });
        }
        return repo.put(putInput(objectId));
      };
      const results = await overlap(
        () => write(firstRepo, "slow"),
        () => write(secondRepo, "fast"),
        async () => {
          const page = await reader.changes({ userId, since, limit: 1 });
          expect(page.changes).toEqual([]);
          expect(page.next).toBeNull();
        },
      );
      expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
      const page = await reader.changes({ userId, since, limit: 1 });
      expect(page.changes.map((change) => change.id)).toEqual(["slow"]);
      const slow = page.changes[0];
      if (!slow) throw new Error("Expected the delayed write in the first page");
      expect(page.next).toBe(slow.serverSeq);
      if (page.next === null) throw new Error("Expected a second page");
      const next = await reader.changes({ userId, since: page.next, limit: 1 });
      expect(next.changes.map((change) => change.id)).toEqual(["fast"]);
      expect(next.changes[0]?.tombstone).toBe(mode === "delete");
      expect(next.next).toBeNull();
    });
  }

  it("competing updates with the same predecessor have exactly one winner", async () => {
    await firstRepo.put(putInput("race"));
    const results = await overlap(
      () => firstRepo.put(putInput("race", 2n, 1n)),
      () => secondRepo.put({ ...putInput("race", 2n, 1n), ciphertext: Buffer.from("loser") }),
    );
    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { currentVersion: 2n },
    });
    if (results[1]?.status === "rejected") expect(results[1].reason).toBeInstanceOf(ConflictError);
    const row = await reader.get({ userId, objectId: "race" });
    expect(row.version).toBe(2n);
    expect(row.ciphertext).toEqual(Buffer.from("revision-2"));
  });

  it("competing creates cannot both succeed, including a batch creator", async () => {
    const results = await overlap(
      () => firstRepo.put(putInput("race")),
      () => secondRepo.batch({ userId, puts: [putInput("race")], deletes: [] }),
    );
    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]).toEqual({
      status: "fulfilled",
      value: { results: [{ id: "race", ok: false, conflict: { currentVersion: 1n } }] },
    });
    expect((await reader.get({ userId, objectId: "race" })).version).toBe(1n);
  });

  for (const deleteFirst of [false, true]) {
    it(`competing update/delete checks the committed predecessor (delete first: ${deleteFirst})`, async () => {
      await firstRepo.put(putInput("race"));
      const update = (repo: InstanceType<typeof SyncRepo>) => repo.put(putInput("race", 2n, 1n));
      const remove = (repo: InstanceType<typeof SyncRepo>) =>
        repo.delete({ userId, objectId: "race", prevVersion: 1n });
      const results = await overlap(
        () => (deleteFirst ? remove(firstRepo) : update(firstRepo)),
        () => (deleteFirst ? update(secondRepo) : remove(secondRepo)),
      );
      expect(results[0]?.status).toBe("fulfilled");
      expect(results[1]).toMatchObject({ status: "rejected", reason: { currentVersion: 2n } });
      if (results[1]?.status === "rejected")
        expect(results[1].reason).toBeInstanceOf(ConflictError);
      const row = await reader.get({ userId, objectId: "race" });
      expect(row.version).toBe(2n);
      expect(row.tombstone).toBe(deleteFirst);
    });
  }

  it("delete advances the version and rejects stale post-delete updates", async () => {
    const created = await firstRepo.put(putInput("deleted"));
    const deleted = await secondRepo.delete({ userId, objectId: "deleted", prevVersion: 1n });
    expect(deleted.version).toBe(2n);
    expect(deleted.serverSeq).toBeGreaterThan(created.serverSeq);
    await expect(firstRepo.put(putInput("deleted", 2n, 1n))).rejects.toMatchObject({
      currentVersion: 2n,
    });
    const row = await reader.get({ userId, objectId: "deleted" });
    expect(row.tombstone).toBe(true);
    expect(row.version).toBe(2n);
    const page = await reader.changes({ userId, since: created.serverSeq, limit: 10 });
    expect(page.changes).toMatchObject([{ id: "deleted", tombstone: true, version: 2n }]);
  });

  it("batch deletes return the actual tombstone version exposed by the change feed", async () => {
    const created = await firstRepo.put(putInput("deleted", 7n));
    const batch = await secondRepo.batch({
      userId,
      puts: [],
      deletes: [{ objectId: "deleted", prevVersion: 7n }],
    });
    const row = await reader.get({ userId, objectId: "deleted" });
    expect(row.version).toBe(8n);
    expect(row.tombstone).toBe(true);
    expect(batch.results).toEqual([
      { id: "deleted", ok: true, serverSeq: row.serverSeq, version: row.version },
    ]);
    const page = await reader.changes({ userId, since: created.serverSeq, limit: 10 });
    expect(page.changes).toMatchObject([
      { id: "deleted", tombstone: true, version: 8n, serverSeq: row.serverSeq },
    ]);
    await expect(firstRepo.put(putInput("deleted", 8n, 7n))).rejects.toMatchObject({
      currentVersion: 8n,
    });
  });
});
