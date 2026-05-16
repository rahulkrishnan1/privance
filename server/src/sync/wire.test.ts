import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { BatchResultItem, ChangesResult } from "./types.js";

// ---------------------------------------------------------------------------
// Wire-level tests (in-process, no real DB).
//
// Strategy: mock `../core/db.js` (returns an empty stub so drizzle never
// connects) and `./repo.js` (controls responses per test). The real
// SyncService runs, giving us service + wire coverage in one pass.
// sync-service.test.ts mocks the repo at the object level (not module level),
// so the two test files coexist without interfering.
// ---------------------------------------------------------------------------

mock.module("../core/db.js", () => ({ db: {} }));

const mockRepoPut = mock(async () => ({ serverSeq: 1n, version: 1n }));
const mockRepoGet = mock(async () => ({
  objectId: "obj-1",
  kind: "account",
  ciphertext: Buffer.from("ct"),
  nonce: Buffer.from("nonce"),
  version: 1n,
  serverSeq: 1n,
  tombstone: false,
}));
const mockRepoDelete = mock(async () => {});
const mockRepoChanges = mock(async (): Promise<ChangesResult> => ({ changes: [], next: null }));
const mockRepoBatchPut = mock(async (): Promise<BatchResultItem[]> => []);
const mockRepoBatchDelete = mock(async (): Promise<BatchResultItem[]> => []);
const mockRepoLogEvent = mock(async () => {});

mock.module("./repo.js", () => ({
  SyncRepo: class {
    put = mockRepoPut;
    get = mockRepoGet;
    delete = mockRepoDelete;
    changes = mockRepoChanges;
    batchPut = mockRepoBatchPut;
    batchDelete = mockRepoBatchDelete;
    logEvent = mockRepoLogEvent;
  },
}));

const { default: server } = await import("../index.js");
const { ConflictError, NotFoundError } = await import("./types.js");

const BASE = "http://localhost";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "X-User-Id": "test-user-id",
    ...extra,
  };
}

function resetMocks(): void {
  mockRepoPut.mockResolvedValue({ serverSeq: 1n, version: 1n });
  mockRepoGet.mockResolvedValue({
    objectId: "obj-1",
    kind: "account",
    ciphertext: Buffer.from("ct"),
    nonce: Buffer.from("nonce"),
    version: 1n,
    serverSeq: 1n,
    tombstone: false,
  });
  mockRepoDelete.mockResolvedValue(undefined);
  mockRepoChanges.mockResolvedValue({ changes: [], next: null });
  mockRepoBatchPut.mockResolvedValue([]);
  mockRepoBatchDelete.mockResolvedValue([]);
  mockRepoLogEvent.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// CSRF middleware
// ---------------------------------------------------------------------------

describe("CSRF middleware", () => {
  it("rejects PUT without X-Requested-With → 403", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/some-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-User-Id": "uid" },
        body: JSON.stringify({ kind: "account", ciphertext: "", nonce: "", version: 1 }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects DELETE without X-Requested-With → 403", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/some-id`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-User-Id": "uid" },
        body: JSON.stringify({ prev_version: 1 }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects POST /batch without X-Requested-With → 403", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": "uid" },
        body: JSON.stringify({ puts: [], deletes: [] }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("GET bypasses CSRF check → falls through to auth check (401)", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/some-id`, { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Auth placeholder
// ---------------------------------------------------------------------------

describe("Auth placeholder", () => {
  it("GET without X-User-Id → 401", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/some-id`, { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });

  it("PUT without X-User-Id → 401", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/some-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ kind: "account", ciphertext: "abc", nonce: "def", version: 1 }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("GET /changes without X-User-Id → 401", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/changes?since=0&limit=10`, { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });

  it("DELETE without X-User-Id after X-Requested-With → 401", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/some-id`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ prev_version: 1 }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe("Input validation", () => {
  it("PUT without kind → 400", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/obj-1`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ ciphertext: "abc", nonce: "def", version: 1 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("PUT without ciphertext/nonce → 400", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/obj-1`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ kind: "account", version: 1 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("DELETE without prev_version → 400", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/obj-1`, {
        method: "DELETE",
        headers: authHeaders(),
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/sync/objects/:id
// ---------------------------------------------------------------------------

describe("PUT /api/sync/objects/:id", () => {
  beforeEach(resetMocks);

  it("returns 200 with server_seq and version", async () => {
    mockRepoPut.mockResolvedValue({ serverSeq: 42n, version: 3n });

    const ct = Buffer.from("ciphertext").toString("base64");
    const nonce = Buffer.from("nonce12345678901").toString("base64");
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/obj-1`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ kind: "account", ciphertext: ct, nonce, version: 3 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { server_seq: string; version: string };
    expect(body.server_seq).toBe("42");
    expect(body.version).toBe("3");
  });

  it("PUT with prev_version passes it through → 200", async () => {
    mockRepoPut.mockResolvedValue({ serverSeq: 5n, version: 4n });

    const ct = Buffer.from("ct").toString("base64");
    const nonce = Buffer.from("nonce123456789012").toString("base64");
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/obj-1`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          kind: "holding",
          ciphertext: ct,
          nonce,
          version: 4,
          prev_version: 3,
        }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("service ConflictError → 409 with current_version", async () => {
    mockRepoPut.mockRejectedValue(new ConflictError("obj-1", 7n));

    const ct = Buffer.from("ct").toString("base64");
    const nonce = Buffer.from("nonce123456789012").toString("base64");
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/obj-1`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          kind: "account",
          ciphertext: ct,
          nonce,
          version: 5,
          prev_version: 4,
        }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { current_version: string };
    expect(body.current_version).toBe("7");
  });
});

// ---------------------------------------------------------------------------
// GET /api/sync/objects/:id
// ---------------------------------------------------------------------------

describe("GET /api/sync/objects/:id", () => {
  beforeEach(resetMocks);

  it("returns 200 with base64-encoded ciphertext and nonce", async () => {
    mockRepoGet.mockResolvedValue({
      objectId: "obj-1",
      kind: "account",
      ciphertext: Buffer.from("ciphertext"),
      nonce: Buffer.from("nonce"),
      version: 2n,
      serverSeq: 5n,
      tombstone: false,
    });

    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/obj-1`, {
        method: "GET",
        headers: { "X-User-Id": "test-user-id" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; version: string };
    expect(body.kind).toBe("account");
    expect(body.version).toBe("2");
  });

  it("tombstoned object → 404", async () => {
    mockRepoGet.mockResolvedValue({
      objectId: "obj-1",
      kind: "account",
      ciphertext: Buffer.from("ct"),
      nonce: Buffer.from("n"),
      version: 1n,
      serverSeq: 3n,
      tombstone: true,
    });

    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/obj-1`, {
        method: "GET",
        headers: { "X-User-Id": "test-user-id" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("missing object → 404", async () => {
    mockRepoGet.mockRejectedValue(new NotFoundError("obj-99"));

    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/obj-99`, {
        method: "GET",
        headers: { "X-User-Id": "test-user-id" },
      }),
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/sync/changes
// ---------------------------------------------------------------------------

describe("GET /api/sync/changes", () => {
  beforeEach(resetMocks);

  it("returns changes array ordered by server_seq with next cursor", async () => {
    mockRepoChanges.mockResolvedValue({
      changes: [
        {
          id: "obj-1",
          kind: "account",
          version: 3n,
          serverSeq: 10n,
          ciphertext: Buffer.from("ct"),
          nonce: Buffer.from("n"),
          tombstone: false,
        },
      ],
      next: 10n,
    });

    const res = await server.fetch(
      new Request(`${BASE}/api/sync/changes?since=5&limit=50`, {
        method: "GET",
        headers: { "X-User-Id": "test-user-id" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { changes: unknown[]; next: string };
    expect(body.changes).toHaveLength(1);
    expect(body.next).toBe("10");
  });

  it("null next when no more pages", async () => {
    mockRepoChanges.mockResolvedValue({ changes: [], next: null });

    const res = await server.fetch(
      new Request(`${BASE}/api/sync/changes?since=0`, {
        method: "GET",
        headers: { "X-User-Id": "test-user-id" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { next: null };
    expect(body.next).toBeNull();
  });

  it("respects limit parameter (clamps to 500)", async () => {
    mockRepoChanges.mockResolvedValue({ changes: [], next: null });

    const res = await server.fetch(
      new Request(`${BASE}/api/sync/changes?since=0&limit=1000`, {
        method: "GET",
        headers: { "X-User-Id": "test-user-id" },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRepoChanges).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/sync/objects/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/sync/objects/:id", () => {
  beforeEach(resetMocks);

  it("returns 204 on success (tombstone written)", async () => {
    mockRepoDelete.mockResolvedValue(undefined);

    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/obj-1`, {
        method: "DELETE",
        headers: authHeaders(),
        body: JSON.stringify({ prev_version: 2 }),
      }),
    );
    expect(res.status).toBe(204);
  });

  it("ConflictError on delete → 409", async () => {
    mockRepoDelete.mockRejectedValue(new ConflictError("obj-1", 5n));

    const res = await server.fetch(
      new Request(`${BASE}/api/sync/objects/obj-1`, {
        method: "DELETE",
        headers: authHeaders(),
        body: JSON.stringify({ prev_version: 4 }),
      }),
    );
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// POST /api/sync/batch
// ---------------------------------------------------------------------------

describe("POST /api/sync/batch", () => {
  beforeEach(resetMocks);

  it("mixes successes and conflicts, per-item results", async () => {
    mockRepoBatchPut.mockResolvedValue([
      { id: "obj-1", ok: true, serverSeq: 20n, version: 1n },
      { id: "obj-2", ok: false, conflict: { currentVersion: 3n } },
    ]);
    mockRepoBatchDelete.mockResolvedValue([{ id: "obj-3", ok: true, serverSeq: 21n, version: 2n }]);

    const ct = Buffer.from("ct").toString("base64");
    const nonce = Buffer.from("nonce123456789012").toString("base64");
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/batch`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          puts: [
            { object_id: "obj-1", kind: "account", ciphertext: ct, nonce, version: 1 },
            {
              object_id: "obj-2",
              kind: "holding",
              ciphertext: ct,
              nonce,
              version: 4,
              prev_version: 2,
            },
          ],
          deletes: [{ object_id: "obj-3", prev_version: 2 }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ id: string; ok: boolean }> };
    expect(body.results).toHaveLength(3);
    expect(body.results.find((r) => r.id === "obj-1")?.ok).toBe(true);
    expect(body.results.find((r) => r.id === "obj-2")?.ok).toBe(false);
  });

  it("empty batch → 200 with empty results", async () => {
    mockRepoBatchPut.mockResolvedValue([]);
    mockRepoBatchDelete.mockResolvedValue([]);

    const res = await server.fetch(
      new Request(`${BASE}/api/sync/batch`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ puts: [], deletes: [] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(0);
  });

  it("batch put missing object_id → 400", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/batch`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          puts: [{ kind: "account", ciphertext: "ct", nonce: "n", version: 1 }],
          deletes: [],
        }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
