export { decryptAead, encryptAead } from "./aead.js";
export {
  BIOMETRIC_PROTECTOR_KIND,
  deriveBiometricKek,
  openProtectorKey,
  sealProtectorKey,
} from "./biometric.js";
export { equalBytes } from "./compare.js";
export { deriveKey } from "./hkdf.js";
export { generateItemsKey, unwrapItemsKey, wrapItemsKey } from "./items-key.js";
export type { KdfParams, KdfParamVersion } from "./kdf.js";
export { KDF_PARAM_SETS, stretchMasterPassword } from "./kdf.js";
export { deriveAuthHash, deriveKek, deriveRecoverySeed } from "./keys.js";
export type { LabelKey } from "./labels.js";
export { LABEL_VERSION, LABELS } from "./labels.js";

export { randomBytes, randomNonce } from "./random.js";
export { phraseToSeed, seedToPhrase, validatePhrase } from "./recovery.js";
export type {
  AadFields,
  AuthHash,
  BiometricKek,
  EncryptedBlob,
  ItemsKey,
  KEK,
  Nonce,
  RecoverySeed,
  StretchedMasterKey,
} from "./types.js";
export {
  AUTH_HASH_BYTES,
  CryptoError,
  DecryptionError,
  InvalidLengthError,
  ITEMS_KEY_BYTES,
  KDF_PARAM_VERSION,
  KDF_PARAMS,
  NONCE_BYTES,
  SALT_BYTES,
  TAG_BYTES,
} from "./types.js";
