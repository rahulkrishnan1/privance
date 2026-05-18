import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "./client";

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

function makeJsonResponse(
  status: number,
  body: unknown,
  contentType = "application/json",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": contentType },
  });
}

function makeTextResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

describe("apiFetch", () => {
  it("returns response on 2xx", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(200, { ok: true }));
    const res = await apiFetch("/api/test");
    expect(res.ok).toBe(true);
  });

  it("sends credentials: include on every request", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(200, {}));
    await apiFetch("/api/test");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/test"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("sends CSRF header on POST", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(200, {}));
    await apiFetch("/api/test", { method: "POST", body: JSON.stringify({}) });
    const call = mockFetch.mock.calls[0];
    const init = call?.[1] as RequestInit;
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Requested-With")).toBe("privance-web");
  });

  it("sends CSRF header on PUT", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(200, {}));
    await apiFetch("/api/test", { method: "PUT", body: JSON.stringify({}) });
    const call = mockFetch.mock.calls[0];
    const init = call?.[1] as RequestInit;
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Requested-With")).toBe("privance-web");
  });

  it("sends CSRF header on DELETE", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(200, {}));
    await apiFetch("/api/test", { method: "DELETE", body: JSON.stringify({}) });
    const call = mockFetch.mock.calls[0];
    const init = call?.[1] as RequestInit;
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Requested-With")).toBe("privance-web");
  });

  it("does NOT send CSRF header on GET", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(200, {}));
    await apiFetch("/api/test");
    const call = mockFetch.mock.calls[0];
    const init = call?.[1] as RequestInit;
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Requested-With")).toBeNull();
  });

  it("throws ApiError with status 0 and code 'network' on fetch rejection", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connection refused"));
    await expect(apiFetch("/api/test")).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 0 && e.code === "network",
    );
  });

  it("throws ApiError on 401 plain-text response", async () => {
    mockFetch.mockResolvedValueOnce(makeTextResponse(401, "unauthenticated"));
    await expect(apiFetch("/api/test")).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 401 && e.code === "unauthenticated",
    );
  });

  it("throws ApiError on 429 JSON response with error code", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse(429, { error: "rate_limited", ms_remaining: 5000 }),
    );
    await expect(apiFetch("/api/test")).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 429 && e.code === "rate_limited",
    );
  });

  it("throws ApiError on 4xx JSON response", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(400, { error: "missing_field" }));
    await expect(apiFetch("/api/test")).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 400,
    );
  });
});
