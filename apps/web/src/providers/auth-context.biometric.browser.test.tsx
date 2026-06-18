/**
 * Browser tests for biometric lifetime semantics wired into AuthProvider.
 * Drives the provider through its public API (login/unlock/lock/logout) and
 * asserts against raw IDB state to confirm re-arm and purge behavior.
 */

import type { ItemsKey } from "@privance/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

// vi.mock is hoisted so the factory runs before any import. We wrap the real
// module so all public functions pass through by default; individual tests can
// then spy on specific exports without touching the others.
const biometricStore = vi.hoisted(() => ({
  purgeEnrollmentSpy: vi.fn(),
  reArmSpy: vi.fn(),
}));

vi.mock("@/lib/storage/biometric-store", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/storage/biometric-store")>();
  return {
    ...actual,
    // Wrap purgeEnrollment and reArm with spies that call through to the real
    // implementation so IDB state stays accurate for most tests.
    purgeEnrollment: (...args: Parameters<typeof actual.purgeEnrollment>) => {
      biometricStore.purgeEnrollmentSpy(...args);
      return actual.purgeEnrollment(...args);
    },
    reArm: (...args: Parameters<typeof actual.reArm>) => {
      biometricStore.reArmSpy(...args);
      return actual.reArm(...args);
    },
  };
});

import { loadEnrollment, purgeEnrollment } from "@/lib/storage/biometric-store";
import { readRawBiometricIdb, seedEnrollment } from "@/lib/storage/biometric-store.test-helpers";
import { clearSession } from "@/lib/storage/session-vault";
import { AuthProvider, USERNAME_KEY, useAuth } from "./auth-context";

function makeItemsKey(): ItemsKey {
  return crypto.getRandomValues(new Uint8Array(32)) as unknown as ItemsKey;
}

/** A minimal test harness that exposes the AuthContext API via callbacks. */
function AuthHarness({ onReady }: { onReady: (api: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  onReady(auth);
  return null;
}

/** Render AuthProvider and return a ref-like object holding the current auth API. */
async function renderAuth() {
  let api!: ReturnType<typeof useAuth>;
  await render(
    <AuthProvider>
      <AuthHarness
        onReady={(a) => {
          api = a;
        }}
      />
    </AuthProvider>,
  );
  return { getApi: () => api };
}

beforeEach(async () => {
  biometricStore.purgeEnrollmentSpy.mockClear();
  biometricStore.reArmSpy.mockClear();
  await purgeEnrollment();
  await clearSession();
  localStorage.clear();
});

afterEach(async () => {
  await purgeEnrollment();
  await clearSession();
  localStorage.clear();
});

describe("login() re-arms the biometric record", () => {
  it("updates the wrapped blob bytes and lastPasswordUnlockAt when a record is enrolled", async () => {
    const userId = "user-login-rearm";
    const username = "alice";
    const itemsKey = makeItemsKey();

    const { recordUuid } = await seedEnrollment({ userId, username, itemsKey });

    // Read the original wrapped bytes before login
    const before = (await readRawBiometricIdb()) as Record<string, unknown>;
    const originalWrapped = Array.from(before.wrappedItemsKey as Uint8Array);
    const originalTs = before.lastPasswordUnlockAt as number;

    const { getApi } = await renderAuth();
    const t0 = Date.now();
    await getApi().login({ user: { userId, username }, itemsKey, persistence: "session" });

    const loaded = await loadEnrollment({ now: Date.now(), userId });
    if (!loaded) throw new Error("expected a loaded record after login re-arm");
    // RSA-OAEP is randomised: fresh wrap yields different ciphertext bytes
    expect(Array.from(loaded.wrappedItemsKey)).not.toEqual(originalWrapped);
    // Timestamp advanced to at least t0
    expect(loaded.lastPasswordUnlockAt).toBeGreaterThanOrEqual(t0);
    expect(loaded.lastPasswordUnlockAt).toBeGreaterThan(originalTs);
    // recordUuid must be unchanged (same enrollment, not re-enrolled)
    expect(loaded.recordUuid).toBe(recordUuid);
  });

  it("completes login even when the biometric store faults (fault-tolerant)", async () => {
    const userId = "user-rearm-fault";
    const username = "bob";
    const itemsKey = makeItemsKey();

    // Seed a record so reArm would normally run
    await seedEnrollment({ userId, username, itemsKey });

    // reArm is an async function that wraps its entire body in try/catch, so it
    // never rejects. We verify the fault-tolerance by making the IDB open fail
    // during the reArm call (the first IDB operation login triggers after
    // persistSession). reArm catches the error internally and returns void.
    // login() must complete without rethrowing.
    const openSpy = vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
      const fakeReq = {
        result: undefined,
        error: new DOMException("quota exceeded", "QuotaExceededError"),
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        readyState: "pending" as IDBRequestReadyState,
        source: null,
        transaction: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as unknown as IDBOpenDBRequest;
      setTimeout(() => {
        if (fakeReq.onerror) fakeReq.onerror(new Event("error"));
      }, 0);
      return fakeReq;
    });

    const { getApi } = await renderAuth();
    await expect(
      getApi().login({ user: { userId, username }, itemsKey, persistence: "session" }),
    ).resolves.toBeUndefined();

    expect(getApi().state).toBe("unlocked");
    openSpy.mockRestore();
  });
});

describe("unlock() re-arms unless persistence is biometric", () => {
  it("re-arms when persistence is 'memory'", async () => {
    const userId = "user-unlock-memory";
    const username = "charlie";
    const itemsKey = makeItemsKey();
    await seedEnrollment({ userId, username, itemsKey });

    const before = (await readRawBiometricIdb()) as Record<string, unknown>;
    const originalWrapped = Array.from(before.wrappedItemsKey as Uint8Array);

    const { getApi } = await renderAuth();
    const t0 = Date.now();
    await getApi().unlock({ user: { userId, username }, itemsKey, persistence: "memory" });

    const loaded = await loadEnrollment({ now: Date.now(), userId });
    if (!loaded) throw new Error("expected a loaded record after unlock re-arm");
    expect(Array.from(loaded.wrappedItemsKey)).not.toEqual(originalWrapped);
    expect(loaded.lastPasswordUnlockAt).toBeGreaterThanOrEqual(t0);
  });

  it("does NOT re-arm when persistence is 'biometric'", async () => {
    const userId = "user-unlock-biometric";
    const username = "diana";
    const itemsKey = makeItemsKey();
    await seedEnrollment({ userId, username, itemsKey });

    const before = (await readRawBiometricIdb()) as Record<string, unknown>;
    const originalWrapped = Array.from(before.wrappedItemsKey as Uint8Array);
    const originalTs = before.lastPasswordUnlockAt as number;

    biometricStore.reArmSpy.mockClear();

    const { getApi } = await renderAuth();
    await getApi().unlock({ user: { userId, username }, itemsKey, persistence: "biometric" });

    // The reArm spy must not have been called via this unlock path
    expect(biometricStore.reArmSpy).not.toHaveBeenCalled();

    // Raw IDB read to confirm no wrapped bytes changed
    const raw = (await readRawBiometricIdb()) as Record<string, unknown>;
    expect(Array.from(raw.wrappedItemsKey as Uint8Array)).toEqual(originalWrapped);
    expect(raw.lastPasswordUnlockAt).toBe(originalTs);
  });
});

describe("logout() purge ordering", () => {
  it("biometric record is absent after logout completes", async () => {
    const userId = "user-logout-purge";
    const username = "eve";
    const itemsKey = makeItemsKey();
    await seedEnrollment({ userId, username, itemsKey });

    localStorage.setItem(USERNAME_KEY, username);
    localStorage.setItem("privance.userId", userId);

    const { getApi } = await renderAuth();
    await getApi().logout();

    const raw = await readRawBiometricIdb();
    expect(raw).toBeUndefined();
  });

  it("purgeEnrollment is called before USERNAME_KEY is removed from localStorage", async () => {
    const userId = "user-logout-order";
    const username = "frank";
    const itemsKey = makeItemsKey();
    await seedEnrollment({ userId, username, itemsKey });

    localStorage.setItem(USERNAME_KEY, username);
    localStorage.setItem("privance.userId", userId);

    const { getApi } = await renderAuth();

    // Track the order: capture whether USERNAME_KEY still exists when purge runs.
    // purgeEnrollmentSpy is called before finishLogout() removes USERNAME_KEY,
    // so privance.username must still be present at the time the spy fires.
    let usernameKeyPresentAtPurge: boolean | null = null;
    biometricStore.purgeEnrollmentSpy.mockImplementationOnce(() => {
      usernameKeyPresentAtPurge = localStorage.getItem(USERNAME_KEY) !== null;
    });

    await getApi().logout();

    // Ordering assertion: purge fired before USERNAME_KEY removal
    expect(usernameKeyPresentAtPurge).toBe(true);
    // After logout: key gone
    expect(localStorage.getItem(USERNAME_KEY)).toBeNull();
  });
});

// lock() cannot run here: it calls window.location.reload(), which navigates
// the vitest iframe. The lock-keeps-enrollment invariant is covered by the E2E suite.
describe("login leaves an existing enrollment intact", () => {
  it("purgeEnrollment is never called on the way to the unlocked state", async () => {
    const userId = "user-lock-survive";
    const username = "grace";
    const itemsKey = makeItemsKey();
    await seedEnrollment({ userId, username, itemsKey });

    localStorage.setItem(USERNAME_KEY, username);
    localStorage.setItem("privance.userId", userId);

    biometricStore.purgeEnrollmentSpy.mockClear();

    const { getApi } = await renderAuth();
    await getApi().login({ user: { userId, username }, itemsKey, persistence: "session" });
    await vi.waitFor(() => expect(getApi().state).toBe("unlocked"));

    // purgeEnrollment must not have been called by login (only reArm fires)
    expect(biometricStore.purgeEnrollmentSpy).not.toHaveBeenCalled();

    // Biometric record must still be intact in IDB
    const raw = await readRawBiometricIdb();
    expect(raw).not.toBeUndefined();
  });
});
