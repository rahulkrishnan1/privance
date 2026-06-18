import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { SyncRepo } from "./repo.js";
import { SyncService } from "./sync-service.js";
import { ConflictError, NotFoundError } from "./types.js";

// Test strategy: mock SyncRepo entirely.
//
// Rationale: the service layer contains the conflict-check logic that we need
// to verify; the repo translates that to SQL. Using a real Postgres would make
// these tests slow and require a running DB. Integration-level correctness
// (repo to Postgres) is validated by running drizzle-kit generate + a manual
// integration pass. Service tests cover the conflict-check logic without a DB.
function buf(s: string): Buffer {
  return Buffer.from(s, "utf-8");
}

function makeMockRepo(): SyncRepo {
  return {
    put: mock(async () => ({ serverSeq: 1n, version: 1n })),
    get: mock(async () => ({
      objectId: "obj-1",
      kind: "account",
      ciphertext: buf("ct"),
      nonce: buf("nonce"),
      version: 1n,
      serverSeq: 1n,
      tombstone: false,
    })),
    delete: mock(async () => {}),
    changes: mock(async () => ({ changes: [], next: null })),
    batch: mock(async () => ({ results: [] })),
  } as unknown as SyncRepo;
}

function makeService(repo: SyncRepo): SyncService {
  return new SyncService({ repo });
}

describe("SyncService.put", () => {
  let repo: SyncRepo;
  let service: SyncService;

  beforeEach(() => {
    repo = makeMockRepo();
    service = makeService(repo);
  });

  it("put new object returns server_seq and version", async () => {
    (repo.put as ReturnType<typeof mock>).mockResolvedValue({ serverSeq: 7n, version: 1n });

    const result = await service.put({
      userId: "user-a",
      objectId: "obj-1",
      kind: "account",
      ciphertext: buf("ct"),
      nonce: buf("nonce"),
      version: 1n,
    });

    expect(result.serverSeq).toBe(7n);
    expect(result.version).toBe(1n);
  });

  it("put with stale prev_version propagates ConflictError", async () => {
    (repo.put as ReturnType<typeof mock>).mockRejectedValue(new ConflictError("obj-1", 3n));

    await expect(
      service.put({
        userId: "user-a",
        objectId: "obj-1",
        kind: "account",
        ciphertext: buf("ct"),
        nonce: buf("nonce"),
        version: 5n,
        prevVersion: 2n,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("put with matching prev_version succeeds", async () => {
    (repo.put as ReturnType<typeof mock>).mockResolvedValue({ serverSeq: 10n, version: 4n });

    const result = await service.put({
      userId: "user-a",
      objectId: "obj-1",
      kind: "account",
      ciphertext: buf("ct"),
      nonce: buf("nonce"),
      version: 4n,
      prevVersion: 3n,
    });

    expect(result.serverSeq).toBe(10n);
    expect(result.version).toBe(4n);
  });

  it("delegates put to repo and returns its result", async () => {
    (repo.put as ReturnType<typeof mock>).mockResolvedValue({ serverSeq: 9n, version: 2n });

    const result = await service.put({
      userId: "user-a",
      objectId: "obj-1",
      kind: "account",
      ciphertext: buf("ct"),
      nonce: buf("nonce"),
      version: 1n,
    });

    expect(repo.put).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ serverSeq: 9n, version: 2n });
  });
});

describe("SyncService.get", () => {
  let repo: SyncRepo;
  let service: SyncService;

  beforeEach(() => {
    repo = makeMockRepo();
    service = makeService(repo);
  });

  it("returns the object when found", async () => {
    (repo.get as ReturnType<typeof mock>).mockResolvedValue({
      objectId: "obj-1",
      kind: "account",
      ciphertext: buf("ct"),
      nonce: buf("nonce"),
      version: 2n,
      serverSeq: 5n,
      tombstone: false,
    });

    const result = await service.get({ userId: "user-a", objectId: "obj-1" });
    expect(result.objectId).toBe("obj-1");
    expect(result.version).toBe(2n);
    expect(result.tombstone).toBe(false);
  });

  it("propagates NotFoundError when missing", async () => {
    (repo.get as ReturnType<typeof mock>).mockRejectedValue(new NotFoundError("obj-99"));

    await expect(service.get({ userId: "user-a", objectId: "obj-99" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("SyncService.delete", () => {
  let repo: SyncRepo;
  let service: SyncService;

  beforeEach(() => {
    repo = makeMockRepo();
    service = makeService(repo);
  });

  it("calls repo.delete with the input", async () => {
    await service.delete({ userId: "user-a", objectId: "obj-1", prevVersion: 2n });
    expect(repo.delete).toHaveBeenCalledWith({
      userId: "user-a",
      objectId: "obj-1",
      prevVersion: 2n,
    });
  });

  it("propagates ConflictError on stale version", async () => {
    (repo.delete as ReturnType<typeof mock>).mockRejectedValue(new ConflictError("obj-1", 3n));

    await expect(
      service.delete({ userId: "user-a", objectId: "obj-1", prevVersion: 2n }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("after delete, a get on a tombstoned object surfaces tombstone flag", async () => {
    (repo.get as ReturnType<typeof mock>).mockResolvedValue({
      objectId: "obj-1",
      kind: "account",
      ciphertext: buf("ct"),
      nonce: buf("nonce"),
      version: 2n,
      serverSeq: 6n,
      tombstone: true,
    });

    const result = await service.get({ userId: "user-a", objectId: "obj-1" });
    expect(result.tombstone).toBe(true);
  });
});

describe("SyncService.changes", () => {
  let repo: SyncRepo;
  let service: SyncService;

  beforeEach(() => {
    repo = makeMockRepo();
    service = makeService(repo);
  });

  it("returns ordered changes since cursor", async () => {
    (repo.changes as ReturnType<typeof mock>).mockResolvedValue({
      changes: [
        {
          id: "obj-1",
          kind: "account",
          version: 1n,
          serverSeq: 3n,
          ciphertext: buf("ct"),
          nonce: buf("n"),
          tombstone: false,
        },
        {
          id: "obj-2",
          kind: "holding",
          version: 2n,
          serverSeq: 5n,
          ciphertext: buf("ct2"),
          nonce: buf("n2"),
          tombstone: false,
        },
      ],
      next: 5n,
    });

    const result = await service.changes({ userId: "user-a", since: 2n, limit: 10 });
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0]?.serverSeq).toBe(3n);
    expect(result.changes[1]?.serverSeq).toBe(5n);
    expect(result.next).toBe(5n);
  });

  it("returns null next when all results fit in limit", async () => {
    (repo.changes as ReturnType<typeof mock>).mockResolvedValue({ changes: [], next: null });
    const result = await service.changes({ userId: "user-a", since: 0n, limit: 50 });
    expect(result.next).toBeNull();
  });

  it("passes limit and since to repo", async () => {
    await service.changes({ userId: "user-a", since: 42n, limit: 25 });
    expect(repo.changes).toHaveBeenCalledWith({ userId: "user-a", since: 42n, limit: 25 });
  });
});

describe("SyncService.batch", () => {
  let repo: SyncRepo;
  let service: SyncService;

  beforeEach(() => {
    repo = makeMockRepo();
    service = makeService(repo);
  });

  it("returns per-item ok and conflict results", async () => {
    (repo.batch as ReturnType<typeof mock>).mockResolvedValue({
      results: [
        { id: "obj-1", ok: true, serverSeq: 10n, version: 1n },
        { id: "obj-2", ok: false, conflict: { currentVersion: 3n } },
        { id: "obj-3", ok: true, serverSeq: 11n, version: 2n },
      ],
    });

    const result = await service.batch({
      userId: "user-a",
      puts: [
        { objectId: "obj-1", kind: "account", ciphertext: buf("ct"), nonce: buf("n"), version: 1n },
        {
          objectId: "obj-2",
          kind: "holding",
          ciphertext: buf("ct"),
          nonce: buf("n"),
          version: 4n,
          prevVersion: 2n,
        },
      ],
      deletes: [{ objectId: "obj-3", prevVersion: 2n }],
    });

    expect(result.results).toHaveLength(3);
    const ok = result.results.find((r) => r.id === "obj-1");
    expect(ok?.ok).toBe(true);
    const conflict = result.results.find((r) => r.id === "obj-2");
    expect(conflict?.ok).toBe(false);
  });

  it("delegates the whole batch to repo.batch", async () => {
    (repo.batch as ReturnType<typeof mock>).mockResolvedValue({ results: [] });

    await service.batch({ userId: "user-a", puts: [], deletes: [] });
    expect(repo.batch).toHaveBeenCalledWith({ userId: "user-a", puts: [], deletes: [] });
  });
});
