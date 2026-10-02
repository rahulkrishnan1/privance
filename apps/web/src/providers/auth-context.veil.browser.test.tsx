/**
 * Browser tests for start-veiled re-assertion at the authentication boundary.
 * login()/unlock() must re-veil when the preference is on; the survive-refresh
 * rehydrate path must not, so an in-session reveal survives a reload.
 */

import type { ItemsKey } from "@privance/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { clearSession, loadSession, persistSession } from "@/lib/storage/session-vault";
import { readVeil, writeStartVeil, writeVeil } from "@/lib/veil";
import { AuthProvider, readItemsKey, USER_ID_KEY, USERNAME_KEY, useAuth } from "./auth-context";

const testState = vi.hoisted(() => ({
  stallSessionClear: false,
  failSessionClear: false,
  failSessionPersist: false,
  deferSessionPersist: false,
  resolveSessionPersist: null as null | ((persisted: boolean) => void),
}));

vi.mock("@/lib/storage/session-vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/session-vault")>();
  return {
    ...actual,
    clearSession: () => {
      if (testState.stallSessionClear) return new Promise<void>(() => {});
      if (testState.failSessionClear) return Promise.resolve();
      return actual.clearSession();
    },
    persistSession: (...args: Parameters<typeof actual.persistSession>) => {
      if (testState.failSessionPersist) return Promise.resolve(false);
      if (testState.deferSessionPersist) {
        return new Promise<boolean>((resolve) => {
          testState.resolveSessionPersist = resolve;
        });
      }
      return actual.persistSession(...args);
    },
  };
});

const DEK_STORE_SYMBOL = Symbol.for("privance.dekStore.v1");
let cleanupRender: (() => void) | null = null;

function makeItemsKey(): ItemsKey {
  return crypto.getRandomValues(new Uint8Array(32)) as unknown as ItemsKey;
}

function AuthHarness({ onReady }: { onReady: (api: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  onReady(auth);
  return null;
}

async function renderAuth(autoLockMs?: number) {
  let api!: ReturnType<typeof useAuth>;
  const screen = await render(
    <AuthProvider autoLockMs={autoLockMs}>
      <AuthHarness
        onReady={(a) => {
          api = a;
        }}
      />
    </AuthProvider>,
  );
  cleanupRender = () => screen.unmount();
  return { getApi: () => api };
}

async function resetTestState() {
  cleanupRender?.();
  cleanupRender = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  testState.stallSessionClear = false;
  testState.failSessionClear = false;
  testState.failSessionPersist = false;
  testState.deferSessionPersist = false;
  testState.resolveSessionPersist = null;
  // The DEK store lives on globalThis across renders; clear it between tests.
  Reflect.deleteProperty(globalThis as Record<symbol, unknown>, DEK_STORE_SYMBOL);
  await clearSession();
  localStorage.clear();
  sessionStorage.clear();
}

beforeEach(resetTestState);
afterEach(resetTestState);

describe("start-veiled at the authentication boundary", () => {
  it("re-veils on login when the preference is on", async () => {
    writeStartVeil(true);
    writeVeil(false);

    const { getApi } = await renderAuth();
    await getApi().login({
      user: { userId: "u-login", username: "alice" },
      itemsKey: makeItemsKey(),
      persistence: "session",
    });

    expect(readVeil()).toBe(true);
  });

  it("re-veils on unlock when the preference is on", async () => {
    writeStartVeil(true);
    writeVeil(false);

    const { getApi } = await renderAuth();
    await getApi().unlock({
      user: { userId: "u-unlock", username: "bob" },
      itemsKey: makeItemsKey(),
      persistence: "memory",
    });

    expect(readVeil()).toBe(true);
  });

  it("clears a stale veiled toggle on unlock when the preference is off", async () => {
    writeStartVeil(false);
    writeVeil(true);

    const { getApi } = await renderAuth();
    await getApi().unlock({
      user: { userId: "u-off", username: "carol" },
      itemsKey: makeItemsKey(),
      persistence: "memory",
    });

    expect(readVeil()).toBe(false);
  });

  it("does not re-veil on a survive-refresh rehydrate, preserving an in-session reveal", async () => {
    // Seed a live session so AuthProvider boots to "unlocked" via rehydrate, not login/unlock.
    const now = Date.now();
    await persistSession(makeItemsKey(), now);
    localStorage.setItem(USERNAME_KEY, "dave");
    localStorage.setItem(USER_ID_KEY, "u-rehydrate");
    writeStartVeil(true);
    writeVeil(false);

    const { getApi } = await renderAuth();
    await vi.waitFor(() => expect(getApi().state).toBe("unlocked"));

    expect(readVeil()).toBe(false);
  });

  it("stays locked when a valid session vault exists behind the lock marker", async () => {
    await persistSession(makeItemsKey(), Date.now());
    localStorage.setItem(USERNAME_KEY, "erin");
    localStorage.setItem(USER_ID_KEY, "u-locked");
    localStorage.setItem("privance.locked", "1");

    const { getApi } = await renderAuth();

    expect(getApi().state).toBe("locked");
    expect(Reflect.get(globalThis as Record<symbol, unknown>, DEK_STORE_SYMBOL)).toBeUndefined();
  });

  it("does not restore a valid session vault without its account identity", async () => {
    await persistSession(makeItemsKey(), Date.now());
    localStorage.setItem(USERNAME_KEY, "erin");

    const { getApi } = await renderAuth();

    await vi.waitFor(() => expect(getApi().state).toBe("locked"));
    expect(readItemsKey()).toBeNull();
  });

  it("rehydrates when matchMedia is unavailable", async () => {
    await persistSession(makeItemsKey(), Date.now());
    localStorage.setItem(USERNAME_KEY, "erin");
    localStorage.setItem(USER_ID_KEY, "u-no-match-media");
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
    try {
      const { getApi } = await renderAuth();
      await vi.waitFor(() => expect(getApi().state).toBe("unlocked"));
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("stays locked when only the same-tab marker is available", async () => {
    localStorage.setItem(USERNAME_KEY, "erin");
    sessionStorage.setItem("privance.locked", "lock:tab");

    const { getApi } = await renderAuth();

    expect(getApi().state).toBe("locked");
  });

  it("fails closed when one lock-marker storage cannot be read", async () => {
    await persistSession(makeItemsKey(), Date.now());
    localStorage.setItem(USERNAME_KEY, "erin");
    localStorage.setItem(USER_ID_KEY, "u-locked");
    const originalGetItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      if (this === sessionStorage && key === "privance.locked") {
        throw new DOMException("storage unavailable", "SecurityError");
      }
      return originalGetItem.call(this, key);
    });

    const { getApi } = await renderAuth();

    expect(getApi().state).toBe("locked");
    expect(Reflect.get(globalThis as Record<symbol, unknown>, DEK_STORE_SYMBOL)).toBeUndefined();
  });

  it("fails closed immediately when idle-lock vault cleanup stalls", async () => {
    vi.useFakeTimers();
    const { getApi } = await renderAuth(50);
    await getApi().login({
      user: { userId: "u-idle-lock", username: "frank" },
      itemsKey: makeItemsKey(),
      persistence: "session",
    });
    testState.stallSessionClear = true;

    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => expect(getApi().state).toBe("locked"));

    expect(localStorage.getItem("privance.locked")).not.toBeNull();
    expect(Reflect.get(globalThis as Record<symbol, unknown>, DEK_STORE_SYMBOL)).toBeUndefined();
    vi.clearAllTimers();
  });

  it("signs out when lock markers and vault clearing both fail", async () => {
    const { getApi } = await renderAuth(10_000);
    await getApi().login({
      user: { userId: "u-storage-lock", username: "grace" },
      itemsKey: makeItemsKey(),
      persistence: "session",
    });
    await vi.waitFor(() => expect(getApi().state).toBe("unlocked"));
    testState.failSessionClear = true;

    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === "privance.locked") throw new DOMException("quota exceeded", "QuotaExceededError");
      return originalSetItem.call(localStorage, key, value);
    });

    await getApi().lock();

    await vi.waitFor(() => expect(getApi().state).toBe("unauthenticated"));
    expect(localStorage.getItem(USERNAME_KEY)).toBeNull();
    expect(localStorage.getItem(USER_ID_KEY)).toBeNull();
    expect(localStorage.getItem("privance.locked")).toBeNull();
    expect(Reflect.get(globalThis as Record<symbol, unknown>, DEK_STORE_SYMBOL)).toBeUndefined();
    expect(await loadSession(Date.now())).not.toBeNull();
  });

  it("keeps the active session open and reports failure if no safe lock can persist", async () => {
    vi.useFakeTimers();
    const { getApi } = await renderAuth(10_000);
    await getApi().login({
      user: { userId: "u-storage-lock", username: "grace" },
      itemsKey: makeItemsKey(),
      persistence: "session",
    });
    await vi.waitFor(() => expect(getApi().state).toBe("unlocked"));
    testState.failSessionClear = true;

    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === "privance.locked") throw new DOMException("quota exceeded", "QuotaExceededError");
      return originalSetItem.call(localStorage, key, value);
    });
    const originalRemoveItem = localStorage.removeItem;
    const removeItem = vi.spyOn(localStorage, "removeItem").mockImplementation((key) => {
      if (key === USERNAME_KEY) throw new DOMException("storage unavailable", "SecurityError");
      return originalRemoveItem.call(localStorage, key);
    });
    expect(localStorage.getItem(USERNAME_KEY)).toBe("grace");
    const key = readItemsKey();

    await getApi().lock();

    expect(removeItem).toHaveBeenCalledWith(USERNAME_KEY);
    await vi.waitFor(() => {
      expect(getApi().state).toBe("unlocked");
      expect(getApi().lockFailed).toBe(true);
    });
    expect(readItemsKey()).toBe(key);
    expect(localStorage.getItem(USERNAME_KEY)).toBe("grace");

    vi.restoreAllMocks();
    testState.failSessionClear = false;
    testState.stallSessionClear = true;
    await vi.advanceTimersByTimeAsync(10_000);

    await vi.waitFor(() => expect(getApi().state).toBe("locked"));
    expect(Reflect.get(globalThis as Record<symbol, unknown>, DEK_STORE_SYMBOL)).toBeUndefined();
    vi.clearAllTimers();
  });

  it("does not let a pending login undo a later lock", async () => {
    testState.deferSessionPersist = true;
    const { getApi } = await renderAuth();
    const loginPromise = getApi().login({
      user: { userId: "u-racing-login", username: "iris" },
      itemsKey: makeItemsKey(),
      persistence: "session",
    });
    testState.failSessionClear = true;

    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === "privance.locked") throw new DOMException("quota exceeded", "QuotaExceededError");
      return originalSetItem.call(localStorage, key, value);
    });

    await getApi().lock();
    expect(getApi().state).toBe("unauthenticated");
    testState.resolveSessionPersist?.(true);
    await loginPromise;

    expect(getApi().state).toBe("unauthenticated");
    expect(Reflect.get(globalThis as Record<symbol, unknown>, DEK_STORE_SYMBOL)).toBeUndefined();
  });

  it("does not retain a DEK when another tab supersedes an unlock", async () => {
    testState.deferSessionPersist = true;
    const { getApi } = await renderAuth();
    const unlockPromise = getApi().unlock({
      user: { userId: "u-racing-unlock", username: "jules" },
      itemsKey: makeItemsKey(),
      persistence: "session",
    });

    localStorage.setItem("privance.locked", "auth:other-tab");
    testState.resolveSessionPersist?.(true);
    await unlockPromise;

    expect(getApi().state).not.toBe("unlocked");
    expect(readItemsKey()).toBeNull();
  });

  it("signs sibling tabs out through BroadcastChannel when storage and vault clearing fail", async () => {
    let first!: ReturnType<typeof useAuth>;
    let second!: ReturnType<typeof useAuth>;
    const screen = await render(
      <>
        <AuthProvider>
          <AuthHarness onReady={(api) => (first = api)} />
        </AuthProvider>
        <AuthProvider>
          <AuthHarness onReady={(api) => (second = api)} />
        </AuthProvider>
      </>,
    );
    cleanupRender = () => screen.unmount();
    const payload = {
      user: { userId: "u-cross-tab", username: "jules" },
      itemsKey: makeItemsKey(),
      persistence: "session" as const,
    };
    await first.login(payload);
    await second.unlock(payload);
    await vi.waitFor(() => {
      expect(first.state).toBe("unlocked");
      expect(second.state).toBe("unlocked");
    });
    testState.failSessionClear = true;

    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === "privance.locked") throw new DOMException("quota exceeded", "QuotaExceededError");
      return originalSetItem.call(localStorage, key, value);
    });

    await first.lock();
    await vi.waitFor(() => expect(second.state).toBe("unauthenticated"));

    expect(first.state).toBe("unauthenticated");
    expect(second.state).toBe("unauthenticated");
  });

  it("retains the boot lock marker when the replacement session cannot be persisted", async () => {
    testState.failSessionPersist = true;
    const { getApi } = await renderAuth();

    await getApi().login({
      user: { userId: "u-no-persist", username: "harper" },
      itemsKey: makeItemsKey(),
      persistence: "session",
    });

    await vi.waitFor(() => expect(getApi().state).toBe("unlocked"));
    expect(localStorage.getItem("privance.locked")).not.toBeNull();
  });
});
