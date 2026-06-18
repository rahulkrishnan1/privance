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

  // Per-request instantiation keeps bun's mock.module from leaking a shared
  // SessionService across test files; the repo is a thin wrapper over the
  // pooled db, so this is cheap.
  const service = new SessionService({ repo: new AuthRepo(db) });

  try {
    const auth = await service.validateToken(token);
    c.set("userId", auth.userId);
  } catch {
    throw new HTTPException(401, { message: "unauthenticated" });
  }

  return next();
}
