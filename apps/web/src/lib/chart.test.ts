import { describe, expect, it } from "vitest";
import { niceTicks } from "./chart";

describe("niceTicks", () => {
  it("produces round, evenly spaced ticks from zero", () => {
    const ticks = niceTicks(4_300_000);
    expect(ticks[0]).toBe(0);
    const step = ticks[1] - ticks[0];
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 6);
    }
    // Step is a 1/2/2.5/5 x 10^n value, so every tick is a clean number.
    expect(step).toBe(1_000_000);
  });

  it("covers the max so the data fits under the top tick", () => {
    for (const max of [4_300_000, 950_000, 16_800_000, 1, 73]) {
      const ticks = niceTicks(max);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
    }
  });

  it("keeps the top tick close above the max (bounded headroom)", () => {
    // The largest tick is the first step-multiple at or above max, so headroom
    // never exceeds a full step. This is what prevents a stray unlabeled
    // gridline above the top label in the fan chart.
    const max = 4_300_000;
    const ticks = niceTicks(max);
    const step = ticks[1] - ticks[0];
    expect(ticks[ticks.length - 1] - max).toBeLessThan(step);
  });

  it("returns a usable axis for non-positive input", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(-5)).toEqual([0, 1]);
  });
});
