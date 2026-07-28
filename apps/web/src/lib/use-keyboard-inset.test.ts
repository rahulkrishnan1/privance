import { describe, expect, test } from "vitest";
import { keyboardInset, keyboardInsetStyle } from "./use-keyboard-inset";

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

describe("keyboardInsetStyle", () => {
  test("falls back to the given max-height when no keyboard is shown", () => {
    expect(keyboardInsetStyle({ height: 0, available: null }, "90vh")).toEqual({
      "--kb-bottom": "0px",
      "--kb-maxh": "90vh",
    });
  });

  test("lifts the bottom edge and caps height to the space left when a keyboard is shown", () => {
    expect(keyboardInsetStyle({ height: 300, available: 500 }, "90vh")).toEqual({
      "--kb-bottom": "300px",
      "--kb-maxh": "500px",
    });
  });
});
