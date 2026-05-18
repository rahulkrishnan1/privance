import { deriveKey } from "./hkdf.js";
import { LABEL_VERSION, LABELS } from "./labels.js";
import type { AuthHash, KEK, RecoverySeed, StretchedMasterKey } from "./types.js";
import { AUTH_HASH_BYTES } from "./types.js";

export function deriveAuthHash(stretchedKey: StretchedMasterKey): AuthHash {
  const raw = deriveKey({
    ikm: stretchedKey,
    label: LABELS.AUTH,
    length: AUTH_HASH_BYTES,
  });
  return raw as AuthHash;
}

export function deriveKek(stretchedKey: StretchedMasterKey): KEK {
  const raw = deriveKey({
    ikm: stretchedKey,
    label: LABELS.KEK,
    length: 32,
  });
  return raw as KEK;
}

export function deriveRecoverySeed(stretchedKey: StretchedMasterKey): RecoverySeed {
  const raw = deriveKey({
    ikm: stretchedKey,
    label: LABELS.RECOVERY,
    length: 16,
  });
  return raw as RecoverySeed;
}

export { LABEL_VERSION };
