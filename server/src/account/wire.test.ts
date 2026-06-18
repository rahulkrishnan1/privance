import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono/types";

// Mock `../core/db.js` with a stub that satisfies the real AccountRepo's calls,
// and `../auth/kdf.js` so password verification is deterministic. The real
// AccountRepo + AccountService run, giving repo + service + wire coverage in one
// pass. We don't mock `./repo.js` so repo.test.ts can still import the real
// module (bun shares the module cache across test files).
const STORED_HASH = Buffer.from("$argon2id$v=19$m=65536,t=3,p=4$abc$def", "utf8");

let mockStoredHash: Buffer | null = STORED_HASH;
let txDeletes = 0;

const dbStub = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => (mockStoredHash ? [{ authHashHash: mockStoredHash }] : []),
      }),
    }),
  }),
  async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const tx = {
      delete: () => {
        txDeletes += 1;
        return { where: () => Promise.resolve(undefined) };
      },
    };
    return fn(tx);
  },
};

mock.module("../core/db.js", () => ({ db: dbStub }));

const mockVerifyAuthHash = mock(async (): Promise<boolean> => true);
mock.module("../auth/kdf.js", () => ({
  verifyAuthHash: mockVerifyAuthHash,
}));

// The password-verify throttle window is fixed at 3 via the test preload
// (bunfig.toml -> test-setup.ts) so this file's throttling test is deterministic.
const { resetAll: resetRateLimit } = await import("../auth/rate-limit.js");

function mockAuthMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const userId = c.req.header("x-user-id");
    if (!userId) throw new HTTPException(401, { message: "unauthenticated" });
    c.set("userId", userId);
    return next();
  };
}

const { createFeatureRouter } = await import("./wire.js");
const { secureHeaders } = await import("hono/secure-headers");
const { requireCsrfHeader } = await import("../core/middleware.js");

const { router: accountRouter } = createFeatureRouter(mockAuthMiddleware());

const testApp = new Hono();
testApp.use("*", secureHeaders());
testApp.use("/api/*", requireCsrfHeader);
testApp.route("/api/account", accountRouter);

const server = { fetch: testApp.fetch };

const BASE = "http://localhost";
const CSRF = { "X-Requested-With": "XMLHttpRequest" };
const JSON_CT = { "Content-Type": "application/json" };

function b64(s: string): string {
  return Buffer.from(s).toString("base64");
}

const VALID_BODY = { current_auth_hash: b64("c".repeat(32)) };

function reset(): void {
  mockVerifyAuthHash.mockImplementation(async () => true);
  mockStoredHash = STORED_HASH;
  txDeletes = 0;
  resetRateLimit();
}

describe("POST /api/account/destroy", () => {
  it("valid password → 200, deletes all per-user tables, clears the session cookie", async () => {
    reset();
    const res = await server.fetch(
      new Request(`${BASE}/api/account/destroy`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF, "x-user-id": "user-1" },
        body: JSON.stringify(VALID_BODY),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    // The cascade ran inside the transaction; the exact per-table count is an
    // implementation detail asserted precisely in account/repo.test.ts.
    expect(txDeletes).toBeGreaterThan(0);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("privance_session=;");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("wrong password → 401, deletes nothing", async () => {
    reset();
    mockVerifyAuthHash.mockImplementation(async () => false);
    const res = await server.fetch(
      new Request(`${BASE}/api/account/destroy`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF, "x-user-id": "user-1" },
        body: JSON.stringify(VALID_BODY),
      }),
    );
    expect(res.status).toBe(401);
    expect(txDeletes).toBe(0);
  });

  it("missing current_auth_hash → 400, deletes nothing", async () => {
    reset();
    const res = await server.fetch(
      new Request(`${BASE}/api/account/destroy`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF, "x-user-id": "user-1" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    expect(txDeletes).toBe(0);
  });

  it("missing CSRF header → 403", async () => {
    reset();
    const res = await server.fetch(
      new Request(`${BASE}/api/account/destroy`, {
        method: "POST",
        headers: { ...JSON_CT, "x-user-id": "user-1" },
        body: JSON.stringify(VALID_BODY),
      }),
    );
    expect(res.status).toBe(403);
    expect(txDeletes).toBe(0);
  });

  it("no session → 401", async () => {
    reset();
    const res = await server.fetch(
      new Request(`${BASE}/api/account/destroy`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF },
        body: JSON.stringify(VALID_BODY),
      }),
    );
    expect(res.status).toBe(401);
    expect(txDeletes).toBe(0);
  });

  it("repeated wrong passwords get throttled (429) once the window is exhausted", async () => {
    reset();
    mockVerifyAuthHash.mockImplementation(async () => false);
    const send = () =>
      server.fetch(
        new Request(`${BASE}/api/account/destroy`, {
          method: "POST",
          headers: { ...JSON_CT, ...CSRF, "x-user-id": "user-throttle" },
          body: JSON.stringify(VALID_BODY),
        }),
      );

    // Window is 3 (RATE_LIMIT_PASSWORD_VERIFY); attempts 1-3 reach verify → 401.
    for (let i = 0; i < 3; i++) {
      expect((await send()).status).toBe(401);
    }
    // The next attempt is gated before verify → 429, and deletes nothing.
    expect((await send()).status).toBe(429);
    expect(txDeletes).toBe(0);
  });

  it("malformed JSON body → 400 (mapped, not 500)", async () => {
    reset();
    const res = await server.fetch(
      new Request(`${BASE}/api/account/destroy`, {
        method: "POST",
        headers: { ...JSON_CT, ...CSRF, "x-user-id": "user-1" },
        body: "{ not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(txDeletes).toBe(0);
  });
});
