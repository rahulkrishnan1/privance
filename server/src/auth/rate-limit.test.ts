import { beforeEach, describe, expect, it } from "bun:test";

import {
  evictInactive,
  gateLogin,
  gateSignup,
  recordLoginFailure,
  recordLoginSuccess,
  resetAll,
} from "./rate-limit.js";

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
    expect(() => gateSignup("hash-ip-1")).not.toThrow();
  });

  it("can be scheduled with setInterval without error", () => {
    const handle = setInterval(() => evictInactive(), 60_000);
    expect(handle).toBeDefined();
    clearInterval(handle);
  });
});

describe("progressive backoff state", () => {
  it("accumulated failures delay the next gate, and a success removes that delay", async () => {
    // Two failures put the user into backoff (base 250 ms, doubling). The gate
    // after them must sleep noticeably; we assert it against the known base, not
    // a bare upper bound that could pass even if backoff were broken.
    recordLoginFailure("backoff-user");
    recordLoginFailure("backoff-user");

    const delayedStart = Date.now();
    await gateLogin("backoff-user", "ip-a");
    const delayedElapsed = Date.now() - delayedStart;
    // After 2 failures the delay is base * 2^(2-1) = 500 ms; allow scheduler slack.
    expect(delayedElapsed).toBeGreaterThanOrEqual(400);

    // A success clears the failure counter, so the next gate does not sleep.
    recordLoginSuccess("backoff-user");
    const clearedStart = Date.now();
    await gateLogin("backoff-user", "ip-a");
    const clearedElapsed = Date.now() - clearedStart;
    expect(clearedElapsed).toBeLessThan(delayedElapsed);
    expect(clearedElapsed).toBeLessThan(100);
  });
});
