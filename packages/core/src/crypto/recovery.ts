import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { RecoverySeed } from "./types.js";
import { InvalidLengthError } from "./types.js";

const ENTROPY_BYTES = 16;

export function seedToPhrase(seed: RecoverySeed): string {
  if (seed.length !== ENTROPY_BYTES) {
    throw new InvalidLengthError("recovery seed", ENTROPY_BYTES, seed.length);
  }
  return entropyToMnemonic(seed, wordlist);
}

export function phraseToSeed(phrase: string): RecoverySeed {
  const entropy = mnemonicToEntropy(phrase, wordlist);
  if (entropy.length !== ENTROPY_BYTES) {
    throw new InvalidLengthError("recovery entropy", ENTROPY_BYTES, entropy.length);
  }
  return entropy as RecoverySeed;
}

export function validatePhrase(phrase: string): boolean {
  try {
    phraseToSeed(phrase);
    return true;
  } catch {
    return false;
  }
}

const wordlistSet = new Set(wordlist);

/** Count how many whitespace-separated tokens are BIP39 english words. Advisory
 *  UI only; the authoritative check stays {@link validatePhrase}. */
export function countRecognizedWords(phrase: string): number {
  const tokens = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let n = 0;
  for (const token of tokens) {
    if (wordlistSet.has(token)) n += 1;
  }
  return n;
}
