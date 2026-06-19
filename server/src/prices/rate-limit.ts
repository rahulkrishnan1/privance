import { createRateLimitBucket } from "../core/rate-limit.js";
import type { DataSource } from "./types.js";

const DEFAULT_COOLDOWN_MS = 30_000;

const bucket = createRateLimitBucket();

// Per (user, source) so the parallel provider refreshes don't gate each other.
function key(userId: string, source: DataSource): string {
  return `${userId}:${source}`;
}

/** Records a refresh for (userId, source). Call when an upstream fetch is made. */
export function recordRefresh(
  userId: string,
  source: DataSource,
  cooldownMs = DEFAULT_COOLDOWN_MS,
): void {
  bucket.record(key(userId, source), cooldownMs);
}

/** Returns ms remaining in the (userId, source) cooldown window, or 0 if free. */
export function msUntilNextRefresh(
  userId: string,
  source: DataSource,
  cooldownMs = DEFAULT_COOLDOWN_MS,
): number {
  return bucket.msRemaining(key(userId, source), cooldownMs);
}

/** Clear all state. For tests only. */
export function resetAll(): void {
  bucket.resetAll();
}
