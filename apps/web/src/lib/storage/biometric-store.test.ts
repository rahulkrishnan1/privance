import { describe, expect, it } from "vitest";
import { CADENCE_TTL_MS, isCadenceFresh } from "./biometric-store";

describe("isCadenceFresh", () => {
  it("is fresh at the moment of password unlock", () => {
    expect(isCadenceFresh({ lastPasswordUnlockAt: 1000, now: 1000 })).toBe(true);
  });

  it("is fresh up to and including the exact 14-day boundary", () => {
    expect(isCadenceFresh({ lastPasswordUnlockAt: 0, now: CADENCE_TTL_MS })).toBe(true);
  });

  it("is stale one millisecond past the 14-day boundary", () => {
    expect(isCadenceFresh({ lastPasswordUnlockAt: 0, now: CADENCE_TTL_MS + 1 })).toBe(false);
  });

  it("treats a backwards clock as stale (fail-closed)", () => {
    expect(isCadenceFresh({ lastPasswordUnlockAt: 5000, now: 4000 })).toBe(false);
  });

  it("honours an explicit ttlMs override", () => {
    expect(isCadenceFresh({ lastPasswordUnlockAt: 0, now: 100, ttlMs: 100 })).toBe(true);
    expect(isCadenceFresh({ lastPasswordUnlockAt: 0, now: 101, ttlMs: 100 })).toBe(false);
  });
});
