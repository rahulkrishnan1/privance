import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

const REQUIRED_CSRF_HEADER = "x-requested-with";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// biome-ignore lint/suspicious/noConfusingVoidType: Hono middleware signature requires Response | void
export async function requireCsrfHeader(c: Context, next: Next): Promise<Response | void> {
  if (SAFE_METHODS.has(c.req.method)) {
    return next();
  }
  if (!c.req.header(REQUIRED_CSRF_HEADER)) {
    throw new HTTPException(403, { message: "csrf_header_required" });
  }
  return next();
}
