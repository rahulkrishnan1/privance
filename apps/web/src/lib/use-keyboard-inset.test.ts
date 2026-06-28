import { describe, expect, test } from "vitest";
import { keyboardInset } from "./use-keyboard-inset";

describe("keyboardInset", () => {
  test("no keyboard when the viewport fills the window", () => {
    expect(keyboardInset(800, 800, 0)).toEqual({ height: 0, available: null });
  });

  test("reports keyboard height and remaining space when the viewport shrinks", () => {
    expect(keyboardInset(800, 500, 0)).toEqual({ height: 300, available: 500 });
  });

  test("subtracts the viewport offset (page scrolled under the keyboard)", () => {
    expect(keyboardInset(800, 460, 40)).toEqual({ height: 300, available: 460 });
  });

  test("ignores sub-keyboard insets (toolbar collapse jitter)", () => {
    expect(keyboardInset(800, 720, 0)).toEqual({ height: 0, available: null });
  });

  test("never returns a negative height", () => {
    expect(keyboardInset(800, 900, 0)).toEqual({ height: 0, available: null });
  });
});
