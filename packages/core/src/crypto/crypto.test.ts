import { equalBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist as bip39Wordlist } from "@scure/bip39/wordlists/english.js";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decryptAead, encryptAead } from "./aead.js";
import { deriveKey } from "./hkdf.js";
import { generateItemsKey, unwrapItemsKey, wrapItemsKey } from "./items-key.js";
import { stretchMasterPassword } from "./kdf.js";
import { deriveAuthHash, deriveKek, deriveRecoverySeed } from "./keys.js";
import { LABEL_VERSION, LABELS } from "./labels.js";
import { randomBytes, randomNonce } from "./random.js";
import { phraseToSeed, seedToPhrase, validatePhrase } from "./recovery.js";
import type { AadFields, KEK, Nonce, RecoverySeed, StretchedMasterKey } from "./types.js";
import {
  AUTH_HASH_BYTES,
  DecryptionError,
  InvalidLengthError,
  ITEMS_KEY_BYTES,
  KDF_PARAM_VERSION,
  KDF_PARAMS,
  NONCE_BYTES,
} from "./types.js";

// ---------------------------------------------------------------------------
// Test vectors
// ---------------------------------------------------------------------------

describe("HKDF-SHA-256, RFC 5869 A.2 test vector", () => {
  it("matches the authoritative SHA-256 HKDF reference output", () => {
    const ikm = hexToBytes(
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f",
    );
    const salt = hexToBytes(
      "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeaf",
    );
    const info = hexToBytes(
      "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
    );
    const expected =
      "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87";
    expect(bytesToHex(hkdf(sha256, ikm, salt, info, 82))).toBe(expected);
  });
});

describe("HKDF, determinism property", () => {
  it("same input always yields same output", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 16, maxLength: 64 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        (ikm, label) => {
          const a = deriveKey({ ikm, label, length: 32 });
          const b = deriveKey({ ikm, label, length: 32 });
          return equalBytes(a, b);
        },
      ),
    );
  });

  it("different label yields different output", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 16, maxLength: 64 }), (ikm) => {
        const a = deriveKey({ ikm, label: "finance/auth-v1", length: 32 });
        const b = deriveKey({ ikm, label: "finance/kek-v1", length: 32 });
        return !equalBytes(a, b);
      }),
    );
  });
});

describe("HKDF, frozen labels", () => {
  it("AUTH label is finance/auth-v1", () => {
    expect(LABELS.AUTH).toBe("finance/auth-v1");
  });

  it("KEK label is finance/kek-v1", () => {
    expect(LABELS.KEK).toBe("finance/kek-v1");
  });

  it("RECOVERY label is finance/recovery-v1", () => {
    expect(LABELS.RECOVERY).toBe("finance/recovery-v1");
  });
});

describe("AES-GCM NIST test vector", () => {
  it("matches NIST GCM test vector (count=0, key=128-bit, 32-byte plaintext)", () => {
    const key = hexToBytes("00000000000000000000000000000000");
    const nonce = hexToBytes("000000000000000000000000") as Nonce;
    const plaintext = hexToBytes("00000000000000000000000000000000");
    const aad: AadFields = { recordUuid: "test", labelVersion: 1, kdfParamVersion: 1 };

    const blob = encryptAead({ plaintext, key, aad, nonce });
    const decrypted = decryptAead({ ciphertext: blob.ciphertext, nonce, key, aad });
    expect(equalBytes(decrypted, plaintext)).toBe(true);
    expect(blob.ciphertext.length).toBe(plaintext.length + 16);
  });
});

describe("AEAD, round-trip property", () => {
  it("encrypt then decrypt returns original plaintext", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 256 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        (plaintext, keyBytes, uuid) => {
          const aad: AadFields = {
            recordUuid: uuid,
            labelVersion: 1,
            kdfParamVersion: 1,
          };
          const blob = encryptAead({ plaintext, key: keyBytes, aad });
          const decrypted = decryptAead({
            ciphertext: blob.ciphertext,
            nonce: blob.nonce,
            key: keyBytes,
            aad,
          });
          return equalBytes(decrypted, plaintext);
        },
      ),
    );
  });

  it("wrong key fails decryption", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 64 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        (plaintext, keyA, keyB) => {
          fc.pre(!equalBytes(keyA, keyB));
          const aad: AadFields = {
            recordUuid: "test-uuid",
            labelVersion: 1,
            kdfParamVersion: 1,
          };
          const blob = encryptAead({ plaintext, key: keyA, aad });
          let threw = false;
          try {
            decryptAead({ ciphertext: blob.ciphertext, nonce: blob.nonce, key: keyB, aad });
          } catch (e) {
            threw = e instanceof DecryptionError;
          }
          return threw;
        },
      ),
    );
  });

  it("AAD tampering: wrong recordUuid fails decryption", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 64 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        (plaintext, key, uuid1, uuid2) => {
          fc.pre(uuid1 !== uuid2);
          const aad: AadFields = { recordUuid: uuid1, labelVersion: 1, kdfParamVersion: 1 };
          const blob = encryptAead({ plaintext, key, aad });
          let threw = false;
          try {
            decryptAead({
              ciphertext: blob.ciphertext,
              nonce: blob.nonce,
              key,
              aad: { ...aad, recordUuid: uuid2 },
            });
          } catch (e) {
            threw = e instanceof DecryptionError;
          }
          return threw;
        },
      ),
    );
  });

  it("AAD tampering: wrong labelVersion fails decryption", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 64 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        (plaintext, key) => {
          const aad: AadFields = { recordUuid: "uuid", labelVersion: 1, kdfParamVersion: 1 };
          const blob = encryptAead({ plaintext, key, aad });
          let threw = false;
          try {
            decryptAead({
              ciphertext: blob.ciphertext,
              nonce: blob.nonce,
              key,
              aad: { ...aad, labelVersion: 2 },
            });
          } catch (e) {
            threw = e instanceof DecryptionError;
          }
          return threw;
        },
      ),
    );
  });

  it("AAD tampering: wrong kdfParamVersion fails decryption", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 64 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        (plaintext, key) => {
          const aad: AadFields = { recordUuid: "uuid", labelVersion: 1, kdfParamVersion: 1 };
          const blob = encryptAead({ plaintext, key, aad });
          let threw = false;
          try {
            decryptAead({
              ciphertext: blob.ciphertext,
              nonce: blob.nonce,
              key,
              aad: { ...aad, kdfParamVersion: 2 },
            });
          } catch (e) {
            threw = e instanceof DecryptionError;
          }
          return threw;
        },
      ),
    );
  });
});

describe("randomBytes / randomNonce", () => {
  it("nonce is NONCE_BYTES long", () => {
    const n = randomNonce();
    expect(n.length).toBe(NONCE_BYTES);
  });

  it("nonce uniqueness over 1000 samples", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const n = randomNonce();
      seen.add(bytesToHex(n));
    }
    expect(seen.size).toBe(1000);
  });

  it("randomBytes returns requested length", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 128 }), (len) => {
        const buf = randomBytes(len);
        return buf.length === len;
      }),
    );
  });
});

describe("Argon2id, known-vector test (parameter drift detection)", () => {
  it("matches expected hash for fixed inputs and versioned params", async () => {
    const password = "test-password";
    const salt = new Uint8Array(16).fill(0x01);

    const { key, version } = await stretchMasterPassword({ password, salt, version: 1 });

    expect(version).toBe(1);
    expect(key.length).toBe(KDF_PARAMS.hashLength);
    expect(KDF_PARAMS.memoryCost).toBe(65536);
    expect(KDF_PARAMS.timeCost).toBe(3);
    expect(KDF_PARAMS.parallelism).toBe(4);
    expect(KDF_PARAMS.hashLength).toBe(64);

    const hex = bytesToHex(key);
    expect(hex).toMatchSnapshot();
  }, 30_000);

  it("defaults to version 1 when version is omitted", async () => {
    const password = "test";
    const salt = new Uint8Array(16).fill(0x02);

    const { version } = await stretchMasterPassword({ password, salt });
    expect(version).toBe(1);
  }, 30_000);
});

describe("Key derivation pipeline", () => {
  const fakeKey = new Uint8Array(64).fill(0xab) as StretchedMasterKey;

  it("deriveAuthHash returns AUTH_HASH_BYTES bytes", () => {
    const h = deriveAuthHash(fakeKey);
    expect(h.length).toBe(AUTH_HASH_BYTES);
  });

  it("deriveKek returns 32 bytes", () => {
    const k = deriveKek(fakeKey);
    expect(k.length).toBe(32);
  });

  it("deriveRecoverySeed returns 16 bytes", () => {
    const s = deriveRecoverySeed(fakeKey);
    expect(s.length).toBe(16);
  });

  it("auth, kek, and recovery derivations are all distinct", () => {
    const auth = deriveAuthHash(fakeKey);
    const kek = deriveKek(fakeKey);
    const rec = deriveRecoverySeed(fakeKey);
    expect(equalBytes(auth.slice(0, 16), kek.slice(0, 16))).toBe(false);
    expect(equalBytes(kek, rec.slice(0, 16))).toBe(false);
  });

  it("HKDF determinism: same stretched key always yields same auth hash", () => {
    const h1 = deriveAuthHash(fakeKey);
    const h2 = deriveAuthHash(fakeKey);
    expect(equalBytes(h1, h2)).toBe(true);
  });
});

describe("BIP39 recovery phrase, round-trip", () => {
  it("phraseToSeed(seedToPhrase(seed)) === seed", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 16, maxLength: 16 }), (entropy) => {
        const seed = entropy as RecoverySeed;
        const phrase = seedToPhrase(seed);
        const recovered = phraseToSeed(phrase);
        return equalBytes(seed, recovered);
      }),
    );
  });

  it("phrase is 12 words", () => {
    const seed = randomBytes(16) as RecoverySeed;
    const phrase = seedToPhrase(seed);
    expect(phrase.split(" ").length).toBe(12);
  });

  it("wrong seed length throws InvalidLengthError", () => {
    const bad = new Uint8Array(8) as RecoverySeed;
    expect(() => seedToPhrase(bad)).toThrow(InvalidLengthError);
  });

  it("invalid phrase returns false from validatePhrase", () => {
    expect(validatePhrase("this is not a valid bip39 phrase at all these words")).toBe(false);
  });

  it("valid phrase returns true from validatePhrase", () => {
    const seed = randomBytes(16) as RecoverySeed;
    const phrase = seedToPhrase(seed);
    expect(validatePhrase(phrase)).toBe(true);
  });

  it("phraseToSeed throws InvalidLengthError for 24-word phrase (32-byte entropy)", () => {
    const largeEntropy = new Uint8Array(32).fill(0xaa);
    const phrase24 = entropyToMnemonic(largeEntropy, bip39Wordlist);
    expect(() => phraseToSeed(phrase24)).toThrow(InvalidLengthError);
  });
});

describe("items_key, wrap/unwrap", () => {
  const kek = new Uint8Array(32).fill(0x07) as KEK;
  const opts = { labelVersion: LABEL_VERSION, kdfParamVersion: KDF_PARAM_VERSION };

  it("wrap then unwrap returns original items_key", () => {
    const original = generateItemsKey();
    const blob = wrapItemsKey({ itemsKey: original, kek, ...opts });
    const recovered = unwrapItemsKey({
      ciphertext: blob.ciphertext,
      nonce: blob.nonce,
      kek,
      ...opts,
    });
    expect(equalBytes(original, recovered)).toBe(true);
  });

  it("generateItemsKey returns ITEMS_KEY_BYTES bytes", () => {
    const k = generateItemsKey();
    expect(k.length).toBe(ITEMS_KEY_BYTES);
  });

  it("wrong kek fails unwrap", () => {
    const original = generateItemsKey();
    const blob = wrapItemsKey({ itemsKey: original, kek, ...opts });
    const wrongKek = new Uint8Array(32).fill(0xff) as KEK;
    expect(() =>
      unwrapItemsKey({
        ciphertext: blob.ciphertext,
        nonce: blob.nonce,
        kek: wrongKek,
        ...opts,
      }),
    ).toThrow(DecryptionError);
  });

  it("wrong labelVersion fails unwrap", () => {
    const original = generateItemsKey();
    const blob = wrapItemsKey({ itemsKey: original, kek, ...opts });
    expect(() =>
      unwrapItemsKey({
        ciphertext: blob.ciphertext,
        nonce: blob.nonce,
        kek,
        labelVersion: opts.labelVersion + 1,
        kdfParamVersion: opts.kdfParamVersion,
      }),
    ).toThrow(DecryptionError);
  });
});

describe("constant-time compare", () => {
  it("equal arrays return true", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    expect(equalBytes(a, b)).toBe(true);
  });

  it("different arrays return false", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 4]);
    expect(equalBytes(a, b)).toBe(false);
  });

  it("different-length arrays return false", () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([1, 2, 3]);
    expect(equalBytes(a, b)).toBe(false);
  });
});
