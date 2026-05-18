import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

export function deriveKey(opts: {
  ikm: Uint8Array;
  salt?: Uint8Array;
  label: string;
  length: number;
}): Uint8Array {
  const info = utf8ToBytes(opts.label);
  return hkdf(sha256, opts.ikm, opts.salt, info, opts.length);
}
