/**
 * random.ts -- Seeded PRNG for cross-engine-reproducible simulation.
 *
 * Algorithm: xmur3 string-to-state seeding, sfc32 generator.
 * Reference: https://github.com/bryc/code/blob/master/jshash/PRNGs.md
 *
 * Design constraint: ALL arithmetic is pure 32-bit integer (>>> 0 discipline).
 * No transcendentals, no Math.* of any kind. This guarantees bit-identical
 * output across V8, JSC, SpiderMonkey, and Bun.
 *
 * Output contract: [0, 1) as a 64-bit float formed by dividing a 32-bit
 * unsigned integer by 2^32. The division is exact (2^32 is a power of two,
 * representable as a float64 without rounding), so this boundary is also
 * engine-independent.
 */

import type { Sfc32State, SimSeed } from "./types.js";

// ---------------------------------------------------------------------------
// xmur3: string -> 4 x uint32 seed state
// ---------------------------------------------------------------------------

/**
 * Hashes a seed string into four 32-bit unsigned integers using xmur3.
 * Pure integer arithmetic only.
 */
export function xmur3Seed(seed: SimSeed): Sfc32State {
  // xmur3: each character mixed into a running uint32 hash, then the hash
  // is "churned" four times to produce four independent state words.
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353) >>> 0;
    h = ((h << 13) | (h >>> 19)) >>> 0;
  }
  function next(): number {
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }
  return {
    a: next(),
    b: next(),
    c: next(),
    d: next(),
  };
}

// ---------------------------------------------------------------------------
// sfc32: state + generator
// ---------------------------------------------------------------------------

/**
 * Mutable sfc32 state container. Pure 32-bit integer arithmetic.
 * Use makeSfc32 to create; call next() to advance.
 */
export interface Sfc32 {
  /** Advance state and return a float in [0, 1). */
  next(): number;
}

/**
 * Create a sfc32 generator from a seed state.
 */
export function makeSfc32(state: Sfc32State): Sfc32 {
  let a = state.a >>> 0;
  let b = state.b >>> 0;
  let c = state.c >>> 0;
  let d = state.d >>> 0;

  return {
    next() {
      const t = (a + b) >>> 0;
      // sfc32 mix
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) >>> 0;
      c = ((c << 21) | (c >>> 11)) >>> 0;
      d = (d + 1) >>> 0;
      const result = ((t + d) >>> 0) >>> 0;
      c = (c + result) >>> 0;
      // Divide by 2^32 -- exact (power of two, no rounding).
      return result / 4294967296;
    },
  };
}

/**
 * Convenience: create a sfc32 generator seeded from a string.
 */
export function seededRng(seed: SimSeed): Sfc32 {
  return makeSfc32(xmur3Seed(seed));
}
