import type { LocalStore } from "./types.js";
import { WebSqliteAdapter } from "./web-adapter.js";

/**
 * Create a LocalStore backed by sqlite-wasm running in a dedicated Worker.
 *
 * The same adapter powers PWA and Capacitor builds, Capacitor's WebView is a
 * browser, so OPFS + WebAssembly are available everywhere we ship.
 *
 * Callers must call `store.init()` before any data operations.
 *
 * @param options.workerUrl  - Absolute URL where the sqlite worker is served,
 *   e.g. "/sqlite/privance-worker.mjs".
 * @param options.dbFilename - Filename for the SAHPool VFS database. Defaults
 *   to "/privance.sqlite3".
 */
export function createLocalStore(options: { workerUrl: string; dbFilename?: string }): LocalStore {
  return new WebSqliteAdapter({
    workerUrl: options.workerUrl,
    ...(options.dbFilename !== undefined && { dbFilename: options.dbFilename }),
  });
}
