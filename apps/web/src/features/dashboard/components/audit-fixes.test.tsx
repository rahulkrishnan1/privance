import { describe, expect, it } from "vitest";
import { EMPTY_PIE_FILL } from "../palette";

describe("EMPTY_PIE_FILL", () => {
  it("is a subtle dark-surface token, not the old near-white fill", () => {
    expect(EMPTY_PIE_FILL).toBe("rgba(255,255,255,0.08)");
    expect(EMPTY_PIE_FILL).not.toMatch(/^#e/i);
  });
});
