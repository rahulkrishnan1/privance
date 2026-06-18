import { HTTPException } from "hono/http-exception";

// Buffer.from(x, "base64") never throws (it silently drops invalid chars), so a
// try/catch around it is dead. Validate the decoded result instead: reject empty
// decodes and, where the field has a fixed size, reject wrong-sized buffers.
export function parseB64Buf(value: unknown, field: string, expectedLen?: number): Buffer {
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `missing_field: ${field}` });
  }
  const buf = Buffer.from(value, "base64");
  if (buf.length === 0) {
    throw new HTTPException(400, { message: `invalid_base64: ${field}` });
  }
  if (expectedLen !== undefined && buf.length !== expectedLen) {
    throw new HTTPException(400, { message: `invalid_length: ${field}` });
  }
  return buf;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new HTTPException(400, { message: `missing_field: ${field}` });
  }
  return value;
}

export function parseBigInt(value: unknown, field: string): bigint {
  if (value === undefined || value === null) {
    throw new HTTPException(400, { message: `missing_field: ${field}` });
  }
  try {
    return BigInt(String(value));
  } catch {
    throw new HTTPException(400, { message: `invalid_integer: ${field}` });
  }
}
