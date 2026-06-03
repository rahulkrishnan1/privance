import type { ItemsKey, KdfParams, KdfParamVersion, KEK, Nonce } from "@privance/core";
import {
  DecryptionError,
  deriveAuthHash,
  deriveKek,
  deriveRecoverySeed,
  generateItemsKey,
  KDF_PARAM_SETS,
  KDF_PARAM_VERSION,
  LABEL_VERSION,
  phraseToSeed,
  randomBytes,
  SALT_BYTES,
  seedToPhrase,
  unwrapItemsKey,
  wrapItemsKey,
} from "@privance/core";
import { stretchMasterPasswordInWorker as stretchMasterPassword } from "@/lib/crypto/kdf";

export type { ItemsKey };

export type SignupCryptoResult = {
  authHash: string; // base64
  kdfSalt: string; // base64
  kdfParams: KdfParams;
  kdfParamVersion: KdfParamVersion;
  recoveryBlob: string; // base64, proof of phrase knowledge for server
  recoverySalt: string; // base64
  recoveryParams: KdfParams;
  wrappedDek: string; // base64
  wrappedDekIv: string; // base64
  wrappedDekRecovery: string; // base64
  wrappedDekRecoveryIv: string; // base64
  itemsKey: ItemsKey;
  phrase: string; // 12-word BIP39, caller must display and then discard
};

export type LoginCryptoResult = {
  authHash: string; // base64
  kek: Uint8Array;
  kdfParamVersion: KdfParamVersion;
};

export type RecoveryNewCredsResult = {
  newAuthHash: string; // base64
  newKdfSalt: string; // base64
  newKdfParams: KdfParams;
  newRecoveryBlob: string; // base64
  newRecoverySalt: string; // base64
  newRecoveryParams: KdfParams;
  newWrappedDek: string; // base64
  newWrappedDekIv: string; // base64
  newWrappedDekRecovery: string; // base64
  newWrappedDekRecoveryIv: string; // base64
  newPhrase: string; // caller must display; old phrase is now invalid
};

export function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function b64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function deriveSignupCrypto(opts: { password: string }): Promise<SignupCryptoResult> {
  const kdfSaltBytes = randomBytes(SALT_BYTES);
  const { key: stretched, version: kdfParamVersion } = await stretchMasterPassword({
    password: opts.password,
    salt: kdfSaltBytes,
    version: KDF_PARAM_VERSION,
  });

  const authHashBytes = deriveAuthHash(stretched);
  const kek = deriveKek(stretched);
  const itemsKey = generateItemsKey();

  const kdfParamsObj = KDF_PARAM_SETS[kdfParamVersion];
  const { ciphertext: wrappedDekBytes, nonce: wrappedDekNonce } = wrapItemsKey({
    itemsKey,
    kek,
    labelVersion: LABEL_VERSION,
    kdfParamVersion,
  });

  const recoverySaltBytes = randomBytes(SALT_BYTES);
  const recoverySeed = deriveRecoverySeed(stretched);
  const phrase = seedToPhrase(recoverySeed);
  const seedBytes = phraseToSeed(phrase);

  const seedString = String.fromCharCode(...seedBytes);
  const { key: recoveryStretched, version: recoveryKdfParamVersion } = await stretchMasterPassword({
    password: seedString,
    salt: recoverySaltBytes,
    version: KDF_PARAM_VERSION,
  });

  const recoveryAuthHashBytes = deriveAuthHash(recoveryStretched);
  const recoveryKek = deriveKek(recoveryStretched);

  const { ciphertext: wrappedDekRecoveryBytes, nonce: wrappedDekRecoveryNonce } = wrapItemsKey({
    itemsKey,
    kek: recoveryKek,
    labelVersion: LABEL_VERSION,
    kdfParamVersion: recoveryKdfParamVersion,
  });

  return {
    authHash: b64(authHashBytes),
    kdfSalt: b64(kdfSaltBytes),
    kdfParams: kdfParamsObj,
    kdfParamVersion,
    recoveryBlob: b64(recoveryAuthHashBytes),
    recoverySalt: b64(recoverySaltBytes),
    recoveryParams: KDF_PARAM_SETS[recoveryKdfParamVersion],
    wrappedDek: b64(wrappedDekBytes),
    wrappedDekIv: b64(wrappedDekNonce),
    wrappedDekRecovery: b64(wrappedDekRecoveryBytes),
    wrappedDekRecoveryIv: b64(wrappedDekRecoveryNonce),
    itemsKey,
    phrase,
  };
}

export async function deriveLoginCrypto(opts: {
  password: string;
  kdfSalt: string; // base64
  kdfParams: KdfParams;
}): Promise<LoginCryptoResult> {
  const saltBytes = b64ToBytes(opts.kdfSalt);
  const version = KDF_PARAM_VERSION;
  const { key: stretched } = await stretchMasterPassword({
    password: opts.password,
    salt: saltBytes,
    version,
  });

  const authHashBytes = deriveAuthHash(stretched);
  const kek = deriveKek(stretched);

  return {
    authHash: b64(authHashBytes),
    kek,
    kdfParamVersion: version,
  };
}

export function unwrapDek(opts: {
  wrappedDek: string; // base64
  wrappedDekIv: string; // base64
  kek: Uint8Array;
  kdfParamVersion: KdfParamVersion;
}): ItemsKey {
  const ciphertext = b64ToBytes(opts.wrappedDek);
  const nonce = b64ToBytes(opts.wrappedDekIv) as Nonce;
  return unwrapItemsKey({
    ciphertext,
    nonce,
    kek: opts.kek as KEK,
    labelVersion: LABEL_VERSION,
    kdfParamVersion: opts.kdfParamVersion,
  });
}

export async function deriveRecoveryUnwrap(opts: {
  phrase: string;
  recoverySalt: string; // base64
  recoveryKdfParams: KdfParams;
  wrappedDekRecovery: string; // base64
  wrappedDekRecoveryIv: string; // base64
}): Promise<ItemsKey> {
  const seedBytes = phraseToSeed(opts.phrase);
  const seedString = String.fromCharCode(...seedBytes);
  const saltBytes = b64ToBytes(opts.recoverySalt);

  const { key: recoveryStretched, version } = await stretchMasterPassword({
    password: seedString,
    salt: saltBytes,
    version: KDF_PARAM_VERSION,
  });

  const recoveryKek = deriveKek(recoveryStretched);
  const ciphertext = b64ToBytes(opts.wrappedDekRecovery);
  const nonce = b64ToBytes(opts.wrappedDekRecoveryIv);

  return unwrapItemsKey({
    ciphertext,
    nonce: nonce as Nonce,
    kek: recoveryKek,
    labelVersion: LABEL_VERSION,
    kdfParamVersion: version,
  });
}

export async function deriveRecoveryProof(opts: {
  phrase: string;
  recoverySalt: string; // base64
  recoveryKdfParams: KdfParams;
}): Promise<string> {
  const seedBytes = phraseToSeed(opts.phrase);
  const seedString = String.fromCharCode(...seedBytes);
  const saltBytes = b64ToBytes(opts.recoverySalt);

  const { key: recoveryStretched } = await stretchMasterPassword({
    password: seedString,
    salt: saltBytes,
    version: KDF_PARAM_VERSION,
  });

  return b64(deriveAuthHash(recoveryStretched));
}

export async function deriveNewCredsAfterRecovery(opts: {
  newPassword: string;
  itemsKey: ItemsKey;
}): Promise<RecoveryNewCredsResult> {
  const newKdfSaltBytes = randomBytes(SALT_BYTES);
  const { key: newStretched, version: newKdfParamVersion } = await stretchMasterPassword({
    password: opts.newPassword,
    salt: newKdfSaltBytes,
    version: KDF_PARAM_VERSION,
  });

  const newAuthHashBytes = deriveAuthHash(newStretched);
  const newKek = deriveKek(newStretched);

  const { ciphertext: newWrappedDekBytes, nonce: newWrappedDekNonce } = wrapItemsKey({
    itemsKey: opts.itemsKey,
    kek: newKek,
    labelVersion: LABEL_VERSION,
    kdfParamVersion: newKdfParamVersion,
  });

  const newRecoverySaltBytes = randomBytes(SALT_BYTES);
  const newRecoverySeed = deriveRecoverySeed(newStretched);
  const newPhrase = seedToPhrase(newRecoverySeed);
  const newSeedBytes = phraseToSeed(newPhrase);
  const newSeedString = String.fromCharCode(...newSeedBytes);

  const { key: newRecoveryStretched, version: newRecoveryKdfParamVersion } =
    await stretchMasterPassword({
      password: newSeedString,
      salt: newRecoverySaltBytes,
      version: KDF_PARAM_VERSION,
    });

  const newRecoveryAuthHashBytes = deriveAuthHash(newRecoveryStretched);
  const newRecoveryKek = deriveKek(newRecoveryStretched);

  const { ciphertext: newWrappedDekRecoveryBytes, nonce: newWrappedDekRecoveryNonce } =
    wrapItemsKey({
      itemsKey: opts.itemsKey,
      kek: newRecoveryKek,
      labelVersion: LABEL_VERSION,
      kdfParamVersion: newRecoveryKdfParamVersion,
    });

  return {
    newAuthHash: b64(newAuthHashBytes),
    newKdfSalt: b64(newKdfSaltBytes),
    newKdfParams: KDF_PARAM_SETS[newKdfParamVersion],
    newRecoveryBlob: b64(newRecoveryAuthHashBytes),
    newRecoverySalt: b64(newRecoverySaltBytes),
    newRecoveryParams: KDF_PARAM_SETS[newRecoveryKdfParamVersion],
    newWrappedDek: b64(newWrappedDekBytes),
    newWrappedDekIv: b64(newWrappedDekNonce),
    newWrappedDekRecovery: b64(newWrappedDekRecoveryBytes),
    newWrappedDekRecoveryIv: b64(newWrappedDekRecoveryNonce),
    newPhrase,
  };
}

export { DecryptionError };
