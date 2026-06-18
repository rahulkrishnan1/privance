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

describe("Content-Security-Policy", () => {
  it("locks down to no-default-src, self-only connect, no framing", async () => {
    const res = await app.request("/health");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
  });
});

describe("CORS origin allowlist", () => {
  it("reflects an allowed origin and sets credentials", async () => {
    process.env.ALLOWED_ORIGINS = "https://privance.app,http://localhost:8081";
    const corsApp = createApp();
    const res = await corsApp.request("/health", {
      headers: { Origin: "https://privance.app" },
    });
    process.env.ALLOWED_ORIGINS = "";
    expect(res.headers.get("access-control-allow-origin")).toBe("https://privance.app");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not reflect a disallowed origin", async () => {
    process.env.ALLOWED_ORIGINS = "https://privance.app";
    const corsApp = createApp();
    const res = await corsApp.request("/health", {
      headers: { Origin: "https://evil.example" },
    });
    process.env.ALLOWED_ORIGINS = "";
    expect(res.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });
});
