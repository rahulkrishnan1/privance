import { expect, test } from "./fixtures/persistent-webkit";

test.describe("WebKit storage smoke", () => {
  test.skip(({ browserName }) => browserName !== "webkit", "webkit-only spec");

  test("OPFS + sqlite-wasm worker initialises", async ({ persistentPage: page }) => {
    await page.goto("/auth/login", { waitUntil: "load" });

    const opfsAvailable = await page.evaluate(
      () => typeof navigator.storage?.getDirectory === "function",
    );
    test.skip(
      !opfsAvailable,
      "OPFS not implemented in this WebKit build; the memory-fallback path is covered by fallback-storage.spec.ts",
    );

    const opfsRoot = await page.evaluate(async () => {
      try {
        const root = await navigator.storage.getDirectory();
        return { ok: true, name: root.name };
      } catch (e: unknown) {
        const err = e as Error;
        return { ok: false, name: err.name, message: err.message };
      }
    });
    expect(opfsRoot.ok, `getDirectory failed: ${opfsRoot.message}`).toBe(true);

    const workerReady = await page.evaluate(() => {
      return new Promise<{ ready: boolean; error?: string }>((resolve) => {
        const w = new Worker("/sqlite/privance-worker.mjs", { type: "module" });
        const t = setTimeout(
          () => resolve({ ready: false, error: "worker timeout after 60s" }),
          60_000,
        );
        w.addEventListener("message", (ev) => {
          clearTimeout(t);
          resolve(ev.data);
        });
        w.addEventListener("error", (ev) => {
          clearTimeout(t);
          resolve({ ready: false, error: `worker error: ${ev.message}` });
        });
      });
    });
    expect(workerReady.ready, `worker failed to init: ${workerReady.error}`).toBe(true);
  });
});
