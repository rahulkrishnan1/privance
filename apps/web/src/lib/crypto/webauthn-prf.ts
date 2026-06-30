/**
 * WebAuthn PRF ceremony module. All navigator.credentials interactions live
 * here so the rest of the app sees a simple typed API with an honest error
 * taxonomy.
 *
 * NEVER consult PublicKeyCredential.getClientCapabilities() for PRF support
 * detection: iOS omits "extension:prf" from that list while actually
 * supporting PRF. Gate on isUserVerifyingPlatformAuthenticatorAvailable()
 * only and confirm PRF support from the create result.
 */

/** The user dismissed the OS prompt or denied biometric/UV. */
export class BiometricCancelledError extends Error {
  constructor() {
    super("Biometric prompt cancelled");
    this.name = "BiometricCancelledError";
  }
}

/** No platform authenticator, or PRF extension returned no output after both
 *  the create and the fallback assertion. */
export class BiometricUnsupportedError extends Error {
  constructor(message = "Biometric unlock not supported on this device") {
    super(message);
    this.name = "BiometricUnsupportedError";
  }
}

/** Ceremony completed but the assertion returned no PRF output. Signals that
 *  the stored credential is unusable and should be purged. */
export class BiometricFailureError extends Error {
  constructor(message = "PRF assertion returned no output") {
    super(message);
    this.name = "BiometricFailureError";
  }
}

type EnrollResult = {
  credentialId: Uint8Array;
  prfOutput: Uint8Array;
  salt: Uint8Array;
};

/**
 * Returns true when the device can plausibly support biometric unlock via
 * WebAuthn PRF. Checks secure context + isUserVerifyingPlatformAuthenticatorAvailable.
 * Returns false gracefully when PublicKeyCredential is absent.
 */
export async function isBiometricSupported(): Promise<boolean> {
  if (typeof isSecureContext === "undefined" || !isSecureContext) return false;
  if (typeof PublicKeyCredential === "undefined") return false;
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

/**
 * Creates a passkey with PRF evaluation using the spike-verified parameters.
 * Returns the credential id, a fresh random 32-byte PRF salt, and the PRF
 * output Uint8Array.
 *
 * If create() returns PRF output directly, it is used without a second prompt.
 * If create() reports prf.enabled but no output (allowed by spec), one
 * immediate assertion is performed to obtain it.
 * If PRF is missing after both, throws BiometricUnsupportedError (R16).
 *
 * Throws BiometricCancelledError on NotAllowedError from the OS prompt.
 */
export async function enrollCredential(opts: { username: string }): Promise<EnrollResult> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const salt = crypto.getRandomValues(new Uint8Array(32));

  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        // Hint, clamped by the browser; bounds a stalled authenticator so the
        // pending UI recovers within a minute.
        timeout: 60_000,
        rp: { name: "Privance", id: location.hostname },
        // username labels the passkey in the OS credential manager so entries
        // stay distinguishable across accounts (the OS passkey outlives disablement).
        user: { id: userId, name: opts.username, displayName: opts.username },
        challenge,
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",
          userVerification: "required",
        },
        extensions: { prf: { eval: { first: salt } } },
      },
    })) as PublicKeyCredential;
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotAllowedError") {
      throw new BiometricCancelledError();
    }
    throw e;
  }

  const credentialId = new Uint8Array(cred.rawId);
  const ext = cred.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };

  // Best case: platform returned PRF output at create time.
  if (ext.prf?.results?.first) {
    return { credentialId, prfOutput: new Uint8Array(ext.prf.results.first), salt };
  }

  // prf.enabled means the authenticator supports PRF but withheld output at
  // create time (allowed by spec). Perform one immediate assertion.
  if (ext.prf?.enabled) {
    const prfOutput = await assertPrf({ credentialId, salt });
    return { credentialId, prfOutput, salt };
  }

  throw new BiometricUnsupportedError();
}

/**
 * Performs a WebAuthn assertion with PRF eval against the stored credential.
 * Returns the 32-byte PRF output Uint8Array.
 *
 * Throws BiometricCancelledError on user dismissal.
 * Throws BiometricFailureError if the assertion completes but PRF output is absent.
 */
export async function assertPrf(opts: {
  credentialId: Uint8Array;
  salt: Uint8Array;
}): Promise<Uint8Array> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  // Copy into plain ArrayBuffer-backed views: the caller's Uint8Array may have
  // an ArrayBufferLike (e.g. SharedArrayBuffer) which the WebAuthn API rejects.
  const credId = new Uint8Array(opts.credentialId);
  const prfSalt = new Uint8Array(opts.salt);

  let assertion: PublicKeyCredential;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        timeout: 60_000,
        challenge,
        rpId: location.hostname,
        allowCredentials: [{ type: "public-key", id: credId }],
        userVerification: "required",
        extensions: { prf: { eval: { first: prfSalt } } },
      },
    })) as PublicKeyCredential;
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotAllowedError") {
      throw new BiometricCancelledError();
    }
    throw e;
  }

  const ext = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const first = ext.prf?.results?.first;
  if (!first) throw new BiometricFailureError();

  return new Uint8Array(first);
}
