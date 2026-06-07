import { gcm } from "@noble/ciphers/aes.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { randomNonce } from "./random.js";
import type { AadFields, EncryptedBlob, Nonce } from "./types.js";
import { DecryptionError } from "./types.js";

function buildAad(fields: AadFields): Uint8Array {
  const base: Record<string, unknown> = {
    recordUuid: fields.recordUuid,
    kind: fields.kind,
    labelVersion: fields.labelVersion,
    kdfParamVersion: fields.kdfParamVersion,
  };
  if (fields.pubKeyDigest !== undefined) {
    base.pubKeyDigest = fields.pubKeyDigest;
  }
  return utf8ToBytes(JSON.stringify(base));
}

export function encryptAead(opts: {
  plaintext: Uint8Array;
  key: Uint8Array;
  aad: AadFields;
  nonce?: Nonce;
}): EncryptedBlob {
  const nonce = opts.nonce ?? randomNonce();
  const aadBytes = buildAad(opts.aad);
  const cipher = gcm(opts.key, nonce, aadBytes);
  const ciphertext = cipher.encrypt(opts.plaintext);
  return { ciphertext, nonce };
}

export function decryptAead(opts: {
  ciphertext: Uint8Array;
  nonce: Nonce;
  key: Uint8Array;
  aad: AadFields;
}): Uint8Array {
  const aadBytes = buildAad(opts.aad);
  const cipher = gcm(opts.key, opts.nonce, aadBytes);
  try {
    return cipher.decrypt(opts.ciphertext);
  } catch {
    throw new DecryptionError();
  }
}
