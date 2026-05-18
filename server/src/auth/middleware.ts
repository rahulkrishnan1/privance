import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";

import { db } from "../core/db.js";
import { AuthRepo } from "./repo.js";
import { SessionService } from "./session-service.js";

const SESSION_COOKIE = "privance_session";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
  }
}

// biome-ignore lint/suspicious/noConfusingVoidType: Hono middleware signature requires Response | void
export async function requireSession(c: Context, next: Next): Promise<Response | void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw new HTTPException(401, { message: "unauthenticated" });

  // Note(M11): using per-request instantiation to avoid bun mock.module
  // cross-test contamination; DI via wire.ts is deferred until the test
  // framework supports stable singleton injection across test files.
  const service = new SessionService(new AuthRepo(db));

  try {
    const auth = await service.validateToken(token);
    c.set("userId", auth.userId);
  } catch {
    throw new HTTPException(401, { message: "unauthenticated" });
  }

  return next();
}
