import type { Nonce } from "./types.js";
import { NONCE_BYTES } from "./types.js";

export function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

export function randomNonce(): Nonce {
  return randomBytes(NONCE_BYTES) as Nonce;
}
