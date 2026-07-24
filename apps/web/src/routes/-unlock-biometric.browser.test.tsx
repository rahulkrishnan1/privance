/**
 * Browser tests for the biometric action on the unlock screen.
 *
 * The WebAuthn ceremony module is mocked throughout; the biometric-store and
 * core crypto run against real IndexedDB so unwrap assertions are meaningful.
 */

import type { ItemsKey } from "@privance/core";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const ceremony = vi.hoisted(() => ({
  isBiometricSupported: vi.fn(),
  assertPrf: vi.fn(),
}));

// The route is rendered in isolation (no RouterProvider), so mock the router
// surface it touches: createFileRoute (module load), useNavigate (success
// navigation is observable), and Link (AuthBackdrop renders one).
const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async () => {
  const { LinkStub, createFileRouteStub } = await import("@/__mocks__/router-stubs");
  return { createFileRoute: createFileRouteStub, useNavigate: () => navigateSpy, Link: LinkStub };
});

// Mock the ceremony module; core crypto and biometric-store use the real impls.
vi.mock("@/lib/crypto/webauthn-prf", () => ({
  isBiometricSupported: ceremony.isBiometricSupported,
  assertPrf: ceremony.assertPrf,
  BiometricCancelledError: class BiometricCancelledError extends Error {
    constructor() {
      super("Biometric prompt cancelled");
      this.name = "BiometricCancelledError";
    }
  },
  BiometricUnsupportedError: class BiometricUnsupportedError extends Error {
    constructor(message = "Biometric unlock not supported on this device") {
      super(message);
      this.name = "BiometricUnsupportedError";
    }
  },
  BiometricFailureError: class BiometricFailureError extends Error {
    constructor(message = "PRF assertion returned no output") {
      super(message);
      this.name = "BiometricFailureError";
    }
  },
}));

// Spy on loadEnrollment to support the state-gate test.
const loadEnrollmentSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/storage/biometric-store", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/storage/biometric-store")>();
  return {
    ...actual,
    loadEnrollment: (...args: Parameters<typeof actual.loadEnrollment>) => {
      loadEnrollmentSpy(...args);
      return actual.loadEnrollment(...args);
    },
  };
});

// Mock auth API so no real network calls happen.
vi.mock("@/lib/api/auth", () => ({
  session: vi.fn(() => Promise.resolve({ user_id: "u1", expires_at: "2099-01-01T00:00:00Z" })),
  kdfParams: vi.fn(() => Promise.resolve(null)),
  logout: vi.fn(() => Promise.resolve({ status: "ok" })),
  login: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/lib/crypto/kdf", () => ({ warmKdfWorker: vi.fn() }));
vi.mock("@/lib/auth-crypto", () => ({ deriveLoginCrypto: vi.fn(), unwrapDek: vi.fn() }));
vi.mock("@/lib/storage/per-user-store", () => ({
  destroyUserStore: vi.fn(() => Promise.resolve()),
}));

import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { loadEnrollment, purgeEnrollment } from "@/lib/storage/biometric-store";
import {
  BIOMETRIC_DB,
  BIOMETRIC_OBJECT_STORE,
  BIOMETRIC_RECORD_KEY,
  readRawBiometricIdb,
  seedEnrollment,
} from "@/lib/storage/biometric-store.test-helpers";
import { clearSession } from "@/lib/storage/session-vault";
import { AuthProvider, USER_ID_KEY, USERNAME_KEY } from "@/providers/auth-context";
import { Route as unlockRoute } from "./unlock";

const UnlockPage = unlockRoute.options.component as () => ReactNode;

// Symbol for the DEK store; must be cleared between tests so AuthProvider does
// not boot into "unlocked" when a previous test's unlock() call seeded it.
const DEK_STORE_SYMBOL = Symbol.for("privance.dekStore.v1");
type GlobalWithDek = typeof globalThis & Record<symbol, unknown>;
function clearDekStore() {
  Reflect.deleteProperty(globalThis as GlobalWithDek, DEK_STORE_SYMBOL);
}

function makeItemsKey(): ItemsKey {
  return crypto.getRandomValues(new Uint8Array(32)) as unknown as ItemsKey;
}

// Seeding localStorage causes the provider to start in "loading" then settle to "locked" (no vault entry).
async function renderUnlockPage(opts: { userId: string; username: string }) {
  localStorage.setItem(USERNAME_KEY, opts.username);
  localStorage.setItem(USER_ID_KEY, opts.userId);
  const screen = await render(
    <AuthProvider>
      <UnlockPage />
    </AuthProvider>,
  );
  return screen;
}

beforeEach(async () => {
  loadEnrollmentSpy.mockClear();
  ceremony.isBiometricSupported.mockClear();
  ceremony.assertPrf.mockClear();
  navigateSpy.mockClear();
  clearDekStore();
  await purgeEnrollment();
  await clearSession();
  localStorage.clear();
});

afterEach(async () => {
  clearDekStore();
  await purgeEnrollment();
  await clearSession();
  localStorage.clear();
});

/** Wait until the state-gate effect has settled: isBiometricSupported was called. */
async function waitForEnrollmentCheck() {
  await vi.waitFor(() => expect(ceremony.isBiometricSupported).toHaveBeenCalled(), {
    timeout: 5000,
  });
  // Brief yield so the loadEnrollment promise and setState calls complete.
  await new Promise((r) => setTimeout(r, 100));
}

describe("biometric action visibility", () => {
  it("renders the biometric action button when enrolled and supported", async () => {
    const userId = "u-visible";
    const username = "alice";
    const itemsKey = makeItemsKey();

    ceremony.isBiometricSupported.mockResolvedValue(true);
    await seedEnrollment({ userId, username, itemsKey });

    const screen = await renderUnlockPage({ userId, username });

    await expect
      .element(screen.getByRole("button", { name: "Unlock with biometrics" }))
      .toBeVisible();
    // Biometric-first layout: the password form stays behind the reveal link.
    await expect
      .element(screen.getByRole("button", { name: "Use master password instead" }))
      .toBeVisible();
    expect(
      screen.baseElement.querySelector('input[type="password"]'),
      "password form must stay collapsed while the enrollment is usable",
    ).toBeNull();
  });

  it("reveals the password form on 'Use master password instead'", async () => {
    const userId = "u-reveal";
    const username = "rita";
    const itemsKey = makeItemsKey();

    ceremony.isBiometricSupported.mockResolvedValue(true);
    await seedEnrollment({ userId, username, itemsKey });

    const screen = await renderUnlockPage({ userId, username });
    await screen.getByRole("button", { name: "Use master password instead" }).click();

    await expect.element(screen.getByRole("button", { name: "Unlock", exact: true })).toBeVisible();
    // The biometric action stays available alongside the revealed form.
    await expect
      .element(screen.getByRole("button", { name: "Unlock with biometrics" }))
      .toBeVisible();
    // The record is untouched by revealing the form.
    const raw = await readRawBiometricIdb();
    expect(raw).not.toBeUndefined();
  });

  it("renders password-only when isBiometricSupported returns false", async () => {
    const userId = "u-unsupported";
    const username = "bob";
    const itemsKey = makeItemsKey();

    ceremony.isBiometricSupported.mockResolvedValue(false);
    await seedEnrollment({ userId, username, itemsKey });

    const screen = await renderUnlockPage({ userId, username });
    await waitForEnrollmentCheck();

    await expect
      .element(screen.getByRole("button", { name: "Unlock with biometrics" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Unlock", exact: true })).toBeVisible();
  });

  it("renders password-only when unenrolled (no IDB record)", async () => {
    const userId = "u-unenrolled";
    const username = "carol";

    ceremony.isBiometricSupported.mockResolvedValue(true);

    const screen = await renderUnlockPage({ userId, username });
    await waitForEnrollmentCheck();

    await expect
      .element(screen.getByRole("button", { name: "Unlock with biometrics" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Unlock", exact: true })).toBeVisible();
  });

  it("renders password-only when the cadence is stale (15 days ago, covers AE3 shape)", async () => {
    const userId = "u-stale";
    const username = "dave";
    const itemsKey = makeItemsKey();

    ceremony.isBiometricSupported.mockResolvedValue(true);
    const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
    await seedEnrollment({ userId, username, itemsKey, lastPasswordUnlockAt: fifteenDaysAgo });

    const screen = await renderUnlockPage({ userId, username });
    await waitForEnrollmentCheck();

    // loadEnrollment returns null for stale records -> no button
    await expect
      .element(screen.getByRole("button", { name: "Unlock with biometrics" }))
      .not.toBeInTheDocument();

    // The at-rest items-key copy must be destroyed; bookkeeping survives for
    // the password-unlock re-arm (R9).
    await vi.waitFor(async () => {
      const raw = (await readRawBiometricIdb()) as Record<string, unknown>;
      expect(raw).toBeTruthy();
      expect(raw.wrappedItemsKey).toBeNull();
    });
  });
});

describe("successful biometric unlock path", () => {
  it("navigates to /app and does not purge the record after success", async () => {
    const userId = "u-success";
    const username = "eve";
    const itemsKey = makeItemsKey();

    ceremony.isBiometricSupported.mockResolvedValue(true);
    const { prfOutput } = await seedEnrollment({ userId, username, itemsKey });
    ceremony.assertPrf.mockResolvedValue(new Uint8Array(prfOutput));

    const screen = await renderUnlockPage({ userId, username });

    await expect
      .element(screen.getByRole("button", { name: "Unlock with biometrics" }))
      .toBeVisible();

    await screen.getByRole("button", { name: "Unlock with biometrics" }).click();

    // After success the page navigates to /app, replacing history.
    await vi.waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/app", replace: true });
    });

    // The success path does not purge the record (biometric re-arm is skipped;
    // the record stays intact for subsequent locks).
    const raw = await readRawBiometricIdb();
    expect(raw).not.toBeUndefined();
  });

  // The deriveBiometricKek -> openProtectorKey -> unwrapItemsKeyRsa byte-equality
  // round-trip is covered as a dedicated crypto test in
  // lib/storage/biometric-store.browser.test.ts ("full crypto round trip"); it is
  // not re-run here so this page spec stays about unlock-page behavior.
});

describe("cancel path (BiometricCancelledError, covers AE4)", () => {
  it("shows the soft-fail bar, hides the biometric primary, keeps enrollment after cancel", async () => {
    const userId = "u-cancel";
    const username = "grace";
    const itemsKey = makeItemsKey();

    ceremony.isBiometricSupported.mockResolvedValue(true);
    await seedEnrollment({ userId, username, itemsKey });

    const { BiometricCancelledError } = await import("@/lib/crypto/webauthn-prf");
    ceremony.assertPrf.mockRejectedValue(new BiometricCancelledError());

    const screen = await renderUnlockPage({ userId, username });

    const biometricBtn = screen.getByRole("button", { name: "Unlock with biometrics" });
    await expect.element(biometricBtn).toBeVisible();

    await biometricBtn.click();

    // Soft fail: the err-bio bar appears, the biometric primary is hidden, and
    // the password path stays reachable via the highlighted alt button.
    await vi.waitFor(() => {
      const alert = screen.baseElement.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("Biometric unlock didn");
    });
    await vi.waitFor(() => {
      const btns = [...screen.baseElement.querySelectorAll("button")];
      const biometricBtnGone = btns.find((b) => b.textContent?.trim() === "Unlock with biometrics");
      expect(biometricBtnGone).toBeUndefined();
    });
    await expect
      .element(screen.getByRole("button", { name: "Use master password instead" }))
      .toBeVisible();

    // Enrollment must still be in IDB (soft fail does not purge).
    const raw = await readRawBiometricIdb();
    expect(raw).not.toBeUndefined();
  });
});

describe("no-PRF failure path (BiometricFailureError)", () => {
  it("soft-fails and keeps the enrollment when the ceremony returns no PRF output", async () => {
    // A completed ceremony with no PRF output is recoverable (e.g. UV not
    // satisfied), so it must NOT purge the enrollment; only genuine integrity
    // failures (R17, below) do.
    const userId = "u-noprf";
    const username = "judy";
    const itemsKey = makeItemsKey();

    ceremony.isBiometricSupported.mockResolvedValue(true);
    await seedEnrollment({ userId, username, itemsKey });

    const { BiometricFailureError } = await import("@/lib/crypto/webauthn-prf");
    ceremony.assertPrf.mockRejectedValue(new BiometricFailureError());

    const screen = await renderUnlockPage({ userId, username });

    const biometricBtn = screen.getByRole("button", { name: "Unlock with biometrics" });
    await expect.element(biometricBtn).toBeVisible();
    await biometricBtn.click();

    // Soft-fail bar appears (not the purge/re-enroll banner).
    await vi.waitFor(() => {
      const alert = screen.baseElement.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("Biometric unlock didn");
    });
    await expect
      .element(screen.getByRole("button", { name: "Use master password instead" }))
      .toBeVisible();

    // Enrollment record survives a recoverable no-PRF result.
    const raw = await readRawBiometricIdb();
    expect(raw).not.toBeUndefined();
  });
});

describe("unwrap failure path (R17)", () => {
  it("purges IDB record and shows re-enroll banner when wrappedItemsKey is tampered", async () => {
    const userId = "u-tamper";
    const username = "henry";
    const itemsKey = makeItemsKey();

    ceremony.isBiometricSupported.mockResolvedValue(true);
    const { prfOutput } = await seedEnrollment({ userId, username, itemsKey });

    // Overwrite the record's wrappedItemsKey with random bytes so RSA decrypt fails.
    const raw = (await readRawBiometricIdb()) as Record<string, unknown>;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(BIOMETRIC_DB, 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(BIOMETRIC_OBJECT_STORE, "readwrite");
        tx.objectStore(BIOMETRIC_OBJECT_STORE).put(
          { ...raw, wrappedItemsKey: crypto.getRandomValues(new Uint8Array(256)) },
          BIOMETRIC_RECORD_KEY,
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => req.result.createObjectStore(BIOMETRIC_OBJECT_STORE);
    });

    ceremony.assertPrf.mockResolvedValue(new Uint8Array(prfOutput));

    const screen = await renderUnlockPage({ userId, username });

    await expect
      .element(screen.getByRole("button", { name: "Unlock with biometrics" }))
      .toBeVisible();

    await screen.getByRole("button", { name: "Unlock with biometrics" }).click();

    // Error banner must appear
    await vi.waitFor(() => {
      expect(screen.baseElement.querySelector('[role="alert"]')).not.toBeNull();
    });

    // Biometric button must be gone (record purged, biometricRecord set to null)
    await vi.waitFor(() => {
      const btns = [...screen.baseElement.querySelectorAll("button")];
      const biometricBtn = btns.find((b) => b.textContent?.trim() === "Unlock with biometrics");
      expect(biometricBtn).toBeUndefined();
    });

    // Password form still present
    await expect.element(screen.getByRole("button", { name: "Unlock", exact: true })).toBeVisible();

    // Banner text directs to re-enroll
    const alert = screen.baseElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Biometric unlock failed.");
    expect(alert?.textContent).toContain("enable biometrics in Settings");

    // IDB record must be gone
    const afterPurge = await readRawBiometricIdb();
    expect(afterPurge).toBeUndefined();
  });

  it("purges IDB record and shows re-enroll banner when sealedPrivateKey is tampered", async () => {
    const userId = "u-tamper-sealed";
    const username = "iris";
    const itemsKey = makeItemsKey();

    ceremony.isBiometricSupported.mockResolvedValue(true);
    const { prfOutput } = await seedEnrollment({ userId, username, itemsKey });

    // Corrupt the AEAD-sealed protector key so openProtectorKey throws DecryptionError.
    const raw = (await readRawBiometricIdb()) as Record<string, unknown>;
    const sealed = raw.sealedPrivateKey as { ciphertext: Uint8Array; nonce: Uint8Array };
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(BIOMETRIC_DB, 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(BIOMETRIC_OBJECT_STORE, "readwrite");
        tx.objectStore(BIOMETRIC_OBJECT_STORE).put(
          {
            ...raw,
            sealedPrivateKey: {
              ...sealed,
              ciphertext: crypto.getRandomValues(new Uint8Array(sealed.ciphertext.length)),
            },
          },
          BIOMETRIC_RECORD_KEY,
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => req.result.createObjectStore(BIOMETRIC_OBJECT_STORE);
    });

    ceremony.assertPrf.mockResolvedValue(new Uint8Array(prfOutput));

    const screen = await renderUnlockPage({ userId, username });
    await screen.getByRole("button", { name: "Unlock with biometrics" }).click();

    await vi.waitFor(() => {
      expect(screen.baseElement.querySelector('[role="alert"]')).not.toBeNull();
    });
    const afterPurge = await readRawBiometricIdb();
    expect(afterPurge).toBeUndefined();
  });
});

describe("auth state gate", () => {
  it("loadEnrollment is not called while auth state is 'loading', only after 'locked'", async () => {
    const userId = "u-gate";
    const username = "iris";
    const itemsKey = makeItemsKey();

    ceremony.isBiometricSupported.mockResolvedValue(true);
    await seedEnrollment({ userId, username, itemsKey });

    loadEnrollmentSpy.mockClear();

    // Render: provider starts in "loading" (USERNAME_KEY is set, no vault entry),
    // then transitions to "locked" once the rehydrate effect resolves.
    // Our useEffect gates on state === "locked", so loadEnrollment must not fire
    // until the transition completes.
    const screen = await renderUnlockPage({ userId, username });

    // Wait for the biometric button to appear (confirms state settled to "locked"
    // and the enrollment was loaded).
    await vi.waitFor(
      () =>
        expect
          .element(screen.getByRole("button", { name: "Unlock with biometrics" }))
          .toBeVisible(),
      { timeout: 10000 },
    );

    // loadEnrollment must have been called exactly once, with the correct userId.
    expect(loadEnrollmentSpy).toHaveBeenCalledTimes(1);
    const [[firstArg]] = loadEnrollmentSpy.mock.calls as [[{ userId: string; now: number }]];
    expect(firstArg.userId).toBe(userId);
  });
});

describe("session expiry preserves biometric enrollment", () => {
  it("a 401 from session() shows the expired scene but does not purge the enrollment", async () => {
    const userId = "u-expiry";
    const username = "expiry-user";
    const itemsKey = makeItemsKey();
    await seedEnrollment({ userId, username, itemsKey });

    // The background session probe finds the server session gone.
    vi.mocked(authApi.session).mockRejectedValueOnce(
      new ApiError(401, "session_expired", "expired"),
    );

    const screen = await renderUnlockPage({ userId, username });

    // The re-sealed (session-expired) scene appears.
    await expect.element(screen.getByRole("heading", { name: /sealed itself/i })).toBeVisible();

    // But local biometric custody survives a routine server-session expiry: the
    // record is still loadable, so the user keeps biometric unlock after re-auth.
    const record = await loadEnrollment({ now: Date.now(), userId });
    expect(record).not.toBeNull();
  });
});
