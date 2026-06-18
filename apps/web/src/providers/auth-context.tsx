"use client";

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
export type AuthState = "loading" | "unauthenticated" | "locked" | "unlocked";

export type PersistenceLevel = "memory" | "session" | "biometric";

export type AuthUser = {
  /** Absent when the auth state was rehydrated in `locked` state; only the
   *  username is needed to render the unlock screen. login()/unlock() and a
   *  fresh-vault rehydrate populate this. */
  userId?: string;
  username: string;
};

export type AuthPayload = {
  user: AuthUser;
  itemsKey: ItemsKey;
  persistence: PersistenceLevel;
};

export type AuthContextValue = {
  state: AuthState;
  user: AuthUser | null;
  persistence: PersistenceLevel;
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

/** Throttle for sliding the persisted window forward on activity. Far below the
 *  15-minute budget, so a worst-case-stale lastActiveAt is negligible. */
const VAULT_TOUCH_THROTTLE_MS = 60 * 1000;

/** Non-secret username in localStorage. Doubles as the "this device has an
 *  account" marker that decides locked vs unauthenticated on boot, and pre-fills
 *  the unlock screen. localStorage (not sessionStorage) so it survives a real
 *  close, which is what lets lock-on-close land on /unlock rather than login. */
export const USERNAME_KEY = "privance.username";

/** Non-secret account id in localStorage, so the locked-screen sign-out can
 *  derive the per-user OPFS filename and erase local ciphertext after a close
 *  wipes it from memory. The server already knows it; never key material. */
export const USER_ID_KEY = "privance.userId";

/** Written on an explicit lock to broadcast it to other same-origin tabs (a
 *  `storage` event fires only in the tabs that did not make the change). Carries
 *  a changing timestamp, never key material. */
const LOCK_BROADCAST_KEY = "privance.lockBroadcast";

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
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
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
    if (getDekStore() !== undefined) return "unlocked";
    // A persisted username means this device has an account; whether it is
    // locked or still unlocked is decided asynchronously from the session vault
    // (see the rehydrate effect), so hold in "loading" until then. No username
    // means never authenticated here, so stay public with no async work.
    if (localStorage.getItem(USERNAME_KEY) !== null) return "loading";
    return "unauthenticated";
  });
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (typeof window === "undefined") return null;
    const username = localStorage.getItem(USERNAME_KEY);
    return username !== null ? { username } : null;
  });
  const [persistence, setPersistence] = useState<PersistenceLevel>("memory");
  const autoLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityMs = useRef<number>(Date.now());
  const lastVaultTouchMs = useRef<number>(0);
  const logoutCleanupsRef = useRef<Set<() => void | Promise<void>>>(new Set());

  const registerLogoutCleanup = useCallback((cb: () => void | Promise<void>) => {
    logoutCleanupsRef.current.add(cb);
    return () => {
      logoutCleanupsRef.current.delete(cb);
    };
  }, []);

  const triggerLockReload = useCallback(async () => {
    clearDekStore();
    // Purge before reload: a not-yet-committed delete would leave a fresh vault
    // and the reboot would auto-unlock instead of locking.
    await clearSession();
    setState("locked");
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (autoLockTimer.current !== null) clearTimeout(autoLockTimer.current);
    lastActivityMs.current = Date.now();
    autoLockTimer.current = setTimeout(triggerLockReload, autoLockMs);
  }, [autoLockMs, triggerLockReload]);

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
          await clearSession();
          if (cancelled) return;
          setState("locked");
          return;
        }
        const itemsKey = await loadSession(Date.now());
        if (cancelled) return;
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

  // Cross-tab lock/logout. A `storage` event fires only in the OTHER tabs, so
  // when one tab locks (broadcast key) or logs out (username removed), scrub the
  // in-memory DEK here too and reload to clear V8 internals, matching the active
  // tab's lock path. Without this, "Lock"/"Sign out" would only affect the tab
  // the user clicked while siblings kept a live, decrypting DEK. Idle auto-lock
  // is deliberately per-tab and does not broadcast.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      const loggedOut = e.key === USERNAME_KEY && e.newValue === null;
      const locked = e.key === LOCK_BROADCAST_KEY && e.newValue !== null;
      if (!loggedOut && !locked) return;
      clearDekStore();
      clearIdleTimer();
      setState(loggedOut ? "unauthenticated" : "locked");
      window.location.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [clearIdleTimer]);

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
    setDekStore({ itemsKey: payload.itemsKey });
    localStorage.setItem(USERNAME_KEY, payload.user.username);
    if (payload.user.userId !== undefined) {
      localStorage.setItem(USER_ID_KEY, payload.user.userId);
    }
    const now = Date.now();
    await persistSession(payload.itemsKey, now);
    if (payload.user.userId !== undefined) {
      await reArm({ itemsKey: payload.itemsKey, userId: payload.user.userId, now });
    }
    setUser(payload.user);
    setPersistence(payload.persistence);
    resetPricesCache();
    resetProfilesCache();
    applyStartVeilOnAuth();
    setState("unlocked");
  }, []);

  const unlock = useCallback(async (payload: AuthPayload) => {
    setDekStore({ itemsKey: payload.itemsKey });
    localStorage.setItem(USERNAME_KEY, payload.user.username);
    if (payload.user.userId !== undefined) {
      localStorage.setItem(USER_ID_KEY, payload.user.userId);
    }
    const now = Date.now();
    await persistSession(payload.itemsKey, now);
    // A biometric unlock never extends its own cadence; only password-derived unlocks re-arm.
    if (payload.persistence !== "biometric" && payload.user.userId !== undefined) {
      await reArm({ itemsKey: payload.itemsKey, userId: payload.user.userId, now });
    }
    setUser(payload.user);
    setPersistence(payload.persistence);
    applyStartVeilOnAuth();
    setState("unlocked");
  }, []);

  const lock = useCallback(async () => {
    clearDekStore();
    clearIdleTimer();
    await clearSession();
    localStorage.setItem(LOCK_BROADCAST_KEY, String(Date.now()));
    setState("locked");
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }, [clearIdleTimer]);

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
    setUser(null);
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
      login,
      unlock,
      lock,
      logout,
      registerLogoutCleanup,
    }),
    [state, user, persistence, login, unlock, lock, logout, registerLogoutCleanup],
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
