import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { destroy } from "./account";
import { ApiError } from "./client";

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

function lastCallInit(): RequestInit {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return (call?.[1] ?? {}) as RequestInit;
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonErr(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("destroy", () => {
  const payload = { current_auth_hash: "aabbcc" };

  it("happy path, returns status ok and posts the auth hash", async () => {
    mockFetch.mockResolvedValueOnce(ok({ status: "ok" }));
    const result = await destroy(payload);
    expect(result.status).toBe("ok");

    const lastCall = mockFetch.mock.calls.at(-1) as [string, RequestInit];
    expect(lastCall[0]).toContain("/api/account/destroy");
    const init = lastCallInit();
    expect(init.method?.toUpperCase()).toBe("POST");
    expect(JSON.parse(init.body as string).current_auth_hash).toBe("aabbcc");
  });

  it("401 invalid_password JSON body → ApiError with code from body.error", async () => {
    mockFetch.mockResolvedValueOnce(jsonErr(401, { error: "invalid_password" }));
    await expect(destroy(payload)).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 401 && e.code === "invalid_password",
    );
  });

  it("schema-mismatch 200 body → ApiError schema_error", async () => {
    mockFetch.mockResolvedValueOnce(ok({ status: "nope" }));
    await expect(destroy(payload)).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.code === "schema_error",
    );
  });
});
