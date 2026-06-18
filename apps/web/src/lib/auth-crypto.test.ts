import type { KdfParamVersion, KEK, StretchedMasterKey } from "@privance/core";
import {
  DecryptionError,
  generateItemsKey,
  KDF_PARAM_VERSION,
  phraseToSeed,
  randomBytes,
  seedToPhrase,
} from "@privance/core";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  b64,
  b64ToBytes,
  deriveLoginCrypto,
  deriveNewCredsAfterRecovery,
  deriveRecoveryProof,
  deriveRecoveryUnwrap,
  deriveSignupCrypto,
  unwrapDek,
} from "./auth-crypto";

// Wiring-only stub: Argon2id is too slow for unit runs; we substitute a
// deterministic digest. These tests exercise wrap/unwrap/AAD wiring, not the
// KDF itself. The real Argon2id path lives in auth-crypto.integration.test.ts.

const FAST_KDF_RESULT_SIZE = 64;

function deterministicKey(password: string, salt: Uint8Array): StretchedMasterKey {
  const key = new Uint8Array(FAST_KDF_RESULT_SIZE);
  const enc = new TextEncoder().encode(password);
  for (let i = 0; i < FAST_KDF_RESULT_SIZE; i++) {
    key[i] = (enc[i % enc.length] ?? 0) ^ (salt[i % salt.length] ?? 0);
  }
  return key as StretchedMasterKey;
}

vi.mock("@privance/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@privance/core")>();
  return {
    ...actual,
    stretchMasterPassword: vi.fn(
      async (opts: {
        password: string;
        salt: Uint8Array;
        version?: KdfParamVersion;
      }): Promise<{ key: StretchedMasterKey; version: KdfParamVersion }> => {
        const version = (opts.version ?? KDF_PARAM_VERSION) as KdfParamVersion;
        return { key: deterministicKey(opts.password, opts.salt), version };
      },
    ),
  };
});

describe("deriveSignupCrypto", () => {
  it("returns all required fields", async () => {
    const result = await deriveSignupCrypto({ password: "hunter2correct!" });
    expect(typeof result.authHash).toBe("string");
    expect(typeof result.kdfSalt).toBe("string");
    expect(typeof result.kdfParams).toBe("object");
    expect(typeof result.recoveryBlob).toBe("string");
    expect(typeof result.recoverySalt).toBe("string");
    expect(typeof result.recoveryParams).toBe("object");
    expect(typeof result.wrappedDek).toBe("string");
    expect(typeof result.wrappedDekIv).toBe("string");
    expect(typeof result.wrappedDekRecovery).toBe("string");
    expect(typeof result.wrappedDekRecoveryIv).toBe("string");
    expect(result.itemsKey).toBeInstanceOf(Uint8Array);
    expect(result.phrase.split(" ")).toHaveLength(12);
  });

  it("produces a valid 12-word BIP39 phrase that round-trips via phraseToSeed", async () => {
    const result = await deriveSignupCrypto({ password: "hunter2correct!" });
    expect(() => phraseToSeed(result.phrase)).not.toThrow();
    expect(phraseToSeed(result.phrase)).toHaveLength(16);
  });

  it("login round-trip: kdfSalt + kdfParams → same authHash", async () => {
    const signup = await deriveSignupCrypto({ password: "test-pass-123!" });
    const login = await deriveLoginCrypto({
      password: "test-pass-123!",
      kdfSalt: signup.kdfSalt,
    });
    expect(login.authHash).toBe(signup.authHash);
  });

  it("login round-trip: kek can unwrap the wrapped DEK", async () => {
    const signup = await deriveSignupCrypto({ password: "test-pass-456!" });
    const login = await deriveLoginCrypto({
      password: "test-pass-456!",
      kdfSalt: signup.kdfSalt,
    });
    const unwrapped = unwrapDek({
      wrappedDek: signup.wrappedDek,
      wrappedDekIv: signup.wrappedDekIv,
      kek: login.kek,
      kdfParamVersion: login.kdfParamVersion,
    });
    expect(unwrapped).toEqual(signup.itemsKey);
  });

  it("recovery round-trip: phrase + recoverySalt → same itemsKey", async () => {
    const signup = await deriveSignupCrypto({ password: "test-pass-789!" });
    const recovered = await deriveRecoveryUnwrap({
      phrase: signup.phrase,
      recoverySalt: signup.recoverySalt,
      wrappedDekRecovery: signup.wrappedDekRecovery,
      wrappedDekRecoveryIv: signup.wrappedDekRecoveryIv,
    });
    expect(recovered).toEqual(signup.itemsKey);
  });
});

describe("unwrapDek", () => {
  it("throws DecryptionError on wrong KEK", async () => {
    const signup = await deriveSignupCrypto({ password: "correct-pass-123!" });
    const wrongKek = randomBytes(32) as KEK;
    expect(() =>
      unwrapDek({
        wrappedDek: signup.wrappedDek,
        wrappedDekIv: signup.wrappedDekIv,
        kek: wrongKek,
        kdfParamVersion: signup.kdfParamVersion,
      }),
    ).toThrow(DecryptionError);
  });

  it("throws DecryptionError on tampered ciphertext", async () => {
    const signup = await deriveSignupCrypto({ password: "correct-pass-456!" });
    const tamperedBytes = b64ToBytes(signup.wrappedDek);
    tamperedBytes.set([(tamperedBytes[0] ?? 0) ^ 0xff], 0);
    const tampered = b64(tamperedBytes);

    const login = await deriveLoginCrypto({
      password: "correct-pass-456!",
      kdfSalt: signup.kdfSalt,
    });
    expect(() =>
      unwrapDek({
        wrappedDek: tampered,
        wrappedDekIv: signup.wrappedDekIv,
        kek: login.kek,
        kdfParamVersion: login.kdfParamVersion,
      }),
    ).toThrow(DecryptionError);
  });

  it("rejects a downgraded kdfParamVersion even with the correct KEK", async () => {
    // kdfParamVersion is bound into the AEAD AAD. Unwrapping the DEK while
    // claiming a different param version must fail, so a downgrade attack on
    // the stored version cannot trick the client into accepting weaker KDF
    // params. Cast simulates a future/forged version since only 1 exists today.
    const signup = await deriveSignupCrypto({ password: "downgrade-pass-1!" });
    const login = await deriveLoginCrypto({
      password: "downgrade-pass-1!",
      kdfSalt: signup.kdfSalt,
    });
    expect(() =>
      unwrapDek({
        wrappedDek: signup.wrappedDek,
        wrappedDekIv: signup.wrappedDekIv,
        kek: login.kek,
        kdfParamVersion: (signup.kdfParamVersion + 1) as KdfParamVersion,
      }),
    ).toThrow(DecryptionError);
  });
});

describe("deriveRecoveryUnwrap", () => {
  it("throws DecryptionError on wrong phrase", async () => {
    const signup = await deriveSignupCrypto({ password: "test-pass-000!" });
    const wrongPhrase = seedToPhrase(randomBytes(16) as ReturnType<typeof phraseToSeed>);
    await expect(
      deriveRecoveryUnwrap({
        phrase: wrongPhrase,
        recoverySalt: signup.recoverySalt,
        wrappedDekRecovery: signup.wrappedDekRecovery,
        wrappedDekRecoveryIv: signup.wrappedDekRecoveryIv,
      }),
    ).rejects.toThrow(DecryptionError);
  });

  it("throws DecryptionError when the recovery salt does not match", async () => {
    const signup = await deriveSignupCrypto({ password: "test-pass-001!" });
    const wrongSalt = b64(randomBytes(16));
    await expect(
      deriveRecoveryUnwrap({
        phrase: signup.phrase,
        recoverySalt: wrongSalt,
        wrappedDekRecovery: signup.wrappedDekRecovery,
        wrappedDekRecoveryIv: signup.wrappedDekRecoveryIv,
      }),
    ).rejects.toThrow(DecryptionError);
  });
});

describe("deriveRecoveryProof", () => {
  it("returns same value as recoveryBlob from signup", async () => {
    const signup = await deriveSignupCrypto({ password: "test-proof-pass!" });
    const proof = await deriveRecoveryProof({
      phrase: signup.phrase,
      recoverySalt: signup.recoverySalt,
    });
    expect(proof).toBe(signup.recoveryBlob);
  });

  it("a wrong phrase yields a different proof", async () => {
    const signup = await deriveSignupCrypto({ password: "test-proof-pass-2!" });
    const wrongPhrase = seedToPhrase(randomBytes(16) as ReturnType<typeof phraseToSeed>);
    const proof = await deriveRecoveryProof({
      phrase: wrongPhrase,
      recoverySalt: signup.recoverySalt,
    });
    expect(proof).not.toBe(signup.recoveryBlob);
  });

  it("a wrong salt yields a different proof", async () => {
    const signup = await deriveSignupCrypto({ password: "test-proof-pass-3!" });
    const proof = await deriveRecoveryProof({
      phrase: signup.phrase,
      recoverySalt: b64(randomBytes(16)),
    });
    expect(proof).not.toBe(signup.recoveryBlob);
  });
});

describe("deriveNewCredsAfterRecovery", () => {
  it("returns all required fields including a new 12-word phrase", async () => {
    const itemsKey = generateItemsKey();
    const result = await deriveNewCredsAfterRecovery({
      newPassword: "brand-new-pass-123!",
      itemsKey,
    });
    expect(typeof result.newAuthHash).toBe("string");
    expect(typeof result.newKdfSalt).toBe("string");
    expect(typeof result.newWrappedDek).toBe("string");
    expect(typeof result.newWrappedDekRecovery).toBe("string");
    expect(result.newPhrase.split(" ")).toHaveLength(12);
  });

  it("full recovery → new-login round-trip preserves itemsKey", async () => {
    const signup = await deriveSignupCrypto({ password: "original-pass!" });

    const recoveredItemsKey = await deriveRecoveryUnwrap({
      phrase: signup.phrase,
      recoverySalt: signup.recoverySalt,
      wrappedDekRecovery: signup.wrappedDekRecovery,
      wrappedDekRecoveryIv: signup.wrappedDekRecoveryIv,
    });

    const newCreds = await deriveNewCredsAfterRecovery({
      newPassword: "new-pass-after-recovery!",
      itemsKey: recoveredItemsKey,
    });

    const newLogin = await deriveLoginCrypto({
      password: "new-pass-after-recovery!",
      kdfSalt: newCreds.newKdfSalt,
    });

    const unwrapped = unwrapDek({
      wrappedDek: newCreds.newWrappedDek,
      wrappedDekIv: newCreds.newWrappedDekIv,
      kek: newLogin.kek,
      kdfParamVersion: newLogin.kdfParamVersion,
    });

    expect(unwrapped).toEqual(signup.itemsKey);
  });

  it("new recovery phrase from deriveNewCredsAfterRecovery can unwrap newWrappedDekRecovery", async () => {
    const signup = await deriveSignupCrypto({ password: "original-pass-2!" });
    const recoveredItemsKey = await deriveRecoveryUnwrap({
      phrase: signup.phrase,
      recoverySalt: signup.recoverySalt,
      wrappedDekRecovery: signup.wrappedDekRecovery,
      wrappedDekRecoveryIv: signup.wrappedDekRecoveryIv,
    });

    const newCreds = await deriveNewCredsAfterRecovery({
      newPassword: "new-pass-after-recovery-2!",
      itemsKey: recoveredItemsKey,
    });

    const recoveredAgain = await deriveRecoveryUnwrap({
      phrase: newCreds.newPhrase,
      recoverySalt: newCreds.newRecoverySalt,
      wrappedDekRecovery: newCreds.newWrappedDekRecovery,
      wrappedDekRecoveryIv: newCreds.newWrappedDekRecoveryIv,
    });

    expect(recoveredAgain).toEqual(signup.itemsKey);
  });
});

describe("auth-crypto round-trip properties", () => {
  it("login round-trip recovers the items key for any password", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 64 }), async (password) => {
        const signup = await deriveSignupCrypto({ password });
        const login = await deriveLoginCrypto({ password, kdfSalt: signup.kdfSalt });
        expect(login.authHash).toBe(signup.authHash);
        const unwrapped = unwrapDek({
          wrappedDek: signup.wrappedDek,
          wrappedDekIv: signup.wrappedDekIv,
          kek: login.kek,
          kdfParamVersion: login.kdfParamVersion,
        });
        expect(unwrapped).toEqual(signup.itemsKey);
      }),
      { numRuns: 25 },
    );
  });

  it("recovery round-trip recovers the items key for any password", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 64 }), async (password) => {
        const signup = await deriveSignupCrypto({ password });
        const recovered = await deriveRecoveryUnwrap({
          phrase: signup.phrase,
          recoverySalt: signup.recoverySalt,
          wrappedDekRecovery: signup.wrappedDekRecovery,
          wrappedDekRecoveryIv: signup.wrappedDekRecoveryIv,
        });
        expect(recovered).toEqual(signup.itemsKey);
      }),
      { numRuns: 25 },
    );
  });
});
