import { describe, expect, it } from "vitest";
import { isSessionFresh, SESSION_TTL_MS } from "./session-vault";

describe("isSessionFresh", () => {
  it("is fresh at the moment of activity", () => {
    expect(isSessionFresh({ lastActiveAt: 1000, now: 1000 })).toBe(true);
  });

  it("is fresh up to and including the exact TTL boundary", () => {
    expect(isSessionFresh({ lastActiveAt: 0, now: SESSION_TTL_MS })).toBe(true);
  });

  it("is stale one millisecond past the TTL", () => {
    expect(isSessionFresh({ lastActiveAt: 0, now: SESSION_TTL_MS + 1 })).toBe(false);
  });

  it("treats a backwards clock as stale (fail-closed)", () => {
    expect(isSessionFresh({ lastActiveAt: 5000, now: 4000 })).toBe(false);
  });

  it("honours an explicit ttlMs override", () => {
    expect(isSessionFresh({ lastActiveAt: 0, now: 100, ttlMs: 100 })).toBe(true);
    expect(isSessionFresh({ lastActiveAt: 0, now: 101, ttlMs: 100 })).toBe(false);
  });
});
