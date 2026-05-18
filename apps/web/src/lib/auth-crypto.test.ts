import type { KdfParamVersion, StretchedMasterKey } from "@privance/core";
import {
  DecryptionError,
  generateItemsKey,
  KDF_PARAM_VERSION,
  phraseToSeed,
  randomBytes,
  seedToPhrase,
} from "@privance/core";
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

// ---------------------------------------------------------------------------
// Deterministic fast stub for stretchMasterPassword, argon2id is too slow
// for unit tests. The stub must return a stable 64-byte key given the same
// (password, salt) pair so round-trip tests still verify the full crypto path.
// ---------------------------------------------------------------------------

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
      kdfParams: signup.kdfParams,
    });
    expect(login.authHash).toBe(signup.authHash);
  });

  it("login round-trip: kek can unwrap the wrapped DEK", async () => {
    const signup = await deriveSignupCrypto({ password: "test-pass-456!" });
    const login = await deriveLoginCrypto({
      password: "test-pass-456!",
      kdfSalt: signup.kdfSalt,
      kdfParams: signup.kdfParams,
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
      recoveryKdfParams: signup.recoveryParams,
      wrappedDekRecovery: signup.wrappedDekRecovery,
      wrappedDekRecoveryIv: signup.wrappedDekRecoveryIv,
    });
    expect(recovered).toEqual(signup.itemsKey);
  });
});

describe("unwrapDek", () => {
  it("throws DecryptionError on wrong KEK", async () => {
    const signup = await deriveSignupCrypto({ password: "correct-pass-123!" });
    const wrongKek = randomBytes(32);
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
      kdfParams: signup.kdfParams,
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
});

describe("deriveRecoveryUnwrap", () => {
  it("throws DecryptionError on wrong phrase", async () => {
    const signup = await deriveSignupCrypto({ password: "test-pass-000!" });
    const wrongPhrase = seedToPhrase(randomBytes(16) as ReturnType<typeof phraseToSeed>);
    await expect(
      deriveRecoveryUnwrap({
        phrase: wrongPhrase,
        recoverySalt: signup.recoverySalt,
        recoveryKdfParams: signup.recoveryParams,
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
      recoveryKdfParams: signup.recoveryParams,
    });
    expect(proof).toBe(signup.recoveryBlob);
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
      recoveryKdfParams: signup.recoveryParams,
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
      kdfParams: newCreds.newKdfParams,
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
      recoveryKdfParams: signup.recoveryParams,
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
      recoveryKdfParams: newCreds.newRecoveryParams,
      wrappedDekRecovery: newCreds.newWrappedDekRecovery,
      wrappedDekRecoveryIv: newCreds.newWrappedDekRecoveryIv,
    });

    expect(recoveredAgain).toEqual(signup.itemsKey);
  });
});
