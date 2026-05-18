import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { argon2id, argon2Verify } from "hash-wasm";

import type { KdfParamsJson } from "./types.js";

const SERVER_KDF_PARAMS: KdfParamsJson = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
};

// Mirrors @privance/core's KDF_PARAMS so unknown-user responses are
// indistinguishable from real ones. Any drift here re-opens username
// enumeration via hashLength.
const CLIENT_KDF_PARAMS: KdfParamsJson = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 64,
};

const FAKE_KDF_SALT_LABEL = utf8ToBytes("finance/kdf-params/v1");
const FAKE_RECOVERY_IV_LABEL = utf8ToBytes("finance/fake-recovery-iv/v1");
const FAKE_RECOVERY_WRAPPED_LABEL = utf8ToBytes("finance/fake-wrapped-recovery/v1");
const FAKE_WRAPPED_DEK_RECOVERY_LABEL = utf8ToBytes("finance/fake-wrapped-dek-recovery/v1");
const FAKE_WRAPPED_DEK_RECOVERY_IV_LABEL = utf8ToBytes("finance/fake-wrapped-dek-recovery-iv/v1");

export async function hashAuthHash(authHash: Buffer): Promise<{ hash: string; salt: Buffer }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await argon2id({
    password: authHash,
    salt,
    iterations: SERVER_KDF_PARAMS.timeCost,
    parallelism: SERVER_KDF_PARAMS.parallelism,
    memorySize: SERVER_KDF_PARAMS.memoryCost,
    hashLength: SERVER_KDF_PARAMS.hashLength,
    outputType: "encoded",
  });
  return { hash, salt: Buffer.from(salt) };
}

export async function verifyAuthHash(opts: {
  encoded: string;
  authHash: Buffer;
}): Promise<boolean> {
  try {
    return await argon2Verify({ password: opts.authHash, hash: opts.encoded });
  } catch {
    return false;
  }
}

export function generateSessionToken(): { token: string; raw: Buffer } {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const b64 = Buffer.from(raw).toString("base64url").replace(/=/g, "");
  return { token: b64, raw: Buffer.from(raw) };
}

export function hashSessionToken(raw: Buffer): Buffer {
  const h = sha256.create();
  h.update(raw);
  return Buffer.from(h.digest());
}

export function decodeSessionToken(encoded: string): Buffer {
  const padded = encoded + "=".repeat(-encoded.length & 3);
  return Buffer.from(padded, "base64url");
}

export function deriveFakeKdfSalt(username: string, enumerationSecret: Buffer): Buffer {
  const info = utf8ToBytes(username.toLowerCase());
  const derived = hkdf(sha256, enumerationSecret, FAKE_KDF_SALT_LABEL, info, 16);
  return Buffer.from(derived);
}

export function deriveFakeRecoveryBlob(
  username: string,
  enumerationSecret: Buffer,
): { wrappedBlob: Buffer; blobIv: Buffer } {
  const info = utf8ToBytes(username.toLowerCase());
  const iv = hkdf(sha256, enumerationSecret, FAKE_RECOVERY_IV_LABEL, info, 12);
  const wrapped = hkdf(sha256, enumerationSecret, FAKE_RECOVERY_WRAPPED_LABEL, info, 48);
  return { wrappedBlob: Buffer.from(wrapped), blobIv: Buffer.from(iv) };
}

// Lengths match real wrapped-DEK shapes: iv=12 (AES-GCM nonce), wrapped=48 (32-byte DEK + 16-byte GCM tag).
// Labels are FROZEN, changing them changes every fake payload and breaks indistinguishability.
export function deriveFakeWrappedDekRecovery(
  username: string,
  enumerationSecret: Buffer,
): { wrappedDekRecovery: Buffer; wrappedDekRecoveryIv: Buffer } {
  const info = utf8ToBytes(username.toLowerCase());
  const iv = hkdf(sha256, enumerationSecret, FAKE_WRAPPED_DEK_RECOVERY_IV_LABEL, info, 12);
  const wrapped = hkdf(sha256, enumerationSecret, FAKE_WRAPPED_DEK_RECOVERY_LABEL, info, 48);
  return { wrappedDekRecovery: Buffer.from(wrapped), wrappedDekRecoveryIv: Buffer.from(iv) };
}

export { CLIENT_KDF_PARAMS, SERVER_KDF_PARAMS };
