import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { getCooldown, refreshPrices } from "./prices";

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

describe("refreshPrices", () => {
  it("happy path, returns prices and unknown", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({
        prices: [
          {
            ticker: "AAPL",
            price: "182.34",
            previousPrice: null,
            fetchedAt: "2026-01-01T00:00:00Z",
          },
        ],
        unknown: ["UNKNOWN"],
      }),
    );
    const result = await refreshPrices(["AAPL", "UNKNOWN"], "yahoo");
    expect(result.prices).toHaveLength(1);
    expect(result.prices[0]?.ticker).toBe("AAPL");
    expect(result.unknown).toContain("UNKNOWN");
  });

  it("sends CSRF header on POST", async () => {
    mockFetch.mockResolvedValueOnce(ok({ prices: [], unknown: [] }));
    await refreshPrices(["AAPL"], "yahoo");
    const headers = new Headers(lastCallInit().headers);
    expect(headers.get("X-Requested-With")).toBe("privance-web");
  });

  it("429 rate limited → ApiError", async () => {
    mockFetch.mockResolvedValueOnce(jsonErr(429, { error: "rate_limited", ms_remaining: 5000 }));
    await expect(refreshPrices(["AAPL"], "yahoo")).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 429 && e.code === "rate_limited",
    );
  });

  it("503 upstream unavailable → ApiError", async () => {
    mockFetch.mockResolvedValueOnce(jsonErr(503, { error: "upstream_unavailable" }));
    await expect(refreshPrices(["AAPL"], "yahoo")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getCooldown", () => {
  it("happy path, returns msUntilNextRefresh", async () => {
    mockFetch.mockResolvedValueOnce(ok({ msUntilNextRefresh: 30000 }));
    const result = await getCooldown();
    expect(result.msUntilNextRefresh).toBe(30000);
  });

  it("uses GET (no CSRF)", async () => {
    mockFetch.mockResolvedValueOnce(ok({ msUntilNextRefresh: 0 }));
    await getCooldown();
    const headers = new Headers(lastCallInit().headers);
    expect(headers.get("X-Requested-With")).toBeNull();
  });
});
