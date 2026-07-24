/**
 * Thin wrapper around the KDF Web Worker. Exposes the same signature as
 * `stretchMasterPassword` from @privance/core but runs Argon2id off the main
 * thread, keeping the iOS/WebKit UI responsive during derivation.
 *
 * Single worker instance, lazy-initialised on first call (mirrors the sqlite
 * per-user store pattern). Falls back to the direct in-thread implementation if
 * the worker is unavailable (Safari Private Browsing restrictive policies, test
 * environments) OR wedges (accepted but never runs, observed on Linux WebKit in
 * CI), so auth never hangs or hard-breaks.
 */

import type { KdfParamVersion, StretchedMasterKey } from "@privance/core";
import { KDF_PARAM_SETS, stretchMasterPassword } from "@privance/core";

const WORKER_URL = "/kdf/kdf-worker.js";

// A healthy worker init plus one Argon2id derivation is a few seconds; past
// this the worker is wedged, so abandon it and derive in-thread rather than
// hang the caller (and so a single beforeAll login cannot time out).
const WORKER_TIMEOUT_MS = 20_000;

type KdfResult = { key: StretchedMasterKey; version: KdfParamVersion };

type WorkerResponse =
  | { id: string; ok: true; result: { key: number[] } }
  | { id: string; ok: false; error: string };

let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
// Latches once the worker proves unusable so later calls skip it and go
// straight in-thread instead of paying the timeout every time.
let workerUnavailable = false;

function randomId(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function initWorker(): Promise<void> {
  if (workerReady !== null) return workerReady;

  workerReady = new Promise<void>((resolve, reject) => {
    try {
      // Static-asset classic worker: served from /kdf/kdf-worker.js alongside
      // the other public assets. No bundler eval in dev mode, so WebKit's strict
      // CSP in WKWebView does not block it.
      const w = new Worker(WORKER_URL);

      const onReady = (event: MessageEvent) => {
        if (event.data?.ready === true) {
          w.removeEventListener("message", onReady);
          worker = w;
          resolve();
        }
      };

      w.addEventListener("message", onReady);
      w.addEventListener("error", (e) => {
        workerReady = null;
        reject(e);
      });
    } catch (e) {
      workerReady = null;
      reject(e);
    }
  });

  return workerReady;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("kdf worker timed out")), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function deriveViaWorker(opts: {
  password: string;
  salt: Uint8Array;
  version?: KdfParamVersion;
}): Promise<KdfResult> {
  await initWorker();
  if (worker === null) throw new Error("kdf worker unavailable");
  const w = worker;

  // Resolve params here so @privance/core stays the single source of truth; the
  // worker just runs argon2id with what it is given.
  const version = opts.version ?? 1;
  const params = KDF_PARAM_SETS[version];

  return new Promise<KdfResult>((resolve, reject) => {
    const id = randomId();
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as WorkerResponse;
      if (msg.id !== id) return;
      w.removeEventListener("message", onMessage);
      if (msg.ok) {
        resolve({ key: new Uint8Array(msg.result.key) as StretchedMasterKey, version });
      } else {
        reject(new Error(msg.error));
      }
    };
    w.addEventListener("message", onMessage);
    w.postMessage({
      id,
      method: "stretchMasterPassword",
      args: { password: opts.password, salt: Array.from(opts.salt), params },
    });
  });
}

// Off-thread derivation, bounded by a timeout. Any failure (worker unavailable,
// errored, or wedged) latches it off and derives in-thread, so auth never hangs.
export async function stretchMasterPasswordInWorker(opts: {
  password: string;
  salt: Uint8Array;
  version?: KdfParamVersion;
}): Promise<KdfResult> {
  if (!workerUnavailable) {
    try {
      return await withTimeout(deriveViaWorker(opts), WORKER_TIMEOUT_MS);
    } catch {
      workerUnavailable = true;
    }
  }
  return stretchMasterPassword(opts);
}

/** Fire-and-forget worker spawn so script fetch + wasm compile overlap typing
 *  instead of following submit. Does not touch workerUnavailable; the normal
 *  fallback semantics in stretchMasterPasswordInWorker remain unchanged. */
export function warmKdfWorker(): void {
  if (workerUnavailable) return;
  void initWorker().catch(() => {});
}
