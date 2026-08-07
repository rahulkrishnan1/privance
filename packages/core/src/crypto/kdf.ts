import { argon2id } from "hash-wasm";
import type { StretchedMasterKey } from "./types.js";
import { KDF_PARAMS, KDF_PARAMS_REDUCED } from "./types.js";

export type KdfParamVersion = 1 | 2;

export type KdfParams = {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  hashLength: number;
};

export const KDF_PARAM_SETS: Record<KdfParamVersion, KdfParams> = {
  1: KDF_PARAMS,
  2: KDF_PARAMS_REDUCED,
};

export async function stretchMasterPassword(opts: {
  password: string;
  salt: Uint8Array;
  version?: KdfParamVersion;
}): Promise<{ key: StretchedMasterKey; version: KdfParamVersion }> {
  const version = opts.version ?? 1;
  const params = KDF_PARAM_SETS[version];

  const raw = await argon2id({
    password: opts.password,
    salt: opts.salt,
    iterations: params.timeCost,
    parallelism: params.parallelism,
    memorySize: params.memoryCost,
    hashLength: params.hashLength,
    outputType: "binary",
  });

  return { key: raw as StretchedMasterKey, version };
}
