import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyStartVeilOnAuth, readStartVeil, readVeil, writeStartVeil, writeVeil } from "./veil";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("veil storage", () => {
  it("round-trips the figures toggle, defaulting to off", () => {
    expect(readVeil()).toBe(false);
    writeVeil(true);
    expect(readVeil()).toBe(true);
    writeVeil(false);
    expect(readVeil()).toBe(false);
  });

  it("round-trips the start-veiled preference, defaulting to off", () => {
    expect(readStartVeil()).toBe(false);
    writeStartVeil(true);
    expect(readStartVeil()).toBe(true);
    writeStartVeil(false);
    expect(readStartVeil()).toBe(false);
  });
});

describe("applyStartVeilOnAuth", () => {
  it("veils when the start-veiled preference is on", () => {
    writeStartVeil(true);
    writeVeil(false);
    applyStartVeilOnAuth();
    expect(readVeil()).toBe(true);
  });

  it("reveals when the preference is off", () => {
    writeStartVeil(false);
    writeVeil(false);
    applyStartVeilOnAuth();
    expect(readVeil()).toBe(false);
  });

  it("clears a stale veiled toggle when the preference is off", () => {
    writeStartVeil(false);
    writeVeil(true);
    applyStartVeilOnAuth();
    expect(readVeil()).toBe(false);
  });
});

describe("private-mode storage", () => {
  it("degrades gracefully when localStorage throws", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    expect(readVeil()).toBe(false);
    expect(readStartVeil()).toBe(false);
    expect(() => writeVeil(true)).not.toThrow();
    expect(() => writeStartVeil(true)).not.toThrow();
    expect(() => applyStartVeilOnAuth()).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
