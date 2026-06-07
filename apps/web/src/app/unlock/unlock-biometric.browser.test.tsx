/**
 * Browser tests for the biometric action on the unlock screen.
 *
 * The WebAuthn ceremony module is mocked throughout; the biometric-store and
 * core crypto run against real IndexedDB so unwrap assertions are meaningful.
 */

import { deriveBiometricKek, type ItemsKey } from "@privance/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

// ---------------------------------------------------------------------------
// Hoist spy handles before any import so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const ceremony = vi.hoisted(() => ({
  isBiometricSupported: vi.fn(),
  assertPrf: vi.fn(),
}));

// Mock next/navigation so useRouter is available outside a Next.js app shell.
const mockReplace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/unlock",
  useSearchParams: () => new URLSearchParams(),
}));

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

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { loadEnrollment, purgeEnrollment } from "@/lib/storage/biometric-store";
import {
  BIOMETRIC_DB,
  BIOMETRIC_OBJECT_STORE,
  BIOMETRIC_RECORD_KEY,
  readRawBiometricIdb,
  seedEnrollment,
} from "@/lib/storage/biometric-store.test-helpers";
import { clearSession } from "@/lib/storage/session-vault";
import { AuthProvider, USER_ID_KEY } from "@/providers/auth-context";
import UnlockPage from "./page";

// Symbol for the DEK store; must be cleared between tests so AuthProvider does
// not boot into "unlocked" when a previous test's unlock() call seeded it.
const DEK_STORE_SYMBOL = Symbol.for("privance.dekStore.v1");
type GlobalWithDek = typeof globalThis & Record<symbol, unknown>;
function clearDekStore() {
  Reflect.deleteProperty(globalThis as GlobalWithDek, DEK_STORE_SYMBOL);
}

// ---------------------------------------------------------------------------
// IDB helpers
// ---------------------------------------------------------------------------

function makeItemsKey(): ItemsKey {
  return crypto.getRandomValues(new Uint8Array(32)) as unknown as ItemsKey;
}

// ---------------------------------------------------------------------------
// Render helper: wraps UnlockPage in AuthProvider. Seeding localStorage causes
// the provider to start in "loading" then settle to "locked" (no vault entry).
// ---------------------------------------------------------------------------

async function renderUnlockPage(opts: { userId: string; username: string }) {
  localStorage.setItem("privance.username", opts.username);
  localStorage.setItem(USER_ID_KEY, opts.userId);
  const screen = await render(
    <AuthProvider>
      <UnlockPage />
    </AuthProvider>,
  );
  return screen;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  loadEnrollmentSpy.mockClear();
  ceremony.isBiometricSupported.mockClear();
  ceremony.assertPrf.mockClear();
  mockReplace.mockClear();
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

// ---------------------------------------------------------------------------
// Helpers for tests
// ---------------------------------------------------------------------------

/** Wait until the state-gate effect has settled: isBiometricSupported was called. */
async function waitForEnrollmentCheck() {
  await vi.waitFor(() => expect(ceremony.isBiometricSupported).toHaveBeenCalled(), {
    timeout: 5000,
  });
  // Brief yield so the loadEnrollment promise and setState calls complete.
  await new Promise((r) => setTimeout(r, 100));
}

// ---------------------------------------------------------------------------
// Tests: biometric action visibility
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests: successful biometric unlock path
// ---------------------------------------------------------------------------

describe("successful biometric unlock path", () => {
  it("router.replace('/app/') is called and record is not purged after success", async () => {
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

    // After success the page calls router.replace('/app/')
    await vi.waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/app/");
    });

    // The success path does not purge the record (biometric re-arm is skipped;
    // the record stays intact for subsequent locks).
    const raw = await readRawBiometricIdb();
    expect(raw).not.toBeUndefined();
  });

  it("the unwrapped items key bytes equal the originally seeded key", async () => {
    // This test runs the full crypto pipeline outside the page to verify
    // deriveBiometricKek -> openProtectorKey -> unwrapItemsKeyRsa correctness.
    const userId = "u-key-bytes";
    const username = "frank";
    const itemsKey = makeItemsKey();
    const originalBytes = Array.from(itemsKey as Uint8Array);

    await seedEnrollment({ userId, username, itemsKey });

    const { openProtectorKey } = await import("@privance/core");
    const { unwrapItemsKeyRsa } = await import("@/lib/storage/biometric-store");

    const record = await loadEnrollment({ now: Date.now(), userId });
    if (!record) throw new Error("expected a loaded record");

    // Re-derive using the stored salt (same value as the PRF eval input).
    // We can't re-derive without the real PRF output; instead use what seedEnrollment
    // used. Seed returns prfOutput -- but we already called seedEnrollment above.
    // Re-seed fresh so we have the prfOutput in scope.
    await purgeEnrollment();
    const { prfOutput: seededPrf } = await seedEnrollment({ userId, username, itemsKey });

    const record2 = await loadEnrollment({ now: Date.now(), userId });
    if (!record2) throw new Error("expected second record");

    const kek = deriveBiometricKek({ prfOutput: new Uint8Array(seededPrf), salt: record2.salt });
    const pkcs8 = openProtectorKey({
      sealed: record2.sealedPrivateKey,
      kek,
      pubKeyBytes: record2.publicKeyBytes,
      recordUuid: record2.recordUuid,
    });
    const recovered = await unwrapItemsKeyRsa({
      wrappedItemsKey: record2.wrappedItemsKey,
      pkcs8,
      expectedRecordUuid: record2.recordUuid,
    });
    pkcs8.fill(0);

    expect(Array.from(recovered)).toEqual(originalBytes);
  });
});

// ---------------------------------------------------------------------------
// Tests: cancel path (BiometricCancelledError, covers AE4)
// ---------------------------------------------------------------------------

describe("cancel path (BiometricCancelledError, covers AE4)", () => {
  it("screen stays usable and enrollment stays in IDB after user cancels", async () => {
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

    // After cancel: biometric button returns to idle, no error banner, and the
    // password path stays one tap away behind the reveal link.
    await vi.waitFor(() =>
      expect.element(screen.getByRole("button", { name: "Unlock with biometrics" })).toBeVisible(),
    );
    await expect
      .element(screen.getByRole("button", { name: "Use master password instead" }))
      .toBeVisible();
    expect(screen.baseElement.querySelector('[role="alert"]')).toBeNull();

    // Enrollment must still be in IDB
    const raw = await readRawBiometricIdb();
    expect(raw).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: unwrap failure path (R17)
// ---------------------------------------------------------------------------

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
    expect(alert?.textContent).toContain("re-enable biometrics");

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

// ---------------------------------------------------------------------------
// Tests: auth state gate
// ---------------------------------------------------------------------------

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
