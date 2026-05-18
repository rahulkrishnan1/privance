import { decryptAead, encryptAead } from "./aead.js";
import { randomBytes, randomNonce } from "./random.js";
import type { AadFields, EncryptedBlob, ItemsKey, KEK, Nonce } from "./types.js";
import { ITEMS_KEY_BYTES } from "./types.js";

const ITEMS_KEY_RECORD_UUID = "00000000-0000-0000-0000-000000000000" as const;

function itemsKeyAad(opts: { labelVersion: number; kdfParamVersion: number }): AadFields {
  return {
    recordUuid: ITEMS_KEY_RECORD_UUID,
    kind: "items_key",
    labelVersion: opts.labelVersion,
    kdfParamVersion: opts.kdfParamVersion,
  };
}

export function generateItemsKey(): ItemsKey {
  return randomBytes(ITEMS_KEY_BYTES) as ItemsKey;
}

export function wrapItemsKey(opts: {
  itemsKey: ItemsKey;
  kek: KEK;
  labelVersion: number;
  kdfParamVersion: number;
  nonce?: Nonce;
}): EncryptedBlob {
  const aad = itemsKeyAad({
    labelVersion: opts.labelVersion,
    kdfParamVersion: opts.kdfParamVersion,
  });
  return encryptAead({
    plaintext: opts.itemsKey,
    key: opts.kek,
    aad,
    nonce: opts.nonce ?? randomNonce(),
  });
}

export function unwrapItemsKey(opts: {
  ciphertext: Uint8Array;
  nonce: Nonce;
  kek: KEK;
  labelVersion: number;
  kdfParamVersion: number;
}): ItemsKey {
  const aad = itemsKeyAad({
    labelVersion: opts.labelVersion,
    kdfParamVersion: opts.kdfParamVersion,
  });
  const raw = decryptAead({
    ciphertext: opts.ciphertext,
    nonce: opts.nonce,
    key: opts.kek,
    aad,
  });
  return raw as ItemsKey;
}
