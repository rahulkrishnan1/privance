import {
  decryptAead,
  encryptAead,
  KDF_PARAM_VERSION,
  LABEL_VERSION,
  type Nonce,
} from "@privance/core";
import type { EnqueueInput, LocalStore } from "@privance/core/storage";
import type { ConflictResolutionInput, SyncClient } from "@privance/core/sync";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { serverUrl } from "@/lib/api/client";
import { perUserDbFilename } from "@/lib/storage/per-user-store";
import { readItemsKey, USER_ID_KEY, useAuth } from "./auth-context";

type ConflictNotice = Pick<
  ConflictResolutionInput,
  "queueId" | "objectId" | "kind" | "myTombstone" | "theirTombstone"
>;

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

type SyncContextValue = StoreState & {
  /** Increments after local mutations and applied remote pulls/drains so queries
   *  can re-run without navigation. */
  storeClock: number;
  conflicts: ConflictNotice[];
  save: (input: EnqueueInput) => Promise<void>;
  saveError: string | null;
  resolveConflict: (queueId: string, action: "keep-mine" | "keep-theirs") => Promise<void>;
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

  const activeSaves = useRef(new Map<string, { confirmed: boolean }>());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictNotice[]>([]);
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
      setConflicts([]);
      activeSaves.current.clear();
      setSaveError(null);
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

      // Per-user OPFS file. No guard needed for an unlocked-without-userId
      // state: auth-context fail-closes (rehydrate requires USER_ID_KEY, and
      // login sets user.userId), so in production the store can only be opened
      // with a userId present. The shared-file fallback exists only for the E2E
      // DEK-injection boot (the session restorer injects the DEK into
      // globalThis without going through login()), which is safe because every
      // test context has its own OPFS partition.
      const userId = user?.userId ?? localStorage.getItem(USER_ID_KEY);
      const dbFilename = userId !== null ? perUserDbFilename(userId) : "/privance.sqlite3";
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
          onConfirmed: (queueIds) => {
            if (cancelled) return;
            for (const id of queueIds) {
              const save = activeSaves.current.get(id);
              if (save) save.confirmed = true;
            }
          },
          onApplied: () => {
            if (!cancelled) tick();
          },
          onAuthError: () => {
            // Background sync got a 401/403. The session is gone server-side;
            // lock so the user can re-authenticate instead of seeing a stuck UI.
            void lock().catch((err) => {
              // A failed auto-lock would leave the app unlocked after the session
              // is gone; surface it rather than swallow so it is not invisible.
              // biome-ignore lint/suspicious/noConsole: surface a failed auto-lock
              console.error("[sync] auto-lock after auth error failed", err);
            });
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

      client.onConflict(async ({ queueId, objectId, kind, myTombstone, theirTombstone }) => {
        const notice = { queueId, objectId, kind, myTombstone, theirTombstone };
        if (!cancelled)
          setConflicts((previous) =>
            previous.some((entry) => entry.queueId === queueId)
              ? previous.map((entry) => (entry.queueId === queueId ? notice : entry))
              : [...previous, notice],
          );
        return { action: "defer" };
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
      activeSaves.current.clear();
    };
    // user.userId is in the dep array so signing out and back in as a
    // different user tears down the store and re-initialises under the new
    // namespace. State alone does not change on hot user switches.
  }, [state, user?.userId]);

  const save = useCallback(
    async (input: EnqueueInput) => {
      const store = storeRef.current;
      const client = clientRef.current;
      if (!store) throw new Error("Store not ready");
      const memory = store.mode === "memory";
      const id = input.id ?? crypto.randomUUID();
      const pending = { confirmed: false };
      // Register before enqueue is visible to an already-running background push.
      if (memory) activeSaves.current.set(id, pending);
      try {
        await store.putAndEnqueue({ ...input, id });
        tick();
        if (!memory) {
          // The durable queue survives a network failure; polling retries it.
          void client?.pushPending().catch(() => {});
          return;
        }
        try {
          await client?.pushPending();
        } catch {
          // An earlier batch (or overlapping background push) may have confirmed
          // this exact ID before a later batch failed.
        }
        if (
          !pending.confirmed ||
          storeRef.current !== store ||
          activeSaves.current.get(id) !== pending
        )
          throw new Error("Upload not confirmed");
      } catch (cause) {
        if (!memory) throw cause;
        const message =
          "Not saved to the server. Reloading can lose these changes. Check your connection or resolve sync conflicts before reloading.";
        if (activeSaves.current.get(id) === pending)
          setSaveError(
            "A save could not be confirmed. Reloading can lose unconfirmed changes. Check your connection or resolve sync conflicts before reloading.",
          );
        throw new Error(message);
      } finally {
        if (activeSaves.current.get(id) === pending) activeSaves.current.delete(id);
      }
    },
    [tick],
  );

  const resolveConflict = useCallback(
    async (queueId: string, action: "keep-mine" | "keep-theirs") => {
      const client = clientRef.current;
      if (!client) throw new Error("Unlock to resolve this conflict.");
      await client.resolveConflict(queueId, { action });
      setConflicts((previous) => previous.filter((entry) => entry.queueId !== queueId));
    },
    [],
  );

  const syncValue = useMemo<SyncContextValue>(
    () => ({ ...storeState, storeClock, tick, conflicts, resolveConflict, save, saveError }),
    [storeState, storeClock, tick, conflicts, resolveConflict, save, saveError],
  );

  return <SyncContext.Provider value={syncValue}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (ctx === null) {
    throw new Error("useSync() must be used within <SyncProvider>");
  }
  return ctx;
}
