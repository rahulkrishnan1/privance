/**
 * Browser component tests for the Biometric unlock section in Settings.
 * The WebAuthn ceremony module is mocked; the biometric store runs with real
 * Chromium IndexedDB (except saveEnrollment, which is spied on per-test).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const authMock = vi.hoisted(() => ({
  user: null as { userId: string; username: string } | null,
  lock: vi.fn(),
  logout: vi.fn(),
}));

const webauthnMock = vi.hoisted(() => ({
  isBiometricSupported: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  enrollCredential:
    vi.fn<
      (opts: { username: string }) => Promise<{
        credentialId: Uint8Array;
        prfOutput: Uint8Array;
        salt: Uint8Array;
      }>
    >(),
}));

// Spy on saveEnrollment so individual tests can override it to throw.
const storeSpy = vi.hoisted(() => ({ saveEnrollment: vi.fn() }));

vi.mock("@/providers/auth-context", async (importActual) => {
  const actual = await importActual<typeof import("@/providers/auth-context")>();
  return {
    ...actual,
    useAuth: () => ({
      state: "unlocked" as const,
      user: authMock.user,
      persistence: "session" as const,
      lock: authMock.lock,
      logout: authMock.logout,
      login: vi.fn(),
      unlock: vi.fn(),
      registerLogoutCleanup: vi.fn(() => vi.fn()),
    }),
    readItemsKey: () =>
      crypto.getRandomValues(new Uint8Array(32)) as unknown as import("@privance/core").ItemsKey,
  };
});

vi.mock("@/lib/crypto/webauthn-prf", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/crypto/webauthn-prf")>();
  return {
    ...actual,
    isBiometricSupported: webauthnMock.isBiometricSupported,
    enrollCredential: webauthnMock.enrollCredential,
  };
});

vi.mock("@/lib/storage/biometric-store", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/storage/biometric-store")>();
  // Default: call through to real implementation. Tests can make storeSpy.saveEnrollment
  // throw to simulate a save failure after a successful ceremony.
  storeSpy.saveEnrollment.mockImplementation(
    // biome-ignore lint/suspicious/noExplicitAny: vi.fn() infers [] tuple; cast avoids TS2345
    actual.saveEnrollment as (...args: any[]) => any,
  );
  return {
    ...actual,
    saveEnrollment: (...args: Parameters<typeof actual.saveEnrollment>) =>
      storeSpy.saveEnrollment(...args),
  };
});

import { BiometricCancelledError, BiometricUnsupportedError } from "@/lib/crypto/webauthn-prf";
import { purgeEnrollment } from "@/lib/storage/biometric-store";
import { readRawBiometricIdb, seedEnrollment } from "@/lib/storage/biometric-store.test-helpers";
import { SettingsScreen as SettingsPage } from "./settings-screen";

function makeEnrollResult() {
  return {
    credentialId: crypto.getRandomValues(new Uint8Array(16)),
    prfOutput: crypto.getRandomValues(new Uint8Array(32)),
    salt: crypto.getRandomValues(new Uint8Array(32)),
  };
}

beforeEach(async () => {
  authMock.user = { userId: "user-test", username: "alice" };
  authMock.lock.mockClear();
  authMock.logout.mockClear();
  webauthnMock.isBiometricSupported.mockResolvedValue(true);
  webauthnMock.enrollCredential.mockResolvedValue(makeEnrollResult());
  // Reset saveEnrollment spy to pass through to the real implementation.
  const { saveEnrollment: realSave } = await vi.importActual<
    typeof import("@/lib/storage/biometric-store")
  >("@/lib/storage/biometric-store");
  // biome-ignore lint/suspicious/noExplicitAny: vi.fn() infers [] tuple; cast avoids TS2345
  storeSpy.saveEnrollment.mockImplementation(realSave as (...args: any[]) => any);
  await purgeEnrollment();
  localStorage.clear();
});

afterEach(async () => {
  await purgeEnrollment();
  localStorage.clear();
});

// The enroll/disable controls live in a dialog opened from the Biometric row;
// click the row to reveal them.
async function openBiometricDialog(screen: Awaited<ReturnType<typeof render>>) {
  await screen.getByRole("button", { name: /Biometric unlock/ }).click();
}

describe("biometric row visibility", () => {
  it("shows an Unavailable badge and opens no dialog when unsupported (AE1)", async () => {
    webauthnMock.isBiometricSupported.mockResolvedValue(false);
    const screen = await render(<SettingsPage />);

    await expect.element(screen.getByText("Unavailable")).toBeVisible();
    // The row is not actionable, so the dialog's controls never appear.
    await expect
      .element(screen.getByRole("button", { name: "Enable biometric unlock" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("heading", { name: /your way/i })).toBeVisible();
  });

  it("shows an Off badge and reveals the enroll button in the dialog when not enrolled", async () => {
    const screen = await render(<SettingsPage />);

    await expect.element(screen.getByText("Off")).toBeVisible();
    await openBiometricDialog(screen);

    await expect
      .element(screen.getByRole("button", { name: "Enable biometric unlock" }))
      .toBeVisible();
  });

  it("shows an Enabled badge when a fresh record exists", async () => {
    await seedEnrollment({ userId: "user-test", username: "alice" });
    const screen = await render(<SettingsPage />);

    await expect.element(screen.getByText("Enabled")).toBeVisible();
  });
});

describe("successful enrollment (R1, F1)", () => {
  it("shows enabled state and persists a record with all fresh fields", async () => {
    const screen = await render(<SettingsPage />);
    await openBiometricDialog(screen);

    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole("button", { name: "Enable biometric unlock" }))
        .toBeVisible();
    });

    await screen.getByRole("button", { name: "Enable biometric unlock" }).click();

    // After enrollment the disable button appears.
    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole("button", { name: "Disable biometric unlock" }))
        .toBeVisible();
    });

    // IDB must hold a valid record with fresh fields.
    const raw = (await readRawBiometricIdb()) as Record<string, unknown>;
    expect(raw).not.toBeUndefined();
    expect(typeof raw.recordUuid).toBe("string");
    expect(raw.credentialId).toBeInstanceOf(Uint8Array);
    expect(raw.wrappedItemsKey).toBeInstanceOf(Uint8Array);
    expect(typeof raw.lastPasswordUnlockAt).toBe("number");
  });
});

describe("cancelled enrollment (R16)", () => {
  it("leaves state off with an inline error and no IDB record", async () => {
    webauthnMock.enrollCredential.mockRejectedValue(new BiometricCancelledError());

    const screen = await render(<SettingsPage />);
    await openBiometricDialog(screen);
    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole("button", { name: "Enable biometric unlock" }))
        .toBeVisible();
    });

    await screen.getByRole("button", { name: "Enable biometric unlock" }).click();

    // Must still show the enroll button (not-enrolled state restored).
    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole("button", { name: "Enable biometric unlock" }))
        .toBeVisible();
    });

    // Inline error for cancellation.
    await expect.element(screen.getByText("Enrollment was cancelled.")).toBeVisible();

    // IDB must be empty.
    const raw = await readRawBiometricIdb();
    expect(raw).toBeUndefined();
  });
});

describe("BiometricUnsupportedError during enrollment (R16)", () => {
  it("maps to the unsupported message and stores nothing", async () => {
    webauthnMock.enrollCredential.mockRejectedValue(
      new BiometricUnsupportedError("PRF not supported"),
    );

    const screen = await render(<SettingsPage />);
    await openBiometricDialog(screen);
    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole("button", { name: "Enable biometric unlock" }))
        .toBeVisible();
    });

    await screen.getByRole("button", { name: "Enable biometric unlock" }).click();

    await vi.waitFor(async () => {
      await expect
        .element(screen.getByText("This device does not support biometric unlock."))
        .toBeVisible();
    });

    // The passkey was created before PRF support could be confirmed, so the
    // orphaned-credential disclosure must accompany the unsupported message.
    await expect
      .element(screen.getByText(/passkey remains in your device credential manager/))
      .toBeVisible();

    // Must remain in disabled state.
    await expect
      .element(screen.getByRole("button", { name: "Enable biometric unlock" }))
      .toBeVisible();

    const raw = await readRawBiometricIdb();
    expect(raw).toBeUndefined();
  });
});

describe("save failure after successful ceremony (R14, R16)", () => {
  it("shows inline error plus OS-passkey notice when saveEnrollment throws", async () => {
    // Make saveEnrollment throw AFTER the ceremony (which resolves via the mock).
    storeSpy.saveEnrollment.mockRejectedValue(new Error("IDB quota exceeded"));

    const screen = await render(<SettingsPage />);
    await openBiometricDialog(screen);
    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole("button", { name: "Enable biometric unlock" }))
        .toBeVisible();
    });

    await screen.getByRole("button", { name: "Enable biometric unlock" }).click();

    // Enrollment failed to save error must appear.
    await vi.waitFor(async () => {
      await expect
        .element(screen.getByText("Enrollment failed to save.", { exact: false }))
        .toBeVisible();
    });

    // OS-passkey notice must also be present (R14).
    await expect
      .element(
        screen.getByText("The associated passkey remains in your device credential manager.", {
          exact: false,
        }),
      )
      .toBeVisible();

    // State stays not-enrolled.
    await expect
      .element(screen.getByRole("button", { name: "Enable biometric unlock" }))
      .toBeVisible();
  });
});

describe("disable flow (AE7)", () => {
  it("purges the IDB record and shows the OS-passkey notice", async () => {
    await seedEnrollment({ userId: "user-test", username: "alice" });

    const screen = await render(<SettingsPage />);
    await openBiometricDialog(screen);
    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole("button", { name: "Disable biometric unlock" }))
        .toBeVisible();
    });

    await screen.getByRole("button", { name: "Disable biometric unlock" }).click();

    // After disable: IDB empty.
    await vi.waitFor(async () => {
      const raw = await readRawBiometricIdb();
      expect(raw).toBeUndefined();
    });

    // OS-passkey notice shown.
    await expect
      .element(
        screen.getByText("The associated passkey remains in your device credential manager.", {
          exact: false,
        }),
      )
      .toBeVisible();

    // Enroll button re-appears (not-enrolled state).
    await expect
      .element(screen.getByRole("button", { name: "Enable biometric unlock" }))
      .toBeVisible();
  });
});

describe("re-enrollment after disable (R15)", () => {
  it("produces a new credentialId in the IDB record", async () => {
    // Seed an existing record and then disable it via the UI.
    const { credentialId: oldCredentialId } = await seedEnrollment({
      userId: "user-test",
      username: "alice",
    });

    const screen = await render(<SettingsPage />);
    await openBiometricDialog(screen);
    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole("button", { name: "Disable biometric unlock" }))
        .toBeVisible();
    });

    await screen.getByRole("button", { name: "Disable biometric unlock" }).click();
    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole("button", { name: "Enable biometric unlock" }))
        .toBeVisible();
    });

    // Enroll again with a new credential.
    const newResult = makeEnrollResult();
    webauthnMock.enrollCredential.mockResolvedValueOnce(newResult);
    await screen.getByRole("button", { name: "Enable biometric unlock" }).click();

    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole("button", { name: "Disable biometric unlock" }))
        .toBeVisible();
    });

    const raw = (await readRawBiometricIdb()) as Record<string, unknown>;
    expect(raw).not.toBeUndefined();
    const newCredentialId = raw.credentialId as Uint8Array;
    // New credential id must differ from the original.
    expect(Array.from(newCredentialId)).not.toEqual(Array.from(oldCredentialId));
  });
});

describe("re-enrollment over an expired record (R15)", () => {
  it("replaces the old bookkeeping with fresh fields", async () => {
    // Seed a stale record (15 days ago, past the 14-day cadence).
    const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
    const { recordUuid: oldRecordUuid } = await seedEnrollment({
      userId: "user-test",
      username: "alice",
      lastPasswordUnlockAt: fifteenDaysAgo,
    });

    // loadEnrollment purges the stale record and returns null, so the page
    // initializes to "not-enrolled" and shows the Enable button.
    const screen = await render(<SettingsPage />);
    await openBiometricDialog(screen);
    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole("button", { name: "Enable biometric unlock" }))
        .toBeVisible();
    });

    // Enroll with fresh material.
    const newResult = makeEnrollResult();
    webauthnMock.enrollCredential.mockResolvedValueOnce(newResult);
    await screen.getByRole("button", { name: "Enable biometric unlock" }).click();

    await vi.waitFor(async () => {
      await expect
        .element(screen.getByRole("button", { name: "Disable biometric unlock" }))
        .toBeVisible();
    });

    const raw = (await readRawBiometricIdb()) as Record<string, unknown>;
    expect(raw).not.toBeUndefined();
    // New record must have a different recordUuid and a fresh timestamp.
    expect(raw.recordUuid).not.toBe(oldRecordUuid);
    expect(raw.lastPasswordUnlockAt as number).toBeGreaterThan(fifteenDaysAgo);
  });
});
