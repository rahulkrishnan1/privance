import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { batch, changes, del, get, put } from "./sync";

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

function lastCallInit(): RequestInit {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return (call?.[1] ?? {}) as RequestInit;
}

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

describe("put", () => {
  it("happy path, returns server_seq and version", async () => {
    mockFetch.mockResolvedValueOnce(ok({ server_seq: "42", version: "1" }));
    const result = await put("obj-1", {
      kind: "account",
      ciphertext: "ct",
      nonce: "nonce",
      version: "1",
    });
    expect(result.server_seq).toBe("42");
    expect(result.version).toBe("1");
  });

  it("sends CSRF header on PUT", async () => {
    mockFetch.mockResolvedValueOnce(ok({ server_seq: "1", version: "1" }));
    await put("obj-1", { kind: "account", ciphertext: "ct", nonce: "nonce", version: "1" });
    const headers = new Headers(lastCallInit().headers);
    expect(headers.get("X-Requested-With")).toBe("privance-web");
  });

  it("409 conflict → ApiError", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ current_version: "7" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      put("obj-1", { kind: "account", ciphertext: "ct", nonce: "nonce", version: "1" }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("get", () => {
  it("happy path, returns object fields", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({
        object_id: "obj-1",
        kind: "account",
        ciphertext: "ct",
        nonce: "nonce",
        version: "2",
        server_seq: "10",
      }),
    );
    const result = await get("obj-1");
    expect(result.object_id).toBe("obj-1");
    expect(result.kind).toBe("account");
  });

  it("404 not found → ApiError", async () => {
    mockFetch.mockResolvedValueOnce(err(404, "not_found"));
    await expect(get("obj-1")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("del", () => {
  it("happy path, resolves on 204", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(del("obj-1", "1")).resolves.toBeUndefined();
  });

  it("sends CSRF header on DELETE", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await del("obj-1", "1");
    const headers = new Headers(lastCallInit().headers);
    expect(headers.get("X-Requested-With")).toBe("privance-web");
  });

  it("401 → ApiError", async () => {
    mockFetch.mockResolvedValueOnce(err(401, "unauthenticated"));
    await expect(del("obj-1", "1")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("changes", () => {
  it("happy path, returns changes array", async () => {
    const change = {
      id: "obj-1",
      kind: "account",
      version: "1",
      server_seq: "5",
      ciphertext: "ct",
      nonce: "nonce",
      tombstone: false,
    };
    mockFetch.mockResolvedValueOnce(ok({ changes: [change], next: "5" }));
    const result = await changes("0", 100);
    expect(result.changes).toHaveLength(1);
    expect(result.next).toBe("5");
  });

  it("uses GET (no CSRF)", async () => {
    mockFetch.mockResolvedValueOnce(ok({ changes: [], next: null }));
    await changes("0", 100);
    const headers = new Headers(lastCallInit().headers);
    expect(headers.get("X-Requested-With")).toBeNull();
  });
});

describe("batch", () => {
  it("happy path, returns batch results", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({
        results: [{ id: "obj-1", ok: true, server_seq: "1", version: "1" }],
      }),
    );
    const result = await batch({
      puts: [{ object_id: "obj-1", kind: "account", ciphertext: "ct", nonce: "n", version: "1" }],
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.ok).toBe(true);
  });

  it("sends CSRF header on POST", async () => {
    mockFetch.mockResolvedValueOnce(ok({ results: [] }));
    await batch({ puts: [], deletes: [] });
    const headers = new Headers(lastCallInit().headers);
    expect(headers.get("X-Requested-With")).toBe("privance-web");
  });
});
