import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { lookupProfiles } from "./symbol-profiles";

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

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

describe("lookupProfiles", () => {
  it("returns empty result without calling fetch on empty input", async () => {
    const result = await lookupProfiles([]);
    expect(result).toEqual({ profiles: [], unknown: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("happy path, parses profiles including sectorWeightings and dividendYield", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({
        profiles: [
          {
            ticker: "VOO",
            assetType: "stock",
            displayName: "Vanguard S&P 500 ETF",
            sectorWeightings: [
              { sector: "Technology", weight: 0.31 },
              { sector: "Financials", weight: 0.13 },
            ],
            dividendYield: "0.0132",
          },
        ],
        unknown: ["ZZZZ"],
      }),
    );

    const result = await lookupProfiles(["VOO", "ZZZZ"]);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.ticker).toBe("VOO");
    expect(result.profiles[0]?.sectorWeightings?.[0]).toEqual({
      sector: "Technology",
      weight: 0.31,
    });
    expect(result.profiles[0]?.dividendYield).toBe("0.0132");
    expect(result.unknown).toContain("ZZZZ");
  });

  it("non-ok response → ApiError", async () => {
    mockFetch.mockResolvedValueOnce(jsonErr(429, { error: "rate_limited" }));
    await expect(lookupProfiles(["VOO"])).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 429 && e.code === "rate_limited",
    );
  });

  it("schema-invalid 200 body → ApiError schema_error", async () => {
    mockFetch.mockResolvedValueOnce(ok({ profiles: [{ ticker: "VOO" }], unknown: [] }));
    await expect(lookupProfiles(["VOO"])).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.code === "schema_error",
    );
  });
});
