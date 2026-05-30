const WORKER_URL = "/sqlite/privance-worker.mjs";

/** Per-user OPFS database filename. Single source of truth so the open path
 *  (sync-context) and the logout destroy path cannot drift. */
export function perUserDbFilename(userId: string): string {
  return `/privance-${userId}.sqlite3`;
}

/** Unlinks a user's local ciphertext store. Used by the locked-screen sign-out,
 *  where no store is open to carry a destroy, so a short-lived worker opens the
 *  per-user file and deletes it. Best-effort: the next session re-pulls from the
 *  server, so a failure here never blocks logout. */
export async function destroyUserStore(userId: string): Promise<void> {
  try {
    const { createLocalStore } = await import("@privance/core/storage");
    const store = createLocalStore({
      workerUrl: WORKER_URL,
      dbFilename: perUserDbFilename(userId),
    });
    await store.init();
    await store.destroy();
  } catch {
    // best-effort; the next session re-pulls ciphertext from the server
  }
}
