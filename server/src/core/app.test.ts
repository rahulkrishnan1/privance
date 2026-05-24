import { describe, expect, it } from "bun:test";

import { createApp } from "./app.js";

const app = createApp();

describe("GET /health", () => {
  it("returns 200 with ok:true and service:privance", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string; ts: number };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("privance");
    expect(typeof body.ts).toBe("number");
  });
});

describe("GET /api/health", () => {
  it("returns 200 with ok:true and service:privance", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string; ts: number };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("privance");
    expect(typeof body.ts).toBe("number");
  });

  it("returns the same shape as GET /health", async () => {
    const res = await app.request("/api/health");
    const body = (await res.json()) as { ok: boolean; service: string; ts: number };
    expect(Object.keys(body).sort()).toEqual(["ok", "service", "ts"]);
  });
});

describe("POST /api/health (CSRF gate)", () => {
  it("is rejected without X-Requested-With header", async () => {
    const res = await app.request("/api/health", { method: "POST" });
    // requireCsrfHeader blocks all state-changing methods on /api/* without the header
    expect(res.status).toBe(403);
  });
});
