import { equalBytes } from "@noble/ciphers/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { encryptAead } from "./aead.js";
import {
  BIOMETRIC_PROTECTOR_KIND,
  deriveBiometricKek,
  openProtectorKey,
  sealProtectorKey,
} from "./biometric.js";
import { randomNonce } from "./random.js";
import { DecryptionError, InvalidLengthError } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRF_BYTES = 32;
const SALT_BYTES = 32;

function makePrf(fill: number = 0xaa): Uint8Array {
  return new Uint8Array(PRF_BYTES).fill(fill);
}

function makeSalt(fill: number = 0xbb): Uint8Array {
  return new Uint8Array(SALT_BYTES).fill(fill);
}

function makePkcs8(fill: number = 0xcc, len = 64): Uint8Array {
  return new Uint8Array(len).fill(fill);
}

function makePubKey(fill: number = 0xdd, len = 32): Uint8Array {
  return new Uint8Array(len).fill(fill);
}

const FIXED_UUID = "11111111-1111-1111-1111-111111111111";

// ---------------------------------------------------------------------------
// BIOMETRIC_PROTECTOR_KIND constant
// ---------------------------------------------------------------------------

describe("BIOMETRIC_PROTECTOR_KIND", () => {
  it("is the frozen string biometric_protector", () => {
    expect(BIOMETRIC_PROTECTOR_KIND).toBe("biometric_protector");
  });
});

// ---------------------------------------------------------------------------
// deriveBiometricKek
// ---------------------------------------------------------------------------

describe("deriveBiometricKek, determinism", () => {
  it("same PRF output and salt always yields the same KEK", () => {
    const prf = makePrf();
    const salt = makeSalt();
    const a = deriveBiometricKek({ prfOutput: prf, salt });
    const b = deriveBiometricKek({ prfOutput: prf, salt });
    expect(equalBytes(a, b)).toBe(true);
  });

  it("same PRF output with different salt yields a different KEK (fast-check)", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: PRF_BYTES, maxLength: PRF_BYTES }),
        fc.uint8Array({ minLength: SALT_BYTES, maxLength: SALT_BYTES }),
        fc.uint8Array({ minLength: SALT_BYTES, maxLength: SALT_BYTES }),
        (prf, saltA, saltB) => {
          fc.pre(!equalBytes(saltA, saltB));
          const a = deriveBiometricKek({ prfOutput: prf, salt: saltA });
          const b = deriveBiometricKek({ prfOutput: prf, salt: saltB });
          return !equalBytes(a, b);
        },
      ),
    );
  });

  it("snapshot vector: fixed PRF input and salt produce expected hex", () => {
    const prf = new Uint8Array(PRF_BYTES).fill(0x01);
    const salt = new Uint8Array(SALT_BYTES).fill(0x02);
    const kek = deriveBiometricKek({ prfOutput: prf, salt });
    expect(bytesToHex(kek)).toMatchSnapshot();
  });
});

describe("deriveBiometricKek, length validation", () => {
  it("throws InvalidLengthError when PRF output is not 32 bytes", () => {
    expect(() => deriveBiometricKek({ prfOutput: new Uint8Array(16), salt: makeSalt() })).toThrow(
      InvalidLengthError,
    );
  });

  it("throws InvalidLengthError when salt is not 32 bytes", () => {
    expect(() => deriveBiometricKek({ prfOutput: makePrf(), salt: new Uint8Array(16) })).toThrow(
      InvalidLengthError,
    );
  });

  it("throws InvalidLengthError for empty PRF output", () => {
    expect(() => deriveBiometricKek({ prfOutput: new Uint8Array(0), salt: makeSalt() })).toThrow(
      InvalidLengthError,
    );
  });

  it("throws InvalidLengthError for oversized salt", () => {
    expect(() => deriveBiometricKek({ prfOutput: makePrf(), salt: new Uint8Array(64) })).toThrow(
      InvalidLengthError,
    );
  });
});

// ---------------------------------------------------------------------------
// sealProtectorKey / openProtectorKey round-trip
// ---------------------------------------------------------------------------

describe("sealProtectorKey / openProtectorKey, round-trip", () => {
  it("seal then open returns original pkcs8 bytes", () => {
    const prf = makePrf();
    const salt = makeSalt();
    const pkcs8 = makePkcs8();
    const pubKey = makePubKey();
    const kek = deriveBiometricKek({ prfOutput: prf, salt });

    const sealed = sealProtectorKey({
      pkcs8,
      kek,
      pubKeyBytes: pubKey,
      recordUuid: FIXED_UUID,
      labelVersion: 1,
      kdfParamVersion: 1,
    });

    const opened = openProtectorKey({
      sealed,
      kek,
      pubKeyBytes: pubKey,
      recordUuid: FIXED_UUID,
      labelVersion: 1,
      kdfParamVersion: 1,
    });

    expect(equalBytes(opened, pkcs8)).toBe(true);
  });

  it("round-trip for arbitrary 32-byte PRF outputs and arbitrary pkcs8 payloads (fast-check)", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: PRF_BYTES, maxLength: PRF_BYTES }),
        fc.uint8Array({ minLength: SALT_BYTES, maxLength: SALT_BYTES }),
        fc.uint8Array({ minLength: 1, maxLength: 512 }),
        fc.uint8Array({ minLength: 1, maxLength: 128 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        (prf, salt, pkcs8, pubKey, uuid) => {
          const kek = deriveBiometricKek({ prfOutput: prf, salt });
          const sealed = sealProtectorKey({
            pkcs8,
            kek,
            pubKeyBytes: pubKey,
            recordUuid: uuid,
            labelVersion: 1,
            kdfParamVersion: 1,
          });
          const opened = openProtectorKey({
            sealed,
            kek,
            pubKeyBytes: pubKey,
            recordUuid: uuid,
            labelVersion: 1,
            kdfParamVersion: 1,
          });
          return equalBytes(opened, pkcs8);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// openProtectorKey, error branches
// ---------------------------------------------------------------------------

describe("openProtectorKey, wrong PRF output throws DecryptionError", () => {
  it("wrong PRF output yields DecryptionError", () => {
    const prf = makePrf(0x01);
    const wrongPrf = makePrf(0x02);
    const salt = makeSalt();
    const pkcs8 = makePkcs8();
    const pubKey = makePubKey();

    const kek = deriveBiometricKek({ prfOutput: prf, salt });
    const sealed = sealProtectorKey({
      pkcs8,
      kek,
      pubKeyBytes: pubKey,
      recordUuid: FIXED_UUID,
      labelVersion: 1,
      kdfParamVersion: 1,
    });

    const wrongKek = deriveBiometricKek({ prfOutput: wrongPrf, salt });
    expect(() =>
      openProtectorKey({
        sealed,
        kek: wrongKek,
        pubKeyBytes: pubKey,
        recordUuid: FIXED_UUID,
        labelVersion: 1,
        kdfParamVersion: 1,
      }),
    ).toThrow(DecryptionError);
  });
});

describe("openProtectorKey, ciphertext tampering throws DecryptionError", () => {
  it("flipped ciphertext byte throws DecryptionError", () => {
    const kek = deriveBiometricKek({ prfOutput: makePrf(), salt: makeSalt() });
    const pkcs8 = makePkcs8();
    const pubKey = makePubKey();
    const sealed = sealProtectorKey({
      pkcs8,
      kek,
      pubKeyBytes: pubKey,
      recordUuid: FIXED_UUID,
      labelVersion: 1,
      kdfParamVersion: 1,
    });

    const tampered = { ...sealed, ciphertext: sealed.ciphertext.slice() };
    tampered.ciphertext[0] ^= 0xff;

    expect(() =>
      openProtectorKey({
        sealed: tampered,
        kek,
        pubKeyBytes: pubKey,
        recordUuid: FIXED_UUID,
        labelVersion: 1,
        kdfParamVersion: 1,
      }),
    ).toThrow(DecryptionError);
  });
});

describe("openProtectorKey, AAD mismatch throws", () => {
  it("wrong kind throws DecryptionError", () => {
    const kek = deriveBiometricKek({ prfOutput: makePrf(), salt: makeSalt() });
    const pkcs8 = makePkcs8();
    const pubKey = makePubKey();
    const sealed = encryptAead({
      plaintext: pkcs8,
      key: kek,
      aad: {
        recordUuid: FIXED_UUID,
        kind: "items_key",
        labelVersion: 1,
        kdfParamVersion: 1,
        pubKeyDigest: bytesToHex(sha256(pubKey)),
      },
      nonce: randomNonce(),
    });

    expect(() =>
      openProtectorKey({
        sealed,
        kek,
        pubKeyBytes: pubKey,
        recordUuid: FIXED_UUID,
        labelVersion: 1,
        kdfParamVersion: 1,
      }),
    ).toThrow(DecryptionError);
  });

  it("wrong recordUuid throws DecryptionError", () => {
    const kek = deriveBiometricKek({ prfOutput: makePrf(), salt: makeSalt() });
    const pkcs8 = makePkcs8();
    const pubKey = makePubKey();
    const sealed = sealProtectorKey({
      pkcs8,
      kek,
      pubKeyBytes: pubKey,
      recordUuid: FIXED_UUID,
      labelVersion: 1,
      kdfParamVersion: 1,
    });

    expect(() =>
      openProtectorKey({
        sealed,
        kek,
        pubKeyBytes: pubKey,
        recordUuid: "22222222-2222-2222-2222-222222222222",
        labelVersion: 1,
        kdfParamVersion: 1,
      }),
    ).toThrow(DecryptionError);
  });

  it("wrong public-key digest throws DecryptionError", () => {
    const kek = deriveBiometricKek({ prfOutput: makePrf(), salt: makeSalt() });
    const pkcs8 = makePkcs8();
    const pubKey = makePubKey(0xdd);
    const wrongPubKey = makePubKey(0xee);
    const sealed = sealProtectorKey({
      pkcs8,
      kek,
      pubKeyBytes: pubKey,
      recordUuid: FIXED_UUID,
      labelVersion: 1,
      kdfParamVersion: 1,
    });

    expect(() =>
      openProtectorKey({
        sealed,
        kek,
        pubKeyBytes: wrongPubKey,
        recordUuid: FIXED_UUID,
        labelVersion: 1,
        kdfParamVersion: 1,
      }),
    ).toThrow(DecryptionError);
  });
});

// ---------------------------------------------------------------------------
// Default parameter paths (labelVersion and kdfParamVersion omitted)
// ---------------------------------------------------------------------------

describe("sealProtectorKey / openProtectorKey, default versions", () => {
  it("round-trips without explicit labelVersion and kdfParamVersion", () => {
    const kek = deriveBiometricKek({ prfOutput: makePrf(), salt: makeSalt() });
    const pkcs8 = makePkcs8();
    const pubKey = makePubKey();
    const sealed = sealProtectorKey({
      pkcs8,
      kek,
      pubKeyBytes: pubKey,
      recordUuid: FIXED_UUID,
    });
    const opened = openProtectorKey({
      sealed,
      kek,
      pubKeyBytes: pubKey,
      recordUuid: FIXED_UUID,
    });
    expect(equalBytes(opened, pkcs8)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-enrollment substitution
// ---------------------------------------------------------------------------

describe("cross-enrollment substitution throws", () => {
  it("enrollment A sealed blob opened against enrollment B AAD fields throws", () => {
    const prfA = makePrf(0x01);
    const saltA = makeSalt(0x02);
    const prfB = makePrf(0x03);
    const saltB = makeSalt(0x04);
    const pkcs8A = makePkcs8(0x05);
    const pubKeyA = makePubKey(0x06);
    const pubKeyB = makePubKey(0x07);
    const uuidA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const uuidB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    const kekA = deriveBiometricKek({ prfOutput: prfA, salt: saltA });
    const sealedA = sealProtectorKey({
      pkcs8: pkcs8A,
      kek: kekA,
      pubKeyBytes: pubKeyA,
      recordUuid: uuidA,
      labelVersion: 1,
      kdfParamVersion: 1,
    });

    const kekB = deriveBiometricKek({ prfOutput: prfB, salt: saltB });

    // Try to open enrollment A's blob using enrollment B's KEK, pubKey, and uuid
    expect(() =>
      openProtectorKey({
        sealed: sealedA,
        kek: kekB,
        pubKeyBytes: pubKeyB,
        recordUuid: uuidB,
        labelVersion: 1,
        kdfParamVersion: 1,
      }),
    ).toThrow(DecryptionError);
  });
});
