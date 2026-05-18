/**
 * Generic per-user cooldown bucket. Module-level state, one process, one map.
 * Trivially replaceable with Redis for multi-process deployments.
 *
 * Each feature module creates its own bucket instance so per-module cooldowns
 * are independent and per-module typed errors stay in the feature module.
 */

const EVICT_MULTIPLIER = 2;

export type RateLimitBucket = {
  record(userId: string, cooldownMs: number): void;
  msRemaining(userId: string, cooldownMs: number): number;
  gate(userId: string, cooldownMs: number, throwFn: (ms: number) => never): void;
  resetAll(): void;
};

export function createRateLimitBucket(): RateLimitBucket {
  const lastRefresh = new Map<string, number>();

  function evictStale(cooldownMs: number): void {
    const cutoff = Date.now() - EVICT_MULTIPLIER * cooldownMs;
    for (const [userId, ts] of lastRefresh) {
      if (ts < cutoff) lastRefresh.delete(userId);
    }
  }

  return {
    record(userId: string, cooldownMs: number): void {
      lastRefresh.set(userId, Date.now());
      evictStale(cooldownMs);
    },

    msRemaining(userId: string, cooldownMs: number): number {
      const last = lastRefresh.get(userId);
      if (last === undefined) return 0;
      return Math.max(0, cooldownMs - (Date.now() - last));
    },

    gate(userId: string, cooldownMs: number, throwFn: (ms: number) => never): void {
      const ms = this.msRemaining(userId, cooldownMs);
      if (ms > 0) throwFn(ms);
    },

    resetAll(): void {
      lastRefresh.clear();
    },
  };
}
