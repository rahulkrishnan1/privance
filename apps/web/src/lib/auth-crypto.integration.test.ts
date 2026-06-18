/**
 * Integration test running the REAL Argon2id KDF (no stub). The unit suite in
 * auth-crypto.test.ts substitutes a fast XOR digest to exercise the wrap/unwrap
 * wiring; this proves the production derivation path round-trips end to end. In
 * the test environment the KDF worker is unavailable, so the in-thread argon2id
 * fallback runs, which is what we want to verify here.
 */

import { DecryptionError } from "@privance/core";
import { describe, expect, it } from "vitest";
import {
  deriveLoginCrypto,
  deriveRecoveryProof,
  deriveRecoveryUnwrap,
  deriveSignupCrypto,
  unwrapDek,
} from "./auth-crypto";

const PASSWORD = "integration-master-pass-9!";

// Real argon2id derivations (signup runs several) are the slow part.
const TIMEOUT_MS = 60_000;

describe("auth-crypto with the real Argon2id KDF", () => {
  it(
    "signup -> login unwraps the same items key",
    async () => {
      const signup = await deriveSignupCrypto({ password: PASSWORD });
      const login = await deriveLoginCrypto({ password: PASSWORD, kdfSalt: signup.kdfSalt });

      expect(login.authHash).toBe(signup.authHash);

      const unwrapped = unwrapDek({
        wrappedDek: signup.wrappedDek,
        wrappedDekIv: signup.wrappedDekIv,
        kek: login.kek,
        kdfParamVersion: login.kdfParamVersion,
      });
      expect(unwrapped).toEqual(signup.itemsKey);
    },
    TIMEOUT_MS,
  );

  it(
    "signup -> recovery unwraps the same items key and proof matches",
    async () => {
      const signup = await deriveSignupCrypto({ password: PASSWORD });

      const recovered = await deriveRecoveryUnwrap({
        phrase: signup.phrase,
        recoverySalt: signup.recoverySalt,
        wrappedDekRecovery: signup.wrappedDekRecovery,
        wrappedDekRecoveryIv: signup.wrappedDekRecoveryIv,
      });
      expect(recovered).toEqual(signup.itemsKey);

      const proof = await deriveRecoveryProof({
        phrase: signup.phrase,
        recoverySalt: signup.recoverySalt,
      });
      expect(proof).toBe(signup.recoveryBlob);
    },
    TIMEOUT_MS,
  );

  it(
    "a wrong password derives a KEK that cannot unwrap the DEK",
    async () => {
      const signup = await deriveSignupCrypto({ password: PASSWORD });
      const wrongLogin = await deriveLoginCrypto({
        password: "not-the-master-pass!",
        kdfSalt: signup.kdfSalt,
      });

      expect(wrongLogin.authHash).not.toBe(signup.authHash);
      expect(() =>
        unwrapDek({
          wrappedDek: signup.wrappedDek,
          wrappedDekIv: signup.wrappedDekIv,
          kek: wrongLogin.kek,
          kdfParamVersion: wrongLogin.kdfParamVersion,
        }),
      ).toThrow(DecryptionError);
    },
    TIMEOUT_MS,
  );
});
