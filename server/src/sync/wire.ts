import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { FeatureRouter } from "../core/app.js";
import { db } from "../core/db.js";
import { logger } from "../core/logger.js";
import { SyncRepo } from "./repo.js";
import { SyncService } from "./sync-service.js";
import { ConflictError, NotFoundError } from "./types.js";

// ---------------------------------------------------------------------------
// Auth placeholder
// ---------------------------------------------------------------------------
// TODO(auth): Replace with cookie-bound session lookup from the auth module.
// The auth module will inject `userId` into Hono context via middleware after
// verifying the session cookie. Remove `resolveUserId` and the X-User-Id header
// path entirely at that point.
function resolveUserId(req: Request): string {
  const header = req.headers.get("x-user-id");
  if (!header) {
    throw new HTTPException(401, { message: "unauthenticated" });
  }
  return header;
}

// ---------------------------------------------------------------------------
// Wire helpers
// ---------------------------------------------------------------------------

function parseBase64(value: string, fieldName: string): Buffer {
  try {
    return Buffer.from(value, "base64");
  } catch {
    throw new HTTPException(400, { message: `invalid_base64: ${fieldName}` });
  }
}

function parseBigInt(value: unknown, fieldName: string): bigint {
  if (value === undefined || value === null) {
    throw new HTTPException(400, { message: `missing_field: ${fieldName}` });
  }
  try {
    return BigInt(String(value));
  } catch {
    throw new HTTPException(400, { message: `invalid_integer: ${fieldName}` });
  }
}

function makeService(): SyncService {
  const repo = new SyncRepo(db);
  return new SyncService({ repo });
}

function syncErrorToHttp(err: unknown): never {
  if (err instanceof ConflictError) {
    throw new HTTPException(409, {
      res: new Response(JSON.stringify({ current_version: err.currentVersion.toString() }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    });
  }
  if (err instanceof NotFoundError) {
    throw new HTTPException(404, { message: "not_found" });
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = new Hono();

router.put("/objects/:id", async (c) => {
  const userId = resolveUserId(c.req.raw);
  const objectId = c.req.param("id");

  const body = await c.req.json<Record<string, unknown>>();

  const kind = String(body.kind ?? "");
  if (!kind) throw new HTTPException(400, { message: "missing_field: kind" });

  const ciphertextStr = body.ciphertext;
  const nonceStr = body.nonce;
  if (typeof ciphertextStr !== "string" || typeof nonceStr !== "string") {
    throw new HTTPException(400, { message: "missing_field: ciphertext or nonce" });
  }

  const ciphertext = parseBase64(ciphertextStr, "ciphertext");
  const nonce = parseBase64(nonceStr, "nonce");
  const version = parseBigInt(body.version, "version");
  const prevVersion =
    body.prev_version !== undefined ? parseBigInt(body.prev_version, "prev_version") : undefined;

  const service = makeService();
  try {
    const result = await service.put({
      userId,
      objectId,
      kind,
      ciphertext,
      nonce,
      version,
      ...(prevVersion !== undefined ? { prevVersion } : {}),
    });
    return c.json(
      { server_seq: result.serverSeq.toString(), version: result.version.toString() },
      200,
    );
  } catch (err) {
    logger.warn({ objectId, event: "sync.put.error" }, "put conflict");
    syncErrorToHttp(err);
  }
});

router.get("/objects/:id", async (c) => {
  const userId = resolveUserId(c.req.raw);
  const objectId = c.req.param("id");

  const service = makeService();
  try {
    const result = await service.get({ userId, objectId });
    if (result.tombstone) throw new HTTPException(404, { message: "not_found" });
    return c.json({
      object_id: result.objectId,
      kind: result.kind,
      ciphertext: result.ciphertext.toString("base64"),
      nonce: result.nonce.toString("base64"),
      version: result.version.toString(),
      server_seq: result.serverSeq.toString(),
    });
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    syncErrorToHttp(err);
  }
});

router.get("/changes", async (c) => {
  const userId = resolveUserId(c.req.raw);
  const sinceStr = c.req.query("since") ?? "0";
  const limitStr = c.req.query("limit") ?? "100";

  let since: bigint;
  let limit: number;
  try {
    since = BigInt(sinceStr);
    limit = Math.min(Math.max(1, Number(limitStr)), 500);
  } catch {
    throw new HTTPException(400, { message: "invalid query params" });
  }

  const service = makeService();
  const result = await service.changes({ userId, since, limit });

  return c.json({
    changes: result.changes.map((ch) => ({
      id: ch.id,
      kind: ch.kind,
      version: ch.version.toString(),
      server_seq: ch.serverSeq.toString(),
      ciphertext: ch.ciphertext.toString("base64"),
      nonce: ch.nonce.toString("base64"),
      tombstone: ch.tombstone,
    })),
    next: result.next !== null ? result.next.toString() : null,
  });
});

router.delete("/objects/:id", async (c) => {
  const userId = resolveUserId(c.req.raw);
  const objectId = c.req.param("id");

  const body = await c.req.json<Record<string, unknown>>();
  const prevVersion = parseBigInt(body.prev_version, "prev_version");

  const service = makeService();
  try {
    await service.delete({ userId, objectId, prevVersion });
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    syncErrorToHttp(err);
  }
});

router.post("/batch", async (c) => {
  const userId = resolveUserId(c.req.raw);
  const body = await c.req.json<{
    puts?: unknown[];
    deletes?: unknown[];
  }>();

  const putsRaw = Array.isArray(body.puts) ? body.puts : [];
  const deletesRaw = Array.isArray(body.deletes) ? body.deletes : [];

  const puts = putsRaw.map((item) => {
    const p = item as Record<string, unknown>;
    const objectId = String(p.object_id ?? "");
    if (!objectId) throw new HTTPException(400, { message: "batch put missing object_id" });
    const kind = String(p.kind ?? "");
    if (!kind) throw new HTTPException(400, { message: "batch put missing kind" });
    const ciphertextStr = p.ciphertext;
    const nonceStr = p.nonce;
    if (typeof ciphertextStr !== "string" || typeof nonceStr !== "string") {
      throw new HTTPException(400, { message: "batch put missing ciphertext or nonce" });
    }
    const prevVersion =
      p.prev_version !== undefined ? parseBigInt(p.prev_version, "prev_version") : undefined;
    return {
      objectId,
      kind,
      ciphertext: parseBase64(ciphertextStr, "ciphertext"),
      nonce: parseBase64(nonceStr, "nonce"),
      version: parseBigInt(p.version, "version"),
      ...(prevVersion !== undefined ? { prevVersion } : {}),
    };
  });

  const deletes = deletesRaw.map((item) => {
    const d = item as Record<string, unknown>;
    const objectId = String(d.object_id ?? "");
    if (!objectId) throw new HTTPException(400, { message: "batch delete missing object_id" });
    return {
      objectId,
      prevVersion: parseBigInt(d.prev_version, "prev_version"),
    };
  });

  const service = makeService();
  const result = await service.batch({ userId, puts, deletes });

  return c.json({
    results: result.results.map((r) => {
      if (r.ok) {
        return {
          id: r.id,
          ok: true,
          server_seq: r.serverSeq.toString(),
          version: r.version.toString(),
        };
      }
      return {
        id: r.id,
        ok: false,
        conflict: { current_version: r.conflict.currentVersion.toString() },
      };
    }),
  });
});

export const featureRouter: FeatureRouter = {
  basePath: "/api/sync",
  router,
};
