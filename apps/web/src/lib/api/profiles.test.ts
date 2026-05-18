import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { lookupProfiles, refreshProfile } from "./profiles";

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

const MOCK_PROFILE = {
  ticker: "AAPL",
  assetType: "equity" as const,
  displayName: "Apple Inc.",
};

describe("lookupProfiles", () => {
  it("happy path, returns profiles and unknown", async () => {
    mockFetch.mockResolvedValueOnce(ok({ profiles: [MOCK_PROFILE], unknown: ["UNKNOWN"] }));
    const result = await lookupProfiles(["AAPL", "UNKNOWN"]);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.ticker).toBe("AAPL");
    expect(result.unknown).toContain("UNKNOWN");
  });

  it("sends CSRF header on POST", async () => {
    mockFetch.mockResolvedValueOnce(ok({ profiles: [], unknown: [] }));
    await lookupProfiles(["AAPL"]);
    const headers = new Headers(lastCallInit().headers);
    expect(headers.get("X-Requested-With")).toBe("privance-web");
  });

  it("429 rate limited → ApiError", async () => {
    mockFetch.mockResolvedValueOnce(jsonErr(429, { error: "rate_limited", ms_remaining: 5000 }));
    await expect(lookupProfiles(["AAPL"])).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 429,
    );
  });
});

describe("refreshProfile", () => {
  it("happy path, returns profiles and unknown", async () => {
    mockFetch.mockResolvedValueOnce(ok({ profiles: [MOCK_PROFILE], unknown: [] }));
    const result = await refreshProfile(["AAPL"]);
    expect(result.profiles[0]?.ticker).toBe("AAPL");
  });

  it("sends CSRF header on POST", async () => {
    mockFetch.mockResolvedValueOnce(ok({ profiles: [], unknown: [] }));
    await refreshProfile(["AAPL"]);
    const headers = new Headers(lastCallInit().headers);
    expect(headers.get("X-Requested-With")).toBe("privance-web");
  });

  it("503 upstream unavailable → ApiError", async () => {
    mockFetch.mockResolvedValueOnce(jsonErr(503, { error: "upstream_unavailable" }));
    await expect(refreshProfile(["AAPL"])).rejects.toBeInstanceOf(ApiError);
  });
});
