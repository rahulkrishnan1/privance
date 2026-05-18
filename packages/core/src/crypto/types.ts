declare const _brand: unique symbol;

export type Branded<T, Brand> = T & { readonly [_brand]: Brand };

export type StretchedMasterKey = Branded<Uint8Array, "StretchedMasterKey">;
export type AuthHash = Branded<Uint8Array, "AuthHash">;
export type KEK = Branded<Uint8Array, "KEK">;
export type RecoverySeed = Branded<Uint8Array, "RecoverySeed">;
export type ItemsKey = Branded<Uint8Array, "ItemsKey">;
export type Nonce = Branded<Uint8Array, "Nonce">;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

export class DecryptionError extends CryptoError {
  constructor(message = "Decryption failed") {
    super(message);
    this.name = "DecryptionError";
  }
}

export class InvalidLengthError extends CryptoError {
  constructor(name: string, expected: number, got: number) {
    super(`${name}: expected ${expected} bytes, got ${got}`);
    this.name = "InvalidLengthError";
  }
}

export const KDF_PARAM_VERSION = 1 as const;

export const KDF_PARAMS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 64,
} as const;

export const NONCE_BYTES = 12 as const;
export const TAG_BYTES = 16 as const;
export const ITEMS_KEY_BYTES = 32 as const;
export const SALT_BYTES = 16 as const;
export const AUTH_HASH_BYTES = 32 as const;

export type AadFields = {
  recordUuid: string;
  /** Record kind ("account", "holding", "holding_group", ...). Binding kind
   *  into the AAD prevents a server from serving a ciphertext under the wrong
   *  kind label and having the client silently accept it. */
  kind: string;
  labelVersion: number;
  kdfParamVersion: number;
};

export type EncryptedBlob = {
  ciphertext: Uint8Array;
  nonce: Nonce;
};
