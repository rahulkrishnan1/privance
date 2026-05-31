import { describe, expect, it } from "vitest";
import { computeYDomain, formatYAxisTick } from "./history-chart";

describe("formatYAxisTick", () => {
  it("formats sub-1000 values as plain dollars (fixes $0k bug)", () => {
    expect(formatYAxisTick(450)).toBe("$450");
    expect(formatYAxisTick(750)).toBe("$750");
    expect(formatYAxisTick(0)).toBe("$0");
  });

  it("formats thousands compactly", () => {
    expect(formatYAxisTick(1000)).toBe("$1K");
    expect(formatYAxisTick(1500)).toBe("$1.5K");
    expect(formatYAxisTick(300_000)).toBe("$300K");
  });

  it("formats millions compactly with enough precision to keep zoomed ticks distinct", () => {
    expect(formatYAxisTick(1_500_000)).toBe("$1.5M");
    // Ticks ~10k apart near $1M must render as different labels.
    expect(formatYAxisTick(1_050_000)).toBe("$1.05M");
    expect(formatYAxisTick(1_060_000)).toBe("$1.06M");
    expect(formatYAxisTick(1_050_000)).not.toBe(formatYAxisTick(1_060_000));
  });

  it("keeps the sign on negative values", () => {
    expect(formatYAxisTick(-450)).toBe("-$450");
    expect(formatYAxisTick(-1_500_000)).toBe("-$1.5M");
  });
});

describe("computeYDomain", () => {
  it("zooms to the data range instead of anchoring at $0 (fixes flat-line-at-top)", () => {
    // Three near-equal snapshots around $1.06M (the real-world case that
    // rendered a flat line pinned to the top of a $0-based axis).
    const [lo, hi] = computeYDomain([1_062_000, 1_061_000, 1_061_500]);
    expect(lo).toBeGreaterThan(1_000_000); // not anchored at 0
    expect(lo).toBeLessThan(1_061_000); // sits below the data
    expect(hi).toBeGreaterThan(1_062_000); // sits above the data
  });

  it("keeps a minimum span so a near-flat series does not collapse the axis", () => {
    const [lo, hi] = computeYDomain([1_061_000, 1_061_000]);
    // ~1.5% of value each side (x1.3) -> span comfortably exceeds the 10k that
    // the compact-M formatter needs to render distinct ticks.
    expect(hi - lo).toBeGreaterThan(20_000);
  });

  it("pads a genuinely varying series on both sides", () => {
    const [lo, hi] = computeYDomain([1000, 2000]);
    expect(lo).toBeLessThan(1000);
    expect(hi).toBeGreaterThan(2000);
  });

  it("does not collapse on a single point", () => {
    const [lo, hi] = computeYDomain([5000]);
    expect(lo).toBeLessThan(5000);
    expect(hi).toBeGreaterThan(5000);
  });

  it("returns a safe default for empty data", () => {
    expect(computeYDomain([])).toEqual([0, 1]);
  });
});
