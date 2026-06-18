import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../core/db.js", () => ({ db: {} }));

import type { SessionRow } from "./repo.js";

function liveSession(): SessionRow {
  return {
    sessionId: "sess-1",
    userId: "user-1",
    tokenHash: Buffer.from("th"),
    expiresAt: new Date(Date.now() + 86400_000),
    revokedAt: null,
  };
}

const mockGetSessionByTokenHash = mock(async (): Promise<SessionRow | null> => liveSession());
const mockTouchSession = mock(async (): Promise<void> => undefined);

mock.module("./repo.js", () => ({
  AuthRepo: class {
    getSessionByTokenHash = mockGetSessionByTokenHash;
    touchSession = mockTouchSession;
  },
}));

const { requireSession } = await import("./middleware.js");
const { Hono } = await import("hono");

const VALID_TOKEN = Buffer.alloc(32, 0xab).toString("base64url").replace(/=/g, "");
const SESSION_COOKIE = "privance_session";

function buildTestApp() {
  const app = new Hono();
  app.use("*", requireSession);
  app.get("/test", (c) => c.json({ userId: c.get("userId") }));
  return app;
}

describe("requireSession middleware", () => {
  beforeEach(() => {
    mockGetSessionByTokenHash.mockReset();
    mockTouchSession.mockReset();
    mockGetSessionByTokenHash.mockImplementation(async () => liveSession());
    mockTouchSession.mockImplementation(async () => undefined);
  });

  it("no cookie → 401", async () => {
    const app = buildTestApp();
    const res = await app.fetch(new Request("http://localhost/test"));
    expect(res.status).toBe(401);
  });

  it("valid cookie → sets userId in context", async () => {
    const app = buildTestApp();
    const res = await app.fetch(
      new Request("http://localhost/test", {
        headers: { Cookie: `${SESSION_COOKIE}=${VALID_TOKEN}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe("user-1");
  });

  it("missing session in db → 401", async () => {
    mockGetSessionByTokenHash.mockImplementation(async () => null);
    const app = buildTestApp();
    const res = await app.fetch(
      new Request("http://localhost/test", {
        headers: { Cookie: `${SESSION_COOKIE}=${VALID_TOKEN}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("revoked session → 401 (repo filters revoked rows, surfacing as null)", async () => {
    // getSessionByTokenHash filters `isNull(revokedAt)`, so a revoked token
    // resolves to null at the repo and the middleware rejects it.
    mockGetSessionByTokenHash.mockImplementation(async () => null);
    const app = buildTestApp();
    const res = await app.fetch(
      new Request("http://localhost/test", {
        headers: { Cookie: `${SESSION_COOKIE}=${VALID_TOKEN}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("expired session → 401 and does not extend it", async () => {
    mockGetSessionByTokenHash.mockImplementation(async () => ({
      ...liveSession(),
      expiresAt: new Date(Date.now() - 1000),
    }));
    const app = buildTestApp();
    const res = await app.fetch(
      new Request("http://localhost/test", {
        headers: { Cookie: `${SESSION_COOKIE}=${VALID_TOKEN}` },
      }),
    );
    expect(res.status).toBe(401);
    expect(mockTouchSession).not.toHaveBeenCalled();
  });
});
