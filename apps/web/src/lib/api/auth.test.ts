import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  kdfParams,
  login,
  logout,
  passwordChange,
  recoveryDeriveParams,
  recoveryReset,
  session,
  signup,
} from "./auth";
import { ApiError } from "./client";

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

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function err(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

const MOCK_KDF_PARAMS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 64,
};

describe("kdfParams", () => {
  it("happy path, returns kdf response", async () => {
    const expected = { kdf_algo: "argon2id", kdf_params: MOCK_KDF_PARAMS, kdf_salt: "abc123" };
    mockFetch.mockResolvedValueOnce(ok(expected));
    const result = await kdfParams("alice");
    expect(result.kdf_algo).toBe("argon2id");
    expect(result.kdf_salt).toBe("abc123");
  });

  it("posts to /api/auth/kdf-params with CSRF header", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({ kdf_algo: "argon2id", kdf_params: MOCK_KDF_PARAMS, kdf_salt: "x" }),
    );
    await kdfParams("alice");
    const init = lastCallInit();
    expect(init.method?.toUpperCase()).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("X-Requested-With")).toBe("privance-web");
  });

  it("propagates 401 as ApiError", async () => {
    mockFetch.mockResolvedValueOnce(err(401, "unauthenticated"));
    await expect(kdfParams("alice")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("signup", () => {
  const payload = {
    username: "alice",
    auth_hash: "aabbcc",
    kdf_salt: "salt",
    kdf_params: MOCK_KDF_PARAMS,
    recovery_blob: "blob",
    recovery_salt: "rsalt",
    recovery_params: MOCK_KDF_PARAMS,
    wrapped_dek: "wdek",
    wrapped_dek_iv: "wdekiv",
    wrapped_dek_recovery: "wdekrecovery",
    wrapped_dek_recovery_iv: "wdekrecoveryiv",
  };

  it("happy path, returns user_id", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ user_id: "uid-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await signup(payload);
    expect(result.user_id).toBe("uid-1");
  });

  it("409 username taken → ApiError", async () => {
    mockFetch.mockResolvedValueOnce(err(409, "username_taken"));
    await expect(signup(payload)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("login", () => {
  it("happy path, returns user_id and wrapped_dek", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({ user_id: "uid-1", wrapped_dek: "wdek", wrapped_dek_iv: "wdekiv" }),
    );
    const result = await login({ username: "alice", auth_hash: "hash" });
    expect(result.user_id).toBe("uid-1");
    expect(result.wrapped_dek).toBe("wdek");
  });

  it("401 bad credentials → ApiError", async () => {
    mockFetch.mockResolvedValueOnce(err(401, "invalid_credentials"));
    await expect(login({ username: "alice", auth_hash: "bad" })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("logout", () => {
  it("happy path, returns status ok", async () => {
    mockFetch.mockResolvedValueOnce(ok({ status: "ok" }));
    const result = await logout();
    expect(result.status).toBe("ok");
  });
});

describe("session", () => {
  it("happy path, returns user_id and expires_at", async () => {
    mockFetch.mockResolvedValueOnce(ok({ user_id: "uid-1", expires_at: "2026-01-01T00:00:00Z" }));
    const result = await session();
    expect(result.user_id).toBe("uid-1");
    expect(result.expires_at).toBe("2026-01-01T00:00:00Z");
  });

  it("uses GET method (no CSRF)", async () => {
    mockFetch.mockResolvedValueOnce(ok({ user_id: "uid-1", expires_at: "2026-01-01T00:00:00Z" }));
    await session();
    const init = lastCallInit();
    const headers = new Headers(init.headers);
    expect(headers.get("X-Requested-With")).toBeNull();
  });

  it("401 unauthenticated → ApiError", async () => {
    mockFetch.mockResolvedValueOnce(err(401, "unauthenticated"));
    await expect(session()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("recoveryDeriveParams", () => {
  it("happy path", async () => {
    const expected = {
      kdf_algo: "argon2id",
      kdf_params: MOCK_KDF_PARAMS,
      kdf_salt: "ksalt",
      recovery_blob: "blob",
      recovery_salt: "rsalt",
      recovery_params: MOCK_KDF_PARAMS,
      wrapped_dek_recovery: "wdr",
      wrapped_dek_recovery_iv: "wdriv",
    };
    mockFetch.mockResolvedValueOnce(ok(expected));
    const result = await recoveryDeriveParams("alice");
    expect(result.recovery_blob).toBe("blob");
  });
});

describe("recoveryReset", () => {
  const payload = {
    username: "alice",
    recovery_proof: "proof",
    new_auth_hash: "hash",
    new_kdf_salt: "salt",
    new_kdf_params: MOCK_KDF_PARAMS,
    new_recovery_blob: "blob",
    new_recovery_salt: "rsalt",
    new_recovery_params: MOCK_KDF_PARAMS,
    new_wrapped_dek: "wdek",
    new_wrapped_dek_iv: "wdekiv",
    new_wrapped_dek_recovery: "wdekrecovery",
    new_wrapped_dek_recovery_iv: "wdekrecoveryiv",
  };

  it("happy path, returns user_id", async () => {
    mockFetch.mockResolvedValueOnce(ok({ user_id: "uid-1" }));
    const result = await recoveryReset(payload);
    expect(result.user_id).toBe("uid-1");
  });

  it("401 recovery failed → ApiError", async () => {
    mockFetch.mockResolvedValueOnce(err(401, "recovery_failed"));
    await expect(recoveryReset(payload)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("passwordChange", () => {
  const payload = {
    current_auth_hash: "current",
    new_auth_hash: "hash",
    new_kdf_salt: "salt",
    new_kdf_params: MOCK_KDF_PARAMS,
    new_recovery_blob: "blob",
    new_recovery_salt: "rsalt",
    new_recovery_params: MOCK_KDF_PARAMS,
    new_wrapped_dek: "wdek",
    new_wrapped_dek_iv: "wdekiv",
    new_wrapped_dek_recovery: "wdekrecovery",
    new_wrapped_dek_recovery_iv: "wdekrecoveryiv",
  };

  it("happy path, resolves without error", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    await expect(passwordChange(payload)).resolves.toBeUndefined();
  });

  it("sends the current auth hash so the server can verify it", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    await passwordChange(payload);
    const [, init] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(init.body as string).current_auth_hash).toBe("current");
  });
});
