import { describe, expect, test } from "vitest";
import { fillCount } from "./use-fill-count";

describe("fillCount", () => {
  test("shows every row when total is below the preview (no pad-up)", () => {
    expect(fillCount(1000, 52, 2, 5)).toBe(2);
    expect(fillCount(52, 52, 2, 5)).toBe(2);
  });

  test("floors at the preview when the area fits fewer", () => {
    expect(fillCount(160, 52, 10, 5)).toBe(5);
  });

  test("fills past the preview when the area is tall enough", () => {
    expect(fillCount(364, 52, 10, 5)).toBe(7);
    expect(fillCount(520, 52, 10, 5)).toBe(10);
  });

  test("returns the preview floor when the row is unmeasured", () => {
    expect(fillCount(0, 0, 10, 5)).toBe(5);
    expect(fillCount(500, 0, 3, 5)).toBe(3);
  });
});
