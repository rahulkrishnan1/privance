import { RateLimitedError } from "./types.js";

/** Cap to prevent unbounded growth under high cardinality (e.g. a botnet that
 *  cycles through tens of thousands of hashed IPs faster than the eviction
 *  sweep can run). Oldest entries are dropped first. */
const SLIDING_WINDOW_MAX_KEYS = 100_000;

class SlidingWindow {
  private readonly events: Map<string, number[]> = new Map();

  constructor(
    private readonly windowMs: number,
    private readonly maxCount: number,
  ) {}

  hit(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const current = (this.events.get(key) ?? []).filter((t) => t > cutoff);
    if (current.length >= this.maxCount) return false;
    current.push(now);
    // Map preserves insertion order. Re-setting the key would move it to the
    // tail; instead delete-then-set so the LRU eviction is straightforward.
    this.events.delete(key);
    this.events.set(key, current);
    if (this.events.size > SLIDING_WINDOW_MAX_KEYS) {
      const oldest = this.events.keys().next().value;
      if (oldest !== undefined) this.events.delete(oldest);
    }
    return true;
  }

  evictEmpty(): void {
    const now = Date.now();
    for (const [key, times] of this.events) {
      const active = times.filter((t) => t > now - this.windowMs);
      if (active.length === 0) this.events.delete(key);
      else this.events.set(key, active);
    }
  }

  reset(): void {
    this.events.clear();
  }
}

class ProgressiveBackoff {
  private readonly failCounts: Map<string, number> = new Map();

  constructor(
    private readonly baseMs: number,
    private readonly capMs: number,
  ) {}

  recordFailure(key: string): void {
    this.failCounts.set(key, (this.failCounts.get(key) ?? 0) + 1);
  }

  recordSuccess(key: string): void {
    this.failCounts.delete(key);
  }

  delayMs(key: string): number {
    const n = this.failCounts.get(key) ?? 0;
    if (n === 0) return 0;
    return Math.min(this.capMs, this.baseMs * 2 ** (n - 1));
  }

  reset(): void {
    this.failCounts.clear();
  }
}

// Login caps are overridable so the E2E suite, which reuses a few fixture users
// across many specs and projects from a single IP, is not throttled by the
// production defaults. Unset in production, where the defaults below apply.
const loginPerUsernameMax = Number(process.env.RATE_LIMIT_LOGIN_PER_USERNAME) || 5;
const loginPerIpMax = Number(process.env.RATE_LIMIT_LOGIN_PER_IP) || 20;

const loginPerUsername = new SlidingWindow(60_000, loginPerUsernameMax);
const loginPerIp = new SlidingWindow(60_000, loginPerIpMax);
const signupPerIp = new SlidingWindow(60_000, 3);
const recoveryPerUsername = new SlidingWindow(3_600_000, 5);
const recoveryPerIp = new SlidingWindow(3_600_000, 10);
const loginBackoff = new ProgressiveBackoff(250, 4_000);
const recoveryBackoff = new ProgressiveBackoff(500, 8_000);

export function gateSignup(hashedIp: string): void {
  if (!signupPerIp.hit(hashedIp)) throw new RateLimitedError("too many signups");
}

export async function gateLogin(username: string, hashedIp: string): Promise<void> {
  if (!loginPerUsername.hit(`u:${username.toLowerCase()}`)) {
    throw new RateLimitedError("too many login attempts");
  }
  if (!loginPerIp.hit(hashedIp)) throw new RateLimitedError("too many login attempts");
  const delay = loginBackoff.delayMs(`u:${username.toLowerCase()}`);
  if (delay > 0) await Bun.sleep(delay);
}

export async function gateRecovery(username: string, hashedIp: string): Promise<void> {
  if (!recoveryPerUsername.hit(`u:${username.toLowerCase()}`)) {
    throw new RateLimitedError("too many recovery attempts");
  }
  if (!recoveryPerIp.hit(hashedIp)) throw new RateLimitedError("too many recovery attempts");
  const delay = recoveryBackoff.delayMs(`u:${username.toLowerCase()}`);
  if (delay > 0) await Bun.sleep(delay);
}

export function recordLoginFailure(username: string): void {
  loginBackoff.recordFailure(`u:${username.toLowerCase()}`);
}

export function recordLoginSuccess(username: string): void {
  loginBackoff.recordSuccess(`u:${username.toLowerCase()}`);
}

export function recordRecoveryFailure(username: string): void {
  recoveryBackoff.recordFailure(`u:${username.toLowerCase()}`);
}

export function recordRecoverySuccess(username: string): void {
  recoveryBackoff.recordSuccess(`u:${username.toLowerCase()}`);
}

export function getLoginBackoffDelayMs(username: string): number {
  return loginBackoff.delayMs(`u:${username.toLowerCase()}`);
}

export function getRecoveryBackoffDelayMs(username: string): number {
  return recoveryBackoff.delayMs(`u:${username.toLowerCase()}`);
}

export function evictInactive(): void {
  loginPerUsername.evictEmpty();
  loginPerIp.evictEmpty();
  signupPerIp.evictEmpty();
  recoveryPerUsername.evictEmpty();
  recoveryPerIp.evictEmpty();
}

export function resetAll(): void {
  loginPerUsername.reset();
  loginPerIp.reset();
  signupPerIp.reset();
  recoveryPerUsername.reset();
  recoveryPerIp.reset();
  loginBackoff.reset();
  recoveryBackoff.reset();
}
