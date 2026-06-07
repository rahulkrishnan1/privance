import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertPrf,
  BiometricCancelledError,
  BiometricFailureError,
  BiometricUnsupportedError,
  enrollCredential,
  isBiometricSupported,
} from "./webauthn-prf.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCredential(opts: {
  rawId?: Uint8Array;
  prfEnabled?: boolean;
  prfFirst?: ArrayBuffer | null;
}): PublicKeyCredential {
  const rawId = opts.rawId ?? new Uint8Array([1, 2, 3, 4]);
  const prfResults =
    opts.prfFirst !== null && opts.prfFirst !== undefined ? { first: opts.prfFirst } : undefined;
  return {
    rawId,
    getClientExtensionResults: () => ({
      prf: {
        enabled: opts.prfEnabled ?? false,
        ...(prfResults !== undefined ? { results: prfResults } : {}),
      },
    }),
  } as unknown as PublicKeyCredential;
}

function makePrfOutput(): ArrayBuffer {
  return crypto.getRandomValues(new Uint8Array(32)).buffer;
}

function notAllowedError(): DOMException {
  return new DOMException("User cancelled", "NotAllowedError");
}

// happy-dom does not define WebAuthn globals. Provide minimal stubs so tests
// can mock through them without touching isSecureContext.
function setupWebAuthnStubs(): void {
  const isUVPAA = vi.fn().mockResolvedValue(true);
  Object.defineProperty(globalThis, "PublicKeyCredential", {
    writable: true,
    configurable: true,
    value: { isUserVerifyingPlatformAuthenticatorAvailable: isUVPAA },
  });
  // happy-dom defines navigator but not credentials. Attach a stub object.
  Object.defineProperty(globalThis.navigator, "credentials", {
    writable: true,
    configurable: true,
    value: { create: vi.fn(), get: vi.fn() },
  });
  // Ensure isSecureContext is truthy so isBiometricSupported does not short-circuit.
  Object.defineProperty(globalThis, "isSecureContext", {
    writable: true,
    configurable: true,
    value: true,
  });
}

// ---------------------------------------------------------------------------
// isBiometricSupported
// ---------------------------------------------------------------------------

describe("isBiometricSupported", () => {
  beforeEach(() => {
    setupWebAuthnStubs();
  });

  it("returns false when isUVPAA returns false", async () => {
    vi.spyOn(
      PublicKeyCredential,
      "isUserVerifyingPlatformAuthenticatorAvailable",
    ).mockResolvedValue(false);
    expect(await isBiometricSupported()).toBe(false);
  });

  it("returns true when isUVPAA returns true", async () => {
    vi.spyOn(
      PublicKeyCredential,
      "isUserVerifyingPlatformAuthenticatorAvailable",
    ).mockResolvedValue(true);
    expect(await isBiometricSupported()).toBe(true);
  });

  it("returns false outside a secure context", async () => {
    Object.defineProperty(globalThis, "isSecureContext", {
      writable: true,
      configurable: true,
      value: false,
    });
    expect(await isBiometricSupported()).toBe(false);
  });

  it("returns false when PublicKeyCredential is absent", async () => {
    Reflect.deleteProperty(globalThis, "PublicKeyCredential");
    expect(await isBiometricSupported()).toBe(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// enrollCredential
// ---------------------------------------------------------------------------

describe("enrollCredential", () => {
  beforeEach(() => {
    setupWebAuthnStubs();
    vi.spyOn(navigator.credentials, "create");
    vi.spyOn(navigator.credentials, "get");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns PRF output from create when platform provides it immediately", async () => {
    const prfFirst = makePrfOutput();
    const cred = makeCredential({ prfFirst, prfEnabled: true });
    vi.mocked(navigator.credentials.create).mockResolvedValue(cred);

    const result = await enrollCredential({ username: "alice" });

    // create returned PRF: no assertion should be fired
    expect(navigator.credentials.get).not.toHaveBeenCalled();
    const createArgs = vi.mocked(navigator.credentials.create).mock
      .calls[0]?.[0] as CredentialCreationOptions;
    expect(createArgs.publicKey?.user.name).toBe("alice");
    expect(result.prfOutput).toBeInstanceOf(Uint8Array);
    expect(result.prfOutput).toHaveLength(32);
    expect(result.credentialId).toBeInstanceOf(Uint8Array);
    expect(result.salt).toHaveLength(32);
  });

  it("falls back to exactly one assertion when create returns enabled-without-output", async () => {
    // prf.enabled = true, but no results at create time
    const credNoOutput = makeCredential({ prfEnabled: true, prfFirst: null });
    vi.mocked(navigator.credentials.create).mockResolvedValue(credNoOutput);

    const assertionPrfFirst = makePrfOutput();
    const assertionCred = makeCredential({ prfFirst: assertionPrfFirst });
    vi.mocked(navigator.credentials.get).mockResolvedValue(assertionCred);

    const result = await enrollCredential({ username: "alice" });

    expect(navigator.credentials.get).toHaveBeenCalledOnce();
    expect(result.prfOutput).toEqual(new Uint8Array(assertionPrfFirst));
  });

  it("throws BiometricUnsupportedError when neither create nor prf.enabled signals PRF", async () => {
    // No prf.enabled, no prf.results
    const cred = makeCredential({ prfEnabled: false, prfFirst: null });
    vi.mocked(navigator.credentials.create).mockResolvedValue(cred);

    await expect(enrollCredential({ username: "alice" })).rejects.toBeInstanceOf(
      BiometricUnsupportedError,
    );
    expect(navigator.credentials.get).not.toHaveBeenCalled();
  });

  it("throws BiometricCancelledError when create rejects with NotAllowedError", async () => {
    vi.mocked(navigator.credentials.create).mockRejectedValue(notAllowedError());
    await expect(enrollCredential({ username: "alice" })).rejects.toBeInstanceOf(
      BiometricCancelledError,
    );
  });

  it("maps NotAllowedError during the fallback assertion to cancelled", async () => {
    const credNoOutput = makeCredential({ prfEnabled: true, prfFirst: null });
    vi.mocked(navigator.credentials.create).mockResolvedValue(credNoOutput);
    vi.mocked(navigator.credentials.get).mockRejectedValue(notAllowedError());

    await expect(enrollCredential({ username: "alice" })).rejects.toBeInstanceOf(
      BiometricCancelledError,
    );
  });
});

// ---------------------------------------------------------------------------
// assertPrf
// ---------------------------------------------------------------------------

describe("assertPrf", () => {
  const credentialId = new Uint8Array([10, 20, 30]);
  const salt = crypto.getRandomValues(new Uint8Array(32));

  beforeEach(() => {
    setupWebAuthnStubs();
    vi.spyOn(navigator.credentials, "get");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the PRF output Uint8Array on success", async () => {
    const prfFirst = makePrfOutput();
    const cred = makeCredential({ prfFirst });
    vi.mocked(navigator.credentials.get).mockResolvedValue(cred);

    const output = await assertPrf({ credentialId, salt });

    expect(output).toBeInstanceOf(Uint8Array);
    expect(output).toHaveLength(32);
    expect(output).toEqual(new Uint8Array(prfFirst));
  });

  it("throws BiometricCancelledError on NotAllowedError from get", async () => {
    vi.mocked(navigator.credentials.get).mockRejectedValue(notAllowedError());
    await expect(assertPrf({ credentialId, salt })).rejects.toBeInstanceOf(BiometricCancelledError);
  });

  it("throws BiometricFailureError when assertion returns no PRF output", async () => {
    const cred = makeCredential({ prfEnabled: true, prfFirst: null });
    vi.mocked(navigator.credentials.get).mockResolvedValue(cred);

    await expect(assertPrf({ credentialId, salt })).rejects.toBeInstanceOf(BiometricFailureError);
  });
});
