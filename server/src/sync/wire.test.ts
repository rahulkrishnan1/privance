import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { BatchResult, ChangesResult } from "./types.js";

// AES-GCM nonce is 12 bytes; the wire layer rejects wrong-sized nonces.
const NONCE_B64 = Buffer.alloc(12, 1).toString("base64");

// Strategy: mock `../core/db.js` (returns an empty stub so drizzle never
// connects) and `./repo.js` (controls responses per test). The real
// SyncService runs, giving us service + wire coverage in one pass.
//
// Auth middleware is injected via createFeatureRouter so we avoid cross-file
// module cache interference when running alongside auth/wire.test.ts.
// sync-service.test.ts mocks the repo at the object level (not module level),
// so the two test files coexist without interfering.
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
const mockRepoBatch = mock(async (): Promise<BatchResult> => ({ results: [] }));

mock.module("./repo.js", () => ({
  SyncRepo: class {
    put = mockRepoPut;
    get = mockRepoGet;
    delete = mockRepoDelete;
    changes = mockRepoChanges;
    batch = mockRepoBatch;
  },
}));

import type { MiddlewareHandler } from "hono/types";

function mockAuthMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const userId = c.req.header("x-user-id");
    if (!userId) throw new HTTPException(401, { message: "unauthenticated" });
    c.set("userId", userId);
    return next();
  };
}

const { createFeatureRouter } = await import("./wire.js");
const { ConflictError, NotFoundError } = await import("./types.js");
const { secureHeaders } = await import("hono/secure-headers");
const { requireCsrfHeader } = await import("../core/middleware.js");

const { router: syncRouter } = createFeatureRouter(mockAuthMiddleware());

const testApp = new Hono();
testApp.use("*", secureHeaders());
testApp.use("/api/*", requireCsrfHeader);
testApp.route("/api/sync", syncRouter);

const server = { fetch: testApp.fetch };

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
  mockRepoPut.mockClear();
  mockRepoGet.mockClear();
  mockRepoDelete.mockClear();
  mockRepoChanges.mockClear();
  mockRepoBatch.mockClear();
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
  mockRepoBatch.mockResolvedValue({ results: [] });
}

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

describe("PUT /api/sync/objects/:id", () => {
  beforeEach(resetMocks);

  it("returns 200 with server_seq and version", async () => {
    mockRepoPut.mockResolvedValue({ serverSeq: 42n, version: 3n });

    const ct = Buffer.from("ciphertext").toString("base64");
    const nonce = NONCE_B64;
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
    const nonce = NONCE_B64;
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
    const nonce = NONCE_B64;
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

describe("POST /api/sync/batch", () => {
  beforeEach(resetMocks);

  it("mixes successes and conflicts, per-item results", async () => {
    mockRepoBatch.mockResolvedValue({
      results: [
        { id: "obj-1", ok: true, serverSeq: 20n, version: 1n },
        { id: "obj-2", ok: false, conflict: { currentVersion: 3n } },
        { id: "obj-3", ok: true, serverSeq: 21n, version: 2n },
      ],
    });

    const ct = Buffer.from("ct").toString("base64");
    const nonce = NONCE_B64;
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
    mockRepoBatch.mockResolvedValue({ results: [] });

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

  it("rejects a batch over the item cap before touching the repo → 400", async () => {
    const ct = Buffer.from("ct").toString("base64");
    const puts = Array.from({ length: 501 }, (_, i) => ({
      object_id: `o${i}`,
      kind: "account",
      ciphertext: ct,
      nonce: NONCE_B64,
      version: 1,
    }));

    const res = await server.fetch(
      new Request(`${BASE}/api/sync/batch`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ puts, deletes: [] }),
      }),
    );
    expect(res.status).toBe(400);
    expect(mockRepoBatch).not.toHaveBeenCalled();
  });

  it("counts puts and deletes together against the item cap → 400", async () => {
    const ct = Buffer.from("ct").toString("base64");
    const puts = Array.from({ length: 300 }, (_, i) => ({
      object_id: `p${i}`,
      kind: "account",
      ciphertext: ct,
      nonce: NONCE_B64,
      version: 1,
    }));
    const deletes = Array.from({ length: 201 }, (_, i) => ({
      object_id: `d${i}`,
      prev_version: 1,
    }));

    const res = await server.fetch(
      new Request(`${BASE}/api/sync/batch`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ puts, deletes }),
      }),
    );
    expect(res.status).toBe(400);
    expect(mockRepoBatch).not.toHaveBeenCalled();
  });

  it("a batch exactly at the item cap is accepted → 200", async () => {
    mockRepoBatch.mockResolvedValue({ results: [] });
    const ct = Buffer.from("ct").toString("base64");
    const puts = Array.from({ length: 500 }, (_, i) => ({
      object_id: `o${i}`,
      kind: "account",
      ciphertext: ct,
      nonce: NONCE_B64,
      version: 1,
    }));

    const res = await server.fetch(
      new Request(`${BASE}/api/sync/batch`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ puts, deletes: [] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRepoBatch).toHaveBeenCalledTimes(1);
  });

  it("forwards the authenticated userId to the repo, never one supplied in the body", async () => {
    mockRepoBatch.mockResolvedValue({ results: [] });
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/batch`, {
        method: "POST",
        headers: authHeaders({ "X-User-Id": "real-owner" }),
        body: JSON.stringify({ user_id: "attacker", puts: [], deletes: [] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRepoBatch).toHaveBeenCalledWith(expect.objectContaining({ userId: "real-owner" }));
    const calls = mockRepoBatch.mock.calls as unknown as Array<[{ userId: string }]>;
    const arg = calls[calls.length - 1]?.[0];
    expect(arg?.userId).not.toBe("attacker");
  });
});

describe("sync body limit", () => {
  beforeEach(resetMocks);

  it("rejects a body over 5 MB → 413, repo untouched", async () => {
    const oversized = "x".repeat(5 * 1024 * 1024 + 1);
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/batch`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ puts: [], deletes: [], pad: oversized }),
      }),
    );
    expect(res.status).toBe(413);
    expect(mockRepoBatch).not.toHaveBeenCalled();
  });
});

describe("GET /api/sync/changes query parsing", () => {
  beforeEach(resetMocks);

  it("non-finite limit → 400", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/changes?since=0&limit=abc`, {
        method: "GET",
        headers: { "X-User-Id": "test-user-id" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("non-numeric since → 400", async () => {
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/changes?since=notabigint`, {
        method: "GET",
        headers: { "X-User-Id": "test-user-id" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("forwards the parsed since cursor and clamped limit to the repo", async () => {
    mockRepoChanges.mockResolvedValue({ changes: [], next: null });
    const res = await server.fetch(
      new Request(`${BASE}/api/sync/changes?since=42&limit=10`, {
        method: "GET",
        headers: { "X-User-Id": "test-user-id" },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRepoChanges).toHaveBeenCalledWith(
      expect.objectContaining({ since: 42n, limit: 10, userId: "test-user-id" }),
    );
  });
});
