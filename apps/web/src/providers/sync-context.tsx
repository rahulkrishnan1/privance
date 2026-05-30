"use client";

import {
  decryptAead,
  encryptAead,
  KDF_PARAM_VERSION,
  LABEL_VERSION,
  type Nonce,
} from "@privance/core";
import type { LocalStore } from "@privance/core/storage";
import type { SyncClient } from "@privance/core/sync";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { serverUrl } from "@/lib/api/client";
import { perUserDbFilename } from "@/lib/storage/per-user-store";
import { readItemsKey, useAuth } from "./auth-context";

type StoreState = {
  store: LocalStore | null;
  client: SyncClient | null;
  initialising: boolean;
  setupError: Error | null;
  decrypt: (opts: {
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    objectId: string;
    kind: string;
  }) => Uint8Array;
};

export type SyncContextValue = StoreState & {
  /** Monotonically-increasing counter. Increments after every local mutation so
   *  queries can add it to their useEffect dep array to re-run after a write. */
  storeClock: number;
  /** Call after a successful mutation to trigger dependent query re-runs. */
  tick: () => void;
};

const SyncContext = createContext<SyncContextValue | null>(null);

function makeLockedDecrypt(): StoreState["decrypt"] {
  return () => {
    throw new Error("locked");
  };
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { state, lock, user, registerLogoutCleanup } = useAuth();

  const [storeClock, setStoreClock] = useState(0);
  const tick = useCallback(() => setStoreClock((c) => c + 1), []);

  const [storeState, setStoreState] = useState<StoreState>({
    store: null,
    client: null,
    initialising: false,
    setupError: null,
    decrypt: makeLockedDecrypt(),
  });

  const storeRef = useRef<LocalStore | null>(null);
  const clientRef = useRef<SyncClient | null>(null);
  const unregisterLogoutCleanupRef = useRef<(() => void) | null>(null);

  // lock is referenced inside setup() below but is stable via useCallback in
  // AuthProvider, so we deliberately omit it from the dep list to avoid
  // tearing down and re-initialising the store on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lock is stable
  useEffect(() => {
    if (state !== "unlocked") {
      clientRef.current?.stop();
      void storeRef.current?.close();
      unregisterLogoutCleanupRef.current?.();
      unregisterLogoutCleanupRef.current = null;
      clientRef.current = null;
      storeRef.current = null;
      setStoreState({
        store: null,
        client: null,
        initialising: false,
        setupError: null,
        decrypt: makeLockedDecrypt(),
      });
      setStoreClock(0);
      return;
    }

    let cancelled = false;
    setStoreState((prev) => ({
      ...prev,
      initialising: true,
      setupError: null,
      decrypt: makeLockedDecrypt(),
    }));

    const setup = async () => {
      const [{ createLocalStore }, { createSyncClient }] = await Promise.all([
        import("@privance/core/storage"),
        import("@privance/core/sync"),
      ]);

      // Per-user OPFS file. Production throws when userId is unknown so a
      // refactor that produces unlocked-without-userId state surfaces loudly
      // (caught below into setupError) rather than silently funnelling into a
      // shared file or hanging on the init spinner. The E2E session restorer
      // injects DEK directly into globalThis without going through login(), so
      // user.userId is undefined; tolerate that under non-prod builds where
      // each test browser context has its own OPFS partition.
      if (user?.userId === undefined && process.env.NODE_ENV === "production") {
        throw new Error("sync-context: store open requested without a userId");
      }
      // Non-prod fallback only. Note this is the same path the worker unlinks
      // once at init (legacy cleanup), so the dev DB is wiped-then-recreated on
      // each boot; harmless because every test context has its own OPFS.
      const dbFilename =
        user?.userId !== undefined ? perUserDbFilename(user.userId) : "/privance.sqlite3";
      const store = createLocalStore({
        workerUrl: "/sqlite/privance-worker.mjs",
        dbFilename,
      });

      const encryptEnvelope = async (input: {
        plaintext: Uint8Array;
        objectId: string;
        kind: string;
      }): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> => {
        const key = readItemsKey();
        if (key === null) throw new Error("locked");
        return encryptAead({
          plaintext: input.plaintext,
          key,
          aad: {
            recordUuid: input.objectId,
            kind: input.kind,
            labelVersion: LABEL_VERSION,
            kdfParamVersion: KDF_PARAM_VERSION,
          },
        });
      };

      const decryptEnvelope = async (input: {
        ciphertext: Uint8Array;
        nonce: Uint8Array;
        objectId: string;
        kind: string;
      }): Promise<Uint8Array> => {
        const key = readItemsKey();
        if (key === null) throw new Error("locked");
        return decryptAead({
          ciphertext: input.ciphertext,
          nonce: input.nonce as Nonce,
          key,
          aad: {
            recordUuid: input.objectId,
            kind: input.kind,
            labelVersion: LABEL_VERSION,
            kdfParamVersion: KDF_PARAM_VERSION,
          },
        });
      };

      // Request durable OPFS so the browser doesn't evict our local DB when
      // the PWA is closed. Without this, "best-effort" storage can be cleared,
      // which makes deleted records reappear (server's pre-delete copy gets
      // re-pulled because the local tombstone is gone).
      // Firefox can hang persist() waiting for user gesture, so race against
      // a short timeout so init never blocks on this best-effort call.
      if (typeof navigator !== "undefined" && navigator.storage?.persist !== undefined) {
        try {
          await Promise.race([
            navigator.storage.persist(),
            new Promise((resolve) => setTimeout(resolve, 500)),
          ]);
        } catch {
          // best-effort; nothing to do if the API throws
        }
      }

      await store.init();

      if (cancelled) {
        await store.close();
        return;
      }

      const client = createSyncClient({
        config: {
          serverUrl: serverUrl(),
          onAuthError: () => {
            // Background sync got a 401/403. The session is gone server-side;
            // lock so the user can re-authenticate instead of seeing a stuck UI.
            lock();
          },
          onDecryptError: (objectId, err) => {
            // Don't crash the sync loop; surface so the failure isn't invisible.
            // The pull cursor stalls just before the failing record so the
            // next pull retries it. If the user's DEK changed on another
            // device they'll need to re-auth to fetch the new wrap.
            // biome-ignore lint/suspicious/noConsole: surfacing sync errors
            console.warn("[sync] decrypt error", { objectId, err });
          },
        },
        store,
        encryptEnvelope,
        decryptEnvelope,
      });

      const decrypt: StoreState["decrypt"] = (opts) => {
        const key = readItemsKey();
        if (key === null) throw new Error("locked");
        return decryptAead({
          ciphertext: opts.ciphertext,
          nonce: opts.nonce as Nonce,
          key,
          aad: {
            recordUuid: opts.objectId,
            kind: opts.kind,
            labelVersion: LABEL_VERSION,
            kdfParamVersion: KDF_PARAM_VERSION,
          },
        });
      };

      storeRef.current = store;
      clientRef.current = client;

      // If a logout fired during setup, the auth-side cleanup loop has
      // already run; registering now would leak a closure that nothing
      // invokes. Bail before touching the registry.
      if (cancelled) return;

      // Register a logout cleanup that unlinks this per-user OPFS file. Lock
      // intentionally uses close() (preserves ciphertext for re-unlock); only
      // logout destroys, so a shared-browser user does not leave their
      // encrypted state on disk.
      unregisterLogoutCleanupRef.current = registerLogoutCleanup(async () => {
        try {
          await store.destroy();
        } catch {
          // best-effort; the next session re-pulls from the server
        }
      });

      // Push pending mutations from the previous session BEFORE pulling. If a
      // delete sat in the outbound queue when the user closed the PWA, this
      // gets it to the server before any pull could see a stale pre-delete
      // copy. Errors silenced; the polling tick retries.
      try {
        await client.pushPending();
      } catch {
        // Silenced, polling tick will retry.
      }

      // Drain all pages from the server so the local store is fully populated
      // before queries run. Using drainAllChanges() instead of a single-page
      // pullChanges() avoids missing high-seq objects when many records have
      // accumulated (>100) from prior sessions.
      try {
        await client.drainAllChanges();
      } catch {
        // Silenced, queries fall back to whatever is in the local store.
      }

      if (cancelled) {
        await store.close();
        return;
      }

      // Start background polling (30 s interval) after the initial pull.
      client.start({ pollIntervalMs: 30_000 });
      setStoreState({ store, client, initialising: false, setupError: null, decrypt });
    };

    setup().catch((cause) => {
      if (cancelled) return;
      const err = cause instanceof Error ? cause : new Error(String(cause));
      // biome-ignore lint/suspicious/noConsole: surfacing sync-init failures
      console.error("[sync] setup failed", err);
      setStoreState({
        store: null,
        client: null,
        initialising: false,
        setupError: err,
        decrypt: makeLockedDecrypt(),
      });
    });

    return () => {
      cancelled = true;
    };
    // user.userId is in the dep array so signing out and back in as a
    // different user tears down the store and re-initialises under the new
    // namespace. State alone does not change on hot user switches.
  }, [state, user?.userId]);

  const syncValue: SyncContextValue = {
    ...storeState,
    storeClock,
    tick,
  };

  return <SyncContext.Provider value={syncValue}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (ctx === null) {
    throw new Error("useSync() must be used within <SyncProvider>");
  }
  return ctx;
}
