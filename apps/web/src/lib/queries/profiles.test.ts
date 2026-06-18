import { describe, expect, it } from "vitest";
import type { LookupProfilesResponse } from "@/lib/api/symbol-profiles";
import { profileStaleTime } from "./profiles";

// profileStaleTime: resolved sets cache for a day; any unresolved ticker keeps
// the result stale within the hour so a transient upstream failure is retried.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function response(unknown: string[]): LookupProfilesResponse {
  return { profiles: [], unknown };
}

describe("profileStaleTime", () => {
  it("caches a fully-resolved lookup for a day", () => {
    expect(profileStaleTime(response([]))).toBe(DAY_MS);
  });

  it("keeps a lookup with any unresolved ticker stale within the hour", () => {
    expect(profileStaleTime(response(["MYSTERY"]))).toBe(HOUR_MS);
  });

  it("treats an absent result as fully resolved (long stale)", () => {
    expect(profileStaleTime(undefined)).toBe(DAY_MS);
  });

  it("returns the short stale time when multiple unknown tickers are present", () => {
    // Any non-zero unknown count should trigger the hour cache, not just a single entry.
    expect(profileStaleTime(response(["MYSTERY", "UNKNOWN2", "TICKER3"]))).toBe(HOUR_MS);
  });
});
