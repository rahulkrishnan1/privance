/**
 * Privance KDF worker, served as a static asset and loaded as a classic
 * worker via `new Worker("/kdf/kdf-worker.js")`. Running Argon2id here keeps
 * the 64 MB allocation off the main thread, preventing iOS/WebKit WKWebProcess
 * OOM kills and blocking-UI jank on every unlock.
 *
 * The host passes the resolved KDF params so packages/core stays the single
 * source of truth (no params duplicated here). This worker just runs argon2id.
 *
 * Wire protocol (mirrors privance-worker.mjs):
 *   host -> worker:  { id, method: "stretchMasterPassword", args: { password: string, salt: number[], params: { memoryCost, timeCost, parallelism, hashLength } } }
 *   worker -> host:  { id, ok: true, result: { key: number[] } }
 *                  | { id, ok: false, error: string }
 *   worker -> host (startup): { ready: true }
 */

// Load the self-contained argon2 UMD bundle (WASM bytes embedded as base64).
// importScripts resolves the path against the worker's own URL.
importScripts("/kdf/argon2.umd.min.js");

self.addEventListener("message", async function (event) {
  const { id, method, args } = event.data;

  if (method !== "stretchMasterPassword") {
    self.postMessage({ id, ok: false, error: "Unknown method: " + method });
    return;
  }

  try {
    const { params } = args;
    const salt = new Uint8Array(args.salt);

    // globalThis.hashwasm is set by importScripts above (UMD global export).
    const raw = await self.hashwasm.argon2id({
      password: args.password,
      salt,
      iterations: params.timeCost,
      parallelism: params.parallelism,
      memorySize: params.memoryCost,
      hashLength: params.hashLength,
      outputType: "binary",
    });

    self.postMessage({ id, ok: true, result: { key: Array.from(raw) } });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

self.postMessage({ ready: true });
