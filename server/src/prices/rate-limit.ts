import { createRateLimitBucket } from "../core/rate-limit.js";
import { RateLimitedError } from "./types.js";

const DEFAULT_COOLDOWN_MS = 30_000;

const bucket = createRateLimitBucket();

/** Records a successful refresh for userId. Call after the upstream fetch succeeds. */
export function recordRefresh(userId: string, cooldownMs = DEFAULT_COOLDOWN_MS): void {
  bucket.record(userId, cooldownMs);
}

/** Returns ms remaining in the cooldown window, or 0 if the user is free to refresh. */
export function msUntilNextRefresh(userId: string, cooldownMs = DEFAULT_COOLDOWN_MS): number {
  return bucket.msRemaining(userId, cooldownMs);
}

/** Throws RateLimitedError if the user is within their cooldown window. */
export function gateRefresh(userId: string, cooldownMs = DEFAULT_COOLDOWN_MS): void {
  bucket.gate(userId, cooldownMs, (ms) => {
    throw new RateLimitedError(ms);
  });
}

/** Clear all state. For tests only. */
export function resetAll(): void {
  bucket.resetAll();
}
