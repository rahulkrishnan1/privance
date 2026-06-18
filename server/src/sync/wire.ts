import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono/types";
import type { FeatureRouter } from "../core/app.js";
import { db } from "../core/db.js";
import { parseB64Buf, parseBigInt } from "../core/wire-parse.js";
import { SyncRepo } from "./repo.js";
import { SyncService } from "./sync-service.js";
import { ConflictError, NotFoundError } from "./types.js";

// AES-GCM nonce is fixed at 12 bytes (NONCE_BYTES in @privance/core).
const NONCE_LEN = 12;

// A full sync from a fresh client batches every object; cap it so a single
// authenticated request can't open thousands of per-item DB round-trips in one
// transaction. 500 covers a large real portfolio (accounts + holdings + lots +
// transactions) while bounding worst-case transaction size; clients page beyond it.
const MAX_BATCH_ITEMS = 500;

// Encrypted blobs are small (a few KB each); 5 MB bounds a maxed-out batch and
// stops oversized-body memory blowups before parsing.
const MAX_BODY_BYTES = 5 * 1024 * 1024;

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

function buildRouter(sessionMiddleware: MiddlewareHandler): Hono {
  const router = new Hono();
  router.onError((err) => {
    if (err instanceof HTTPException) return err.getResponse();
    return syncErrorToHttp(err);
  });
  router.use("*", sessionMiddleware);
  router.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES }));

  router.put("/objects/:id", async (c) => {
    const userId = c.get("userId");
    const objectId = c.req.param("id");

    const body = await c.req.json<Record<string, unknown>>();

    const kind = String(body.kind ?? "");
    if (!kind) throw new HTTPException(400, { message: "missing_field: kind" });

    const ciphertext = parseB64Buf(body.ciphertext, "ciphertext");
    const nonce = parseB64Buf(body.nonce, "nonce", NONCE_LEN);
    const version = parseBigInt(body.version, "version");
    const prevVersion =
      body.prev_version !== undefined ? parseBigInt(body.prev_version, "prev_version") : undefined;

    const service = makeService();
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
  });

  router.get("/objects/:id", async (c) => {
    const userId = c.get("userId");
    const objectId = c.req.param("id");

    const service = makeService();
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
  });

  router.get("/changes", async (c) => {
    const userId = c.get("userId");
    const sinceStr = c.req.query("since") ?? "0";
    const limitStr = c.req.query("limit") ?? "100";

    let since: bigint;
    try {
      since = BigInt(sinceStr);
    } catch {
      throw new HTTPException(400, { message: "invalid query params" });
    }
    const limitNum = Number(limitStr);
    if (!Number.isFinite(limitNum)) {
      throw new HTTPException(400, { message: "invalid query params" });
    }
    const limit = Math.min(Math.max(1, limitNum), 500);

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
    const userId = c.get("userId");
    const objectId = c.req.param("id");

    const body = await c.req.json<Record<string, unknown>>();
    const prevVersion = parseBigInt(body.prev_version, "prev_version");

    const service = makeService();
    await service.delete({ userId, objectId, prevVersion });
    return new Response(null, { status: 204 });
  });

  router.post("/batch", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json<{
      puts?: unknown[];
      deletes?: unknown[];
    }>();

    const putsRaw = Array.isArray(body.puts) ? body.puts : [];
    const deletesRaw = Array.isArray(body.deletes) ? body.deletes : [];

    if (putsRaw.length + deletesRaw.length > MAX_BATCH_ITEMS) {
      throw new HTTPException(400, { message: `too_many_items: max ${MAX_BATCH_ITEMS}` });
    }

    const puts = putsRaw.map((item) => {
      const p = item as Record<string, unknown>;
      const objectId = String(p.object_id ?? "");
      if (!objectId) throw new HTTPException(400, { message: "batch put missing object_id" });
      const kind = String(p.kind ?? "");
      if (!kind) throw new HTTPException(400, { message: "batch put missing kind" });
      const prevVersion =
        p.prev_version !== undefined ? parseBigInt(p.prev_version, "prev_version") : undefined;
      return {
        objectId,
        kind,
        ciphertext: parseB64Buf(p.ciphertext, "ciphertext"),
        nonce: parseB64Buf(p.nonce, "nonce", NONCE_LEN),
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
        if ("conflict" in r) {
          return {
            id: r.id,
            ok: false,
            conflict: { current_version: r.conflict.currentVersion.toString() },
          };
        }
        return { id: r.id, ok: false, error: r.error };
      }),
    });
  });

  return router;
}

export function createFeatureRouter(sessionMiddleware: MiddlewareHandler): FeatureRouter {
  return {
    basePath: "/api/sync",
    router: buildRouter(sessionMiddleware),
  };
}
