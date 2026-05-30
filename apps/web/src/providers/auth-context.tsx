"use client";

import type { ItemsKey } from "@privance/core";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { resetPricesCache } from "@/lib/queries/prices";

// ---------------------------------------------------------------------------
// DEK store, lives outside React state, never logged
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// State machine types
// ---------------------------------------------------------------------------

export type AuthState = "unauthenticated" | "locked" | "unlocked";

export type PersistenceLevel = "memory" | "session" | "biometric";

export type AuthUser = {
  /** Absent when the auth state was rehydrated from sessionStorage in `locked`
   *  state — only username is persisted across the lock-induced reload. login()
   *  populates this on a successful unlock. */
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
  login: (payload: AuthPayload) => void;
  unlock: (payload: AuthPayload) => void;
  lock: () => void;
  logout: () => void;
  /** Register a cleanup callback to run on logout, before the auth state
   *  transitions to "unauthenticated". Returns an unregister function. Used by
   *  SyncProvider to unlink the per-user OPFS file on logout (but not lock). */
  registerLogoutCleanup: (cb: () => void | Promise<void>) => () => void;
};

// ---------------------------------------------------------------------------
// Auto-lock idle timer
// ---------------------------------------------------------------------------

const DEFAULT_AUTO_LOCK_MS = 30 * 60 * 1000;

/** Set in sessionStorage so a reload-on-lock can resume in the "locked" state
 *  instead of falling all the way back to "unauthenticated". */
const LOCKED_MARKER = "privance.lockedMarker";

/** Persisted alongside the lock marker so /unlock can pre-fill the username and
 *  skip an unnecessary field. The server already knows it; sessionStorage clears
 *  on tab close, same lifetime as the session cookie. */
const USERNAME_KEY = "privance.username";

/** Non-secret account id, persisted so the locked-screen sign-out can derive the
 *  per-user OPFS filename and erase local ciphertext after a lock-reload wipes
 *  it from memory. The server already knows it; never key material. */
export const USER_ID_KEY = "privance.userId";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  autoLockMs = DEFAULT_AUTO_LOCK_MS,
}: {
  children: ReactNode;
  autoLockMs?: number;
}) {
  const [state, setState] = useState<AuthState>(() => {
    // Guard against SSR: globalThis DEK store access must not run in Node
    // during the static export build, window is undefined in that context.
    if (typeof window === "undefined") return "unauthenticated";
    if (getDekStore() !== undefined) return "unlocked";
    // Auto-lock and manual lock issue location.reload() to scrub V8 internals.
    // Without a marker the new boot has no way to know the user was locked vs
    // never authenticated, so /unlock is unreachable. sessionStorage survives
    // reload but not tab close, which is exactly the lock-vs-logout boundary.
    if (sessionStorage.getItem(LOCKED_MARKER) === "1") return "locked";
    return "unauthenticated";
  });
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (typeof window === "undefined") return null;
    const username = sessionStorage.getItem(USERNAME_KEY);
    if (sessionStorage.getItem(LOCKED_MARKER) === "1" && username !== null) {
      return { username };
    }
    return null;
  });
  const [persistence, setPersistence] = useState<PersistenceLevel>("memory");
  const autoLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityMs = useRef<number>(Date.now());
  const logoutCleanupsRef = useRef<Set<() => void | Promise<void>>>(new Set());

  const registerLogoutCleanup = useCallback((cb: () => void | Promise<void>) => {
    logoutCleanupsRef.current.add(cb);
    return () => {
      logoutCleanupsRef.current.delete(cb);
    };
  }, []);

  const triggerLockReload = useCallback(() => {
    clearDekStore();
    sessionStorage.setItem(LOCKED_MARKER, "1");
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

  useEffect(() => {
    if (state !== "unlocked") {
      clearIdleTimer();
      return;
    }

    resetIdleTimer();

    const events = ["mousemove", "keydown", "pointerdown", "scroll", "touchstart"] as const;
    const handleActivity = () => resetIdleTimer();

    // setTimeout pauses or runs late in backgrounded tabs, so the 30-minute
    // guarantee can silently slip on mobile. On every return to the foreground
    // (or back-forward cache restore) check elapsed wall-clock time and lock
    // immediately if past the threshold.
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityMs.current >= autoLockMs) {
        triggerLockReload();
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

  const login = useCallback((payload: AuthPayload) => {
    setDekStore({ itemsKey: payload.itemsKey });
    sessionStorage.removeItem(LOCKED_MARKER);
    sessionStorage.setItem(USERNAME_KEY, payload.user.username);
    if (payload.user.userId !== undefined) {
      sessionStorage.setItem(USER_ID_KEY, payload.user.userId);
    }
    setUser(payload.user);
    setPersistence(payload.persistence);
    resetPricesCache();
    setState("unlocked");
  }, []);

  const unlock = useCallback((payload: AuthPayload) => {
    setDekStore({ itemsKey: payload.itemsKey });
    sessionStorage.removeItem(LOCKED_MARKER);
    sessionStorage.setItem(USERNAME_KEY, payload.user.username);
    if (payload.user.userId !== undefined) {
      sessionStorage.setItem(USER_ID_KEY, payload.user.userId);
    }
    setUser(payload.user);
    setPersistence(payload.persistence);
    setState("unlocked");
  }, []);

  const lock = useCallback(() => {
    clearDekStore();
    clearIdleTimer();
    sessionStorage.setItem(LOCKED_MARKER, "1");
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
    sessionStorage.removeItem(LOCKED_MARKER);
    sessionStorage.removeItem(USERNAME_KEY);
    sessionStorage.removeItem(USER_ID_KEY);
    setUser(null);
    setState("unauthenticated");
  }, [clearIdleTimer]);

  const logout = useCallback(() => {
    void runLogoutCleanups();
    finishLogout();
  }, [runLogoutCleanups, finishLogout]);

  return (
    <AuthContext.Provider
      value={{
        state,
        user,
        persistence,
        login,
        unlock,
        lock,
        logout,
        registerLogoutCleanup,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
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
