import type { ItemsKey } from "@privance/core";
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
import { resetPricesCache } from "@/lib/queries/prices";
import { resetProfilesCache } from "@/lib/queries/profiles";
import { purgeEnrollment, reArm } from "@/lib/storage/biometric-store";
import {
  clearSession,
  loadSession,
  persistSession,
  SESSION_TTL_MS,
  touchSession,
} from "@/lib/storage/session-vault";
import { applyStartVeilOnAuth } from "@/lib/veil";

const DEK_STORE_SYMBOL = Symbol.for("privance.dekStore.v1");

type DekStore = {
  itemsKey: ItemsKey;
};

type GlobalWithDek = typeof globalThis & Record<symbol, unknown>;

function getDekStore(): DekStore | undefined {
  return (globalThis as GlobalWithDek)[DEK_STORE_SYMBOL] as DekStore | undefined;
}

function setDekStore(store: DekStore): void {
  (globalThis as GlobalWithDek)[DEK_STORE_SYMBOL] = store;
}

function clearDekStore(): void {
  Reflect.deleteProperty(globalThis as GlobalWithDek, DEK_STORE_SYMBOL);
}

/** `loading` is the transient boot state while the session vault is read
 *  asynchronously; the app shell holds (no redirect) until it resolves to
 *  `unlocked` or `locked`. */
type AuthState = "loading" | "unauthenticated" | "locked" | "unlocked";

type PersistenceLevel = "memory" | "session" | "biometric";

type AuthUser = {
  /** Absent when the auth state was rehydrated in `locked` state; only the
   *  username is needed to render the unlock screen. login()/unlock() and a
   *  fresh-vault rehydrate populate this. */
  userId?: string;
  username: string;
};

type AuthPayload = {
  user: AuthUser;
  itemsKey: ItemsKey;
  persistence: PersistenceLevel;
};

type AuthContextValue = {
  state: AuthState;
  user: AuthUser | null;
  persistence: PersistenceLevel;
  lockFailed: boolean;
  login: (payload: AuthPayload) => Promise<void>;
  unlock: (payload: AuthPayload) => Promise<void>;
  lock: () => Promise<void>;
  logout: (opts?: { keepEnrollment?: boolean }) => Promise<void>;
  /** Register a cleanup callback to run on logout, before the auth state
   *  transitions to "unauthenticated". Returns an unregister function. Used by
   *  SyncProvider to unlink the per-user OPFS file on logout (but not lock). */
  registerLogoutCleanup: (cb: () => void | Promise<void>) => () => void;
};

/** Idle auto-lock shares the session window: the same elapsed-time budget
 *  governs going idle while open and reopening after a close. */
const DEFAULT_AUTO_LOCK_MS = SESSION_TTL_MS;
const LOCK_SESSION_CLEAR_TIMEOUT_MS = 1_000;
const LOCK_CHANNEL_NAME = "privance.auth";

/** Throttle for sliding the persisted window forward on activity. Far below the
 *  15-minute budget, so a worst-case-stale lastActiveAt is negligible. */
const VAULT_TOUCH_THROTTLE_MS = 60 * 1000;

function clearSessionForLock(): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, LOCK_SESSION_CLEAR_TIMEOUT_MS);
    void clearSession().then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      () => {
        clearTimeout(timeout);
        resolve();
      },
    );
  });
}

/** Non-secret username in localStorage. Doubles as the "this device has an
 *  account" marker that decides locked vs unauthenticated on boot, and pre-fills
 *  the unlock screen. localStorage (not sessionStorage) so it survives a real
 *  close, which is what lets lock-on-close land on /unlock rather than login. */
export const USERNAME_KEY = "privance.username";

/** Non-secret boot marker set before a deliberate lock. It makes a hard reload
 * fail closed even if a browser stalls the best-effort IndexedDB purge. */
const LOCKED_KEY = "privance.locked";

/** Non-secret account id in localStorage, so the locked-screen sign-out can
 *  derive the per-user OPFS filename and erase local ciphertext after a close
 *  wipes it from memory. The server already knows it; never key material. */
export const USER_ID_KEY = "privance.userId";

function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Written on an explicit lock to notify other same-origin tabs via `storage`. */
const LOCK_BROADCAST_KEY = "privance.lockBroadcast";

type LockMarkerWrites = { local: boolean; session: boolean };

type LockOutcome = "locked" | "signed-out" | "failed";

function lockToken(prefix: "auth" | "lock"): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function hasLockMarker(): boolean {
  let storageFailed = false;
  try {
    const marker = localStorage.getItem(LOCKED_KEY);
    if (marker !== null) return true;
  } catch {
    storageFailed = true;
  }
  try {
    const marker = sessionStorage.getItem(LOCKED_KEY);
    if (marker !== null) return true;
  } catch {
    storageFailed = true;
  }
  return storageFailed;
}

function writeLockMarkers(token: string): LockMarkerWrites {
  const writes = { local: false, session: false };
  try {
    localStorage.setItem(LOCKED_KEY, token);
    writes.local = true;
  } catch {}
  try {
    sessionStorage.setItem(LOCKED_KEY, token);
    writes.session = true;
  } catch {}
  return writes;
}

function stillOwnsLockMarkers(token: string, writes: LockMarkerWrites): boolean {
  try {
    return (
      (!writes.local || localStorage.getItem(LOCKED_KEY) === token) &&
      (!writes.session || sessionStorage.getItem(LOCKED_KEY) === token)
    );
  } catch {
    return false;
  }
}

function clearLockMarkers(token?: string): void {
  try {
    if (token === undefined || localStorage.getItem(LOCKED_KEY) === token) {
      localStorage.removeItem(LOCKED_KEY);
    }
  } catch {}
  try {
    if (token === undefined || sessionStorage.getItem(LOCKED_KEY) === token) {
      sessionStorage.removeItem(LOCKED_KEY);
    }
  } catch {}
}

/** True when the current document load was a reload (F5 / pull-to-refresh)
 *  rather than a fresh navigation or cold app launch. Survive-refresh restores
 *  the session only on a reload; a missing timing entry degrades to `true` so an
 *  engine without Navigation Timing still survives a refresh. */
function isReloadNavigation(): boolean {
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry === undefined || entry.type === "reload";
}

/** True when running as an installed standalone PWA, where a cold launch is a
 *  real close-then-reopen. iOS exposes the non-standard `navigator.standalone`;
 *  other engines report it through the display-mode media query. */
function isStandalonePwa(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (iosStandalone) return true;
  try {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches
    );
  } catch {
    return false;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  autoLockMs = DEFAULT_AUTO_LOCK_MS,
}: {
  children: ReactNode;
  autoLockMs?: number;
}) {
  const [state, setState] = useState<AuthState>(() => {
    // Guard against SSR: globalThis DEK store and Web Storage are unavailable in
    // Node during the static export build, window is undefined in that context.
    if (typeof window === "undefined") return "unauthenticated";
    // A persisted username means this device has an account; whether it is
    // locked or still unlocked is decided asynchronously from the session vault
    // (see the rehydrate effect), so hold in "loading" until then. No username
    // means never authenticated here, so stay public with no async work.
    const hasDek = getDekStore() !== undefined;
    if (readLocalStorage(USERNAME_KEY) === null) return hasDek ? "unlocked" : "unauthenticated";
    if (hasLockMarker()) return "locked";
    return hasDek ? "unlocked" : "loading";
  });
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (typeof window === "undefined") return null;
    const username = readLocalStorage(USERNAME_KEY);
    return username !== null ? { username } : null;
  });
  const [persistence, setPersistence] = useState<PersistenceLevel>("memory");
  const [lockFailed, setLockFailed] = useState(false);
  const autoLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityMs = useRef<number>(Date.now());
  const lastVaultTouchMs = useRef<number>(0);
  const logoutCleanupsRef = useRef<Set<() => void | Promise<void>>>(new Set());
  const lockRevision = useRef(0);
  const lockChannel = useRef<BroadcastChannel | null>(null);

  const registerLogoutCleanup = useCallback((cb: () => void | Promise<void>) => {
    logoutCleanupsRef.current.add(cb);
    return () => {
      logoutCleanupsRef.current.delete(cb);
    };
  }, []);

  const clearForLock = useCallback(
    async (announce?: (token: string) => void): Promise<LockOutcome> => {
      lockRevision.current += 1;
      setLockFailed(false);
      const token = lockToken("lock");
      const markerWrites = writeLockMarkers(token);
      announce?.(token);

      if (markerWrites.local) {
        clearDekStore();
        setState("locked");
        await clearSessionForLock();
        return "locked";
      }

      try {
        localStorage.removeItem(USERNAME_KEY);
      } catch {
        setLockFailed(true);
        void clearSessionForLock();
        return "failed";
      }
      try {
        localStorage.removeItem(USER_ID_KEY);
      } catch {}

      clearDekStore();
      setUser(null);
      setState("unauthenticated");
      void clearSessionForLock();
      return "signed-out";
    },
    [],
  );

  const scheduleIdleLock = useCallback(
    (callback: () => void) => {
      if (autoLockTimer.current !== null) clearTimeout(autoLockTimer.current);
      lastActivityMs.current = Date.now();
      autoLockTimer.current = setTimeout(callback, autoLockMs);
    },
    [autoLockMs],
  );

  const triggerLockReload = useCallback(async () => {
    const revision = lockRevision.current + 1;
    const outcome = await clearForLock();
    // The marker and locked UI fail closed even if IndexedDB stalls. Purge before
    // reload when it responds so the stale vault record is not left behind.
    if (
      outcome === "locked" &&
      revision === lockRevision.current &&
      typeof window !== "undefined"
    ) {
      window.location.reload();
    } else if (
      outcome === "failed" &&
      revision === lockRevision.current &&
      getDekStore() !== undefined
    ) {
      scheduleIdleLock(() => void triggerLockReload());
    }
  }, [clearForLock, scheduleIdleLock]);

  const resetIdleTimer = useCallback(
    () => scheduleIdleLock(() => void triggerLockReload()),
    [scheduleIdleLock, triggerLockReload],
  );

  const clearIdleTimer = useCallback(() => {
    if (autoLockTimer.current !== null) {
      clearTimeout(autoLockTimer.current);
      autoLockTimer.current = null;
    }
  }, []);

  // Rehydrate from the session vault on boot. A same-tab reload within the
  // window unwraps the DEK locally and resumes "unlocked" with no password,
  // username, or server round-trip; an expired or absent vault resolves to
  // "locked" (the username is already known) so /unlock can take over.
  useEffect(() => {
    if (state !== "loading") return;
    let cancelled = false;
    void (async () => {
      try {
        // Lock-on-close: in an installed PWA a non-reload boot is a cold launch
        // (the app was closed and reopened), so purge the vault and require the
        // master password rather than auto-unlocking within the window. A same-tab
        // reload (type "reload") still restores below. Browser tabs keep the
        // timer-bounded behavior; private browsing wipes storage on close anyway.
        if (isStandalonePwa() && !isReloadNavigation()) {
          lockRevision.current += 1;
          writeLockMarkers(lockToken("lock"));
          await clearSessionForLock();
          if (cancelled) return;
          setState("locked");
          return;
        }
        const revision = lockRevision.current;
        if (hasLockMarker()) {
          setState("locked");
          return;
        }
        const itemsKey = await loadSession(Date.now());
        if (cancelled) return;
        if (revision !== lockRevision.current || hasLockMarker()) {
          setState("locked");
          return;
        }
        if (itemsKey === null) {
          setState("locked");
          return;
        }
        // The per-user local store keys off userId, so a vault without its
        // companion username/userId in localStorage is unusable. Fail closed to
        // "locked" (re-auth) rather than resuming a half-initialised session.
        const username = localStorage.getItem(USERNAME_KEY);
        const userId = localStorage.getItem(USER_ID_KEY);
        if (username === null || userId === null) {
          setState("locked");
          return;
        }
        setDekStore({ itemsKey });
        setUser({ username, userId });
        setPersistence("session");
        setState("unlocked");
      } finally {
        if (!cancelled) performance.mark("privance:auth-resolved");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  // Idle auto-lock is deliberately per-tab; explicit locks also use a channel
  // so siblings are notified if localStorage events are unavailable.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pendingLocks = new Set<string>();
    const lockSibling = (token: string) => {
      if (pendingLocks.has(token)) return;
      pendingLocks.add(token);
      clearIdleTimer();
      const revision = lockRevision.current + 1;
      void clearForLock()
        .then((outcome) => {
          if (outcome === "locked" && revision === lockRevision.current) {
            window.location.reload();
          } else if (
            outcome === "failed" &&
            revision === lockRevision.current &&
            getDekStore() !== undefined
          ) {
            resetIdleTimer();
          }
        })
        .finally(() => pendingLocks.delete(token));
    };
    const onStorage = (e: StorageEvent) => {
      const loggedOut = e.key === USERNAME_KEY && e.newValue === null;
      if (loggedOut) {
        lockRevision.current += 1;
        clearDekStore();
        clearIdleTimer();
        setState("unauthenticated");
        window.location.reload();
        return;
      }
      if (e.key === LOCK_BROADCAST_KEY && e.newValue !== null) lockSibling(e.newValue);
    };
    const onMessage = (event: MessageEvent<{ type?: string; token?: string }>) => {
      if (event.data?.type === "lock" && typeof event.data.token === "string") {
        lockSibling(event.data.token);
      }
    };
    const channel =
      typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(LOCK_CHANNEL_NAME);
    lockChannel.current = channel;
    channel?.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      if (lockChannel.current === channel) lockChannel.current = null;
    };
  }, [clearForLock, clearIdleTimer, resetIdleTimer]);

  useEffect(() => {
    if (state !== "unlocked") {
      clearIdleTimer();
      return;
    }

    resetIdleTimer();
    // Seed the touch throttle so the first activity after unlock does not write
    // a redundant lastActiveAt (persistSession just wrote it).
    lastVaultTouchMs.current = Date.now();

    const events = ["mousemove", "keydown", "pointerdown", "scroll", "touchstart"] as const;
    const handleActivity = () => {
      resetIdleTimer();
      // Slide the persisted window forward, throttled, so reopening after a
      // close is judged from real last activity rather than login time.
      const now = Date.now();
      if (now - lastVaultTouchMs.current >= VAULT_TOUCH_THROTTLE_MS) {
        lastVaultTouchMs.current = now;
        void touchSession(now);
      }
    };

    // setTimeout pauses or runs late in backgrounded tabs, so the elapsed-time
    // guarantee can silently slip on mobile. On every return to the foreground
    // (or back-forward cache restore) check elapsed wall-clock time and lock
    // immediately if past the threshold. On hide, record the exact leave time
    // so a later reopen measures from when the user actually left.
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") {
        void touchSession(Date.now());
        return;
      }
      if (Date.now() - lastActivityMs.current >= autoLockMs) {
        void triggerLockReload();
      } else {
        resetIdleTimer();
      }
    };

    for (const ev of events) {
      window.addEventListener(ev, handleActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", handleVisibility);

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, handleActivity);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", handleVisibility);
      clearIdleTimer();
    };
  }, [state, autoLockMs, resetIdleTimer, clearIdleTimer, triggerLockReload]);

  // Persist the wrapped DEK so a later same-tab reload (F5 / pull-to-refresh)
  // reboots straight back into "unlocked" with no re-auth. The auth -> app
  // redirect itself is a soft client-side navigation that preserves the
  // in-memory DEK, so login does not rely on the vault for its own transition.
  const login = useCallback(async (payload: AuthPayload) => {
    const revision = ++lockRevision.current;
    const token = lockToken("auth");
    const markerWrites = writeLockMarkers(token);
    localStorage.setItem(USERNAME_KEY, payload.user.username);
    if (payload.user.userId !== undefined) {
      localStorage.setItem(USER_ID_KEY, payload.user.userId);
    }
    const now = Date.now();
    const persisted = await persistSession(payload.itemsKey, now, {
      shouldPersist: () =>
        revision === lockRevision.current && stillOwnsLockMarkers(token, markerWrites),
    });
    if (revision !== lockRevision.current || !stillOwnsLockMarkers(token, markerWrites)) return;
    if (payload.user.userId !== undefined) {
      await reArm({ itemsKey: payload.itemsKey, userId: payload.user.userId, now });
    }
    if (revision !== lockRevision.current || !stillOwnsLockMarkers(token, markerWrites)) return;
    if (persisted) clearLockMarkers(token);
    setDekStore({ itemsKey: payload.itemsKey });
    setUser(payload.user);
    setPersistence(payload.persistence);
    resetPricesCache();
    resetProfilesCache();
    setLockFailed(false);
    applyStartVeilOnAuth();
    setState("unlocked");
  }, []);

  const unlock = useCallback(async (payload: AuthPayload) => {
    const revision = ++lockRevision.current;
    const token = lockToken("auth");
    const markerWrites = writeLockMarkers(token);
    localStorage.setItem(USERNAME_KEY, payload.user.username);
    if (payload.user.userId !== undefined) {
      localStorage.setItem(USER_ID_KEY, payload.user.userId);
    }
    const now = Date.now();
    const persisted = await persistSession(payload.itemsKey, now, {
      shouldPersist: () =>
        revision === lockRevision.current && stillOwnsLockMarkers(token, markerWrites),
    });
    if (revision !== lockRevision.current || !stillOwnsLockMarkers(token, markerWrites)) return;
    // A biometric unlock never extends its own cadence; only password-derived unlocks re-arm.
    if (payload.persistence !== "biometric" && payload.user.userId !== undefined) {
      await reArm({ itemsKey: payload.itemsKey, userId: payload.user.userId, now });
    }
    if (revision !== lockRevision.current || !stillOwnsLockMarkers(token, markerWrites)) return;
    if (persisted) clearLockMarkers(token);
    setDekStore({ itemsKey: payload.itemsKey });
    setUser(payload.user);
    setPersistence(payload.persistence);
    setLockFailed(false);
    applyStartVeilOnAuth();
    setState("unlocked");
  }, []);

  const lock = useCallback(async () => {
    clearIdleTimer();
    const revision = lockRevision.current + 1;
    const outcome = await clearForLock((token) => {
      try {
        localStorage.setItem(LOCK_BROADCAST_KEY, token);
      } catch {
        // BroadcastChannel below remains available when storage is blocked.
      }
      try {
        lockChannel.current?.postMessage({ type: "lock", token });
      } catch {
        // The current tab still locks when sibling notifications are unavailable.
      }
    });
    if (
      outcome === "locked" &&
      revision === lockRevision.current &&
      typeof window !== "undefined"
    ) {
      window.location.replace("/unlock");
    } else if (
      outcome === "failed" &&
      revision === lockRevision.current &&
      getDekStore() !== undefined
    ) {
      resetIdleTimer();
    }
  }, [clearForLock, clearIdleTimer, resetIdleTimer]);

  // allSettled (not a sequential await) so the worker's openDbWithRetry
  // contention loop sees the destroys as one cluster on a fast
  // logout-then-relogin. Throwing callbacks are coerced to resolved so one
  // bad cleanup never blocks the rest.
  const runLogoutCleanups = useCallback((): Promise<unknown> => {
    const pending = [...logoutCleanupsRef.current].map((cb) => {
      try {
        return cb();
      } catch {
        return Promise.resolve();
      }
    });
    return Promise.allSettled(pending);
  }, []);

  const finishLogout = useCallback(() => {
    clearDekStore();
    clearIdleTimer();
    resetPricesCache();
    resetProfilesCache();
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(USER_ID_KEY);
    clearLockMarkers();
    setUser(null);
    setLockFailed(false);
    setState("unauthenticated");
  }, [clearIdleTimer]);

  // Awaitable so callers that hard-navigate (settings / navbar sign-out) can let
  // the registered store.destroy() finish first, otherwise the page unloads
  // mid-destroy and the per-user OPFS ciphertext is orphaned.
  //
  // keepEnrollment leaves the biometric record intact: a lapsed server session
  // is orthogonal to local key custody, so an expiry-driven scrub must not force
  // the user to re-enroll. Explicit sign-out keeps the default (purge).
  const logout = useCallback(
    async ({ keepEnrollment = false }: { keepEnrollment?: boolean } = {}) => {
      lockRevision.current += 1;
      await runLogoutCleanups();
      await clearSession();
      // Purge before finishLogout removes USERNAME_KEY and broadcasts to sibling
      // tabs, so they reload into an already-purged state. Any future DEK-rotation
      // flow must also purge here.
      if (!keepEnrollment) await purgeEnrollment();
      finishLogout();
    },
    [runLogoutCleanups, finishLogout],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      user,
      persistence,
      lockFailed,
      login,
      unlock,
      lock,
      logout,
      registerLogoutCleanup,
    }),
    [state, user, persistence, lockFailed, login, unlock, lock, logout, registerLogoutCleanup],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth() must be used within <AuthProvider>");
  }
  return ctx;
}

export function readItemsKey(): ItemsKey | null {
  return getDekStore()?.itemsKey ?? null;
}
