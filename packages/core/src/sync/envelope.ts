import { SyncProtocolError } from "./types.js";

/**
 * Encode a Uint8Array to base64 for the wire.
 * Uses the standard base64 alphabet (not URL-safe) to match the server's
 * Buffer.toString("base64") / Buffer.from(str, "base64") pair.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Decode a base64 string from the wire into a Uint8Array.
 */
export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Parse a bigint that arrived as a decimal string on the wire.
 * Throws SyncProtocolError if the value is missing or not a valid integer.
 */
export function parseBigIntField(value: unknown, fieldName: string): bigint {
  if (value === undefined || value === null) {
    throw new SyncProtocolError(`missing field: ${fieldName}`);
  }
  try {
    return BigInt(String(value));
  } catch {
    throw new SyncProtocolError(`invalid integer field: ${fieldName}`);
  }
}

/**
 * Parse a string field from a wire response object.
 */
export function parseStringField(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new SyncProtocolError(`missing or non-string field: ${fieldName}`);
  }
  return value;
}

/**
 * Parse a boolean field from a wire response object. Accepts native booleans
 * as well as the 0/1 and "true"/"false" encodings some Postgres adapters emit
 * so a server swap doesn't stall the pull cursor.
 */
export function parseBoolField(value: unknown, fieldName: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === "0" || value === "false") return false;
  if (value === 1 || value === "1" || value === "true") return true;
  throw new SyncProtocolError(`missing or non-boolean field: ${fieldName}`);
}
