import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono/types";

import * as rateLimit from "../auth/rate-limit.js";
import { RateLimitedError, SESSION_COOKIE } from "../auth/types.js";
import type { FeatureRouter } from "../core/app.js";
import { db } from "../core/db.js";
import { parseB64Buf } from "../core/wire-parse.js";
import { AccountService } from "./account-service.js";
import { AccountRepo } from "./repo.js";
import { InvalidPasswordError } from "./types.js";

const SECURE_COOKIE = process.env.NODE_ENV !== "test";

// auth_hash is AUTH_HASH_BYTES (@privance/core).
const AUTH_HASH_LEN = 32;

function clearSessionCookieHeader(c: { header: (k: string, v: string) => void }): void {
  const secure = SECURE_COOKIE ? "; Secure" : "";
  c.header("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`);
}

function makeService(): AccountService {
  const repo = new AccountRepo(db);
  return new AccountService({ repo });
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function accountErrorToHttp(err: unknown): Response {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof SyntaxError) return jsonError("invalid_json", 400);
  if (err instanceof RateLimitedError) return jsonError("rate_limited", 429);
  if (err instanceof InvalidPasswordError) return jsonError(err.code, 401);
  throw err;
}

function buildRouter(sessionMiddleware: MiddlewareHandler): Hono {
  const router = new Hono();
  router.onError((err) => accountErrorToHttp(err));
  router.use("*", sessionMiddleware);

  router.post("/destroy", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json<Record<string, unknown>>();
    const currentAuthHash = parseB64Buf(body.current_auth_hash, "current_auth_hash", AUTH_HASH_LEN);

    await rateLimit.gatePasswordVerify(userId);

    const service = makeService();
    try {
      await service.destroy({ userId, currentAuthHash });
      rateLimit.recordPasswordVerifySuccess(userId);
      clearSessionCookieHeader(c);
      return c.json({ status: "ok" });
    } catch (err) {
      if (err instanceof InvalidPasswordError) {
        rateLimit.recordPasswordVerifyFailure(userId);
      }
      throw err;
    }
  });

  return router;
}

export function createFeatureRouter(sessionMiddleware: MiddlewareHandler): FeatureRouter {
  return {
    basePath: "/api/account",
    router: buildRouter(sessionMiddleware),
  };
}
