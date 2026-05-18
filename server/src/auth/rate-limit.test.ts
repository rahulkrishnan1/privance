import { beforeEach, describe, expect, it } from "bun:test";

import {
  evictInactive,
  gateLogin,
  gateSignup,
  recordLoginFailure,
  recordLoginSuccess,
  resetAll,
} from "./rate-limit.js";

// ---------------------------------------------------------------------------
// R2, evictInactive evicts stale keys and is schedulable
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetAll();
});

describe("evictInactive", () => {
  it("is callable without throwing", () => {
    expect(() => evictInactive()).not.toThrow();
  });

  it("after calling evictInactive, fresh signup gates still work", () => {
    gateSignup("hash-ip-1");
    evictInactive();
    // After eviction of empty/active windows we can still gate normally.
    // The eviction only removes truly expired entries; this one is fresh.
    // Subsequent calls within the window should still be counted.
    expect(() => gateSignup("hash-ip-1")).not.toThrow();
  });

  it("can be scheduled with setInterval without error", () => {
    const handle = setInterval(() => evictInactive(), 60_000);
    expect(handle).toBeDefined();
    clearInterval(handle);
  });
});

// ---------------------------------------------------------------------------
// R2, backoff resets on success (verifies progressive backoff state)
// ---------------------------------------------------------------------------

describe("progressive backoff state", () => {
  it("records failure then resets on success", async () => {
    recordLoginFailure("testuser");
    recordLoginFailure("testuser");
    recordLoginSuccess("testuser");
    // After success the backoff should be cleared; gateLogin should not delay.
    // We verify by calling gateLogin and expecting it to resolve quickly.
    const start = Date.now();
    await gateLogin("testuser", "some-hashed-ip");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
