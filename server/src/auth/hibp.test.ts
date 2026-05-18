import { describe, expect, it } from "bun:test";

import { authHashToHex, isBreached } from "./hibp.js";

type MockFetch = (url: string, init?: RequestInit) => Promise<Response>;

describe("authHashToHex", () => {
  it("returns uppercase SHA-1 hex of input buffer", () => {
    const buf = Buffer.alloc(32, 0xaa);
    const hex = authHashToHex(buf);
    expect(hex).toMatch(/^[0-9A-F]{40}$/);
  });

  it("produces consistent output for same input", () => {
    const buf = Buffer.from("test input");
    expect(authHashToHex(buf)).toBe(authHashToHex(buf));
  });
});

describe("isBreached, network path", () => {
  it("returns null when fetch throws (network error)", async () => {
    const mockFetch: MockFetch = async () => {
      throw new Error("network error");
    };
    const result = await isBreached("AABBCCDDEE1122334455AABBCCDDEE1122334455XXYYZZ", mockFetch);
    expect(result).toBeNull();
  });

  it("returns null when response is not ok", async () => {
    const mockFetch: MockFetch = async () => new Response("Service Unavailable", { status: 503 });
    const result = await isBreached("AABBCCDDEE1122334455AABBCCDDEE1122334455XXYYZZ", mockFetch);
    expect(result).toBeNull();
  });

  it("returns true when suffix found in response", async () => {
    const authHex = "AABBCCDDEEFF00112233445566778899AABBCCDD11";
    const prefix = authHex.slice(0, 5);
    const suffix = authHex.slice(5);
    const mockFetch: MockFetch = async (url) => {
      if (url.includes(prefix)) {
        return new Response(`${suffix}:42\nDEADBEEFDEAD:1\n`);
      }
      return new Response("", { status: 404 });
    };
    const result = await isBreached(authHex, mockFetch);
    expect(result).toBe(true);
  });

  it("returns false when suffix not found in response", async () => {
    const mockFetch: MockFetch = async () => new Response("DEADBEEFDEADBEEF:1\n");
    const result = await isBreached("AABBCCDDEEFF00112233445566778899AABBCCDD11", mockFetch);
    expect(result).toBe(false);
  });
});
