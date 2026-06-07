import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { decryptAead, encryptAead } from "./aead.js";
import { deriveKey } from "./hkdf.js";
import { LABEL_VERSION, LABELS } from "./labels.js";
import { randomNonce } from "./random.js";
import type { AadFields, BiometricKek, EncryptedBlob, Nonce } from "./types.js";
import { InvalidLengthError, KDF_PARAM_VERSION } from "./types.js";

export const BIOMETRIC_PROTECTOR_KIND = "biometric_protector" as const;

const PRF_BYTES = 32;
const SALT_BYTES = 32;

function biometricAad(opts: {
  recordUuid: string;
  pubKeyDigest: string;
  labelVersion: number;
  kdfParamVersion: number;
}): AadFields {
  return {
    recordUuid: opts.recordUuid,
    kind: BIOMETRIC_PROTECTOR_KIND,
    labelVersion: opts.labelVersion,
    kdfParamVersion: opts.kdfParamVersion,
    pubKeyDigest: opts.pubKeyDigest,
  };
}

/**
 * Derives a 32-byte biometric KEK from the WebAuthn PRF output.
 *
 * salt is the per-enrollment random 32-byte value stored in the biometric
 * record. It doubles as the PRF eval input supplied to the WebAuthn ceremony,
 * so one value serves two roles: HKDF salt and prf.eval.first input.
 */
export function deriveBiometricKek(opts: {
  prfOutput: Uint8Array;
  salt: Uint8Array;
}): BiometricKek {
  if (opts.prfOutput.length !== PRF_BYTES) {
    throw new InvalidLengthError("prfOutput", PRF_BYTES, opts.prfOutput.length);
  }
  if (opts.salt.length !== SALT_BYTES) {
    throw new InvalidLengthError("salt", SALT_BYTES, opts.salt.length);
  }

  const kek = deriveKey({
    ikm: opts.prfOutput,
    salt: opts.salt,
    label: LABELS.BIOMETRIC,
    length: 32,
  }) as BiometricKek;

  return kek;
}

export function sealProtectorKey(opts: {
  pkcs8: Uint8Array;
  kek: BiometricKek;
  pubKeyBytes: Uint8Array;
  recordUuid: string;
  labelVersion?: number;
  kdfParamVersion?: number;
  nonce?: Nonce;
}): EncryptedBlob {
  const labelVersion = opts.labelVersion ?? LABEL_VERSION;
  const kdfParamVersion = opts.kdfParamVersion ?? KDF_PARAM_VERSION;
  const pubKeyDigest = bytesToHex(sha256(opts.pubKeyBytes));
  const aad = biometricAad({
    recordUuid: opts.recordUuid,
    pubKeyDigest,
    labelVersion,
    kdfParamVersion,
  });
  const blob = encryptAead({
    plaintext: opts.pkcs8,
    key: opts.kek,
    aad,
    nonce: opts.nonce ?? randomNonce(),
  });
  return blob;
}

export function openProtectorKey(opts: {
  sealed: EncryptedBlob;
  kek: BiometricKek;
  pubKeyBytes: Uint8Array;
  recordUuid: string;
  labelVersion?: number;
  kdfParamVersion?: number;
}): Uint8Array {
  const labelVersion = opts.labelVersion ?? LABEL_VERSION;
  const kdfParamVersion = opts.kdfParamVersion ?? KDF_PARAM_VERSION;
  const pubKeyDigest = bytesToHex(sha256(opts.pubKeyBytes));
  const aad = biometricAad({
    recordUuid: opts.recordUuid,
    pubKeyDigest,
    labelVersion,
    kdfParamVersion,
  });
  const pkcs8 = decryptAead({
    ciphertext: opts.sealed.ciphertext,
    nonce: opts.sealed.nonce,
    key: opts.kek,
    aad,
  });
  return pkcs8;
}
