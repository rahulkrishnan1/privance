import { describe, expect, it, mock } from "bun:test";

mock.module("../core/db.js", () => ({ db: {} }));

import type { SessionRow } from "./repo.js";

const mockGetSessionByTokenHash = mock(
  async (): Promise<SessionRow | null> => ({
    sessionId: "sess-1",
    userId: "user-1",
    tokenHash: Buffer.from("th"),
    expiresAt: new Date(Date.now() + 86400_000),
    revokedAt: null,
  }),
);
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
    mockGetSessionByTokenHash.mockImplementation(async () => ({
      sessionId: "sess-1",
      userId: "user-1",
      tokenHash: Buffer.from("th"),
      expiresAt: new Date(Date.now() + 86400_000),
      revokedAt: null,
    }));
  });

  it("expired session → 401", async () => {
    mockGetSessionByTokenHash.mockImplementation(async () => ({
      sessionId: "sess-1",
      userId: "user-1",
      tokenHash: Buffer.from("th"),
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
    }));
    const app = buildTestApp();
    const res = await app.fetch(
      new Request("http://localhost/test", {
        headers: { Cookie: `${SESSION_COOKIE}=${VALID_TOKEN}` },
      }),
    );
    expect(res.status).toBe(401);
    mockGetSessionByTokenHash.mockImplementation(async () => ({
      sessionId: "sess-1",
      userId: "user-1",
      tokenHash: Buffer.from("th"),
      expiresAt: new Date(Date.now() + 86400_000),
      revokedAt: null,
    }));
  });
});
