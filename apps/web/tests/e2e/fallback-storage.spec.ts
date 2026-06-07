import fs from "node:fs/promises";
import path from "node:path";
import { BASE_URL } from "../../playwright/ports";
import { expect, test } from "./fixtures/persistent-webkit";

const LOCAL_WORKER = path.join(__dirname, "..", "..", "public", "sqlite", "privance-worker.mjs");

async function loadLocalWorker(page: import("@playwright/test").Page) {
  const src = await fs.readFile(LOCAL_WORKER, "utf-8");
  await page.route("**/sqlite/privance-worker.mjs", (route) => {
    route.fulfill({ status: 200, contentType: "text/javascript", body: src });
  });
}

async function runFullCycle(page: import("@playwright/test").Page) {
  return await page.evaluate(() => {
    return new Promise<{ ready: boolean; mode?: string; sqlRows?: unknown[]; error?: string }>(
      (resolve) => {
        const w = new Worker("/sqlite/privance-worker.mjs", { type: "module" });
        let ready: { ready: boolean; mode?: string; error?: string } | null = null;
        let nextId = 0;
        const call = (method: string, args: unknown = {}) => {
          const id = `r${++nextId}`;
          return new Promise<unknown>((res, rej) => {
            const handler = (ev: MessageEvent) => {
              if (ev.data?.id === id) {
                w.removeEventListener("message", handler);
                if (ev.data.ok) res(ev.data.result);
                else rej(new Error(ev.data.error));
              }
            };
            w.addEventListener("message", handler);
            w.postMessage({ id, method, args });
          });
        };
        const startupHandler = async (ev: MessageEvent) => {
          if (ev.data?.ready !== undefined) {
            ready = ev.data;
            w.removeEventListener("message", startupHandler);
            if (!ready?.ready) {
              resolve({ ready: false, error: ready?.error });
              return;
            }
            try {
              await call("init", {
                dbFilename: "/test.sqlite3",
                ddl: `
                  CREATE TABLE IF NOT EXISTS sync_objects (
                    kind TEXT NOT NULL, object_id TEXT NOT NULL,
                    ciphertext BLOB NOT NULL, nonce BLOB NOT NULL,
                    version INTEGER NOT NULL, server_seq INTEGER,
                    tombstone INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (kind, object_id)
                  );
                  CREATE TABLE IF NOT EXISTS sync_cursor (
                    key TEXT PRIMARY KEY, value TEXT NOT NULL
                  );
                  CREATE TABLE IF NOT EXISTS outbound_queue (
                    id TEXT PRIMARY KEY, kind TEXT, object_id TEXT,
                    ciphertext BLOB, nonce BLOB, version INTEGER,
                    prev_version INTEGER, tombstone INTEGER, enqueued_at INTEGER
                  );
                `,
              });
              await call("put", {
                kind: "account",
                objectId: "a1",
                ciphertext: new Uint8Array([1, 2, 3]),
                nonce: new Uint8Array([4, 5, 6]),
                version: 1,
                tombstone: false,
                updatedAt: Date.now(),
              });
              const rows = (await call("list", { kind: "account" })) as unknown[];
              resolve({ ready: true, mode: ready?.mode, sqlRows: rows });
            } catch (e: unknown) {
              resolve({
                ready: true,
                mode: ready?.mode,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        };
        w.addEventListener("message", startupHandler);
        setTimeout(() => resolve({ ready: false, error: "timeout 60s" }), 60_000);
      },
    );
  });
}

test.describe("Storage fallback", () => {
  test("ephemeral WebKit → in-memory mode, SQL works", async ({ persistentPage }) => {
    const browser = persistentPage.context().browser();
    test.skip(browser?.browserType().name() !== "webkit", "webkit-only ephemeral fallback test");
    if (browser === null) throw new Error("browser handle missing on persistent context");
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await loadLocalWorker(page);
    await page.goto("/auth/login/", { waitUntil: "load" });
    const result = await runFullCycle(page);
    await ctx.close();

    expect(result.ready, `worker failed: ${result.error}`).toBe(true);
    expect(result.mode).toBe("memory");
    expect(result.sqlRows).toHaveLength(1);
  });

  test("persistent context → opfs mode, SQL works", async ({ persistentPage: page }) => {
    await loadLocalWorker(page);
    await page.goto("/auth/login/", { waitUntil: "load" });

    const opfsAvailable = await page.evaluate(
      () => typeof navigator.storage?.getDirectory === "function",
    );
    test.skip(
      !opfsAvailable,
      "OPFS not implemented in this WebKit build; the ephemeral memory-mode test still runs",
    );

    const result = await runFullCycle(page);

    expect(result.ready, `worker failed: ${result.error}`).toBe(true);
    expect(result.mode).toBe("opfs");
    expect(result.sqlRows).toHaveLength(1);
  });
});
