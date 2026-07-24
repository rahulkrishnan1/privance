/**
 * Browser component tests for the Settings dialogs that touch crypto + the
 * network: change master password, recovery-phrase check, and destroy vault.
 * The API and crypto boundaries are mocked; assertions are on user-observable
 * outcomes (success/error copy, button enable/disable), never class strings.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const authApiMock = vi.hoisted(() => ({
  kdfParams: vi.fn(),
  passwordChange: vi.fn(),
  recoveryDeriveParams: vi.fn(),
  logout: vi.fn(),
}));

const accountApiMock = vi.hoisted(() => ({
  destroy: vi.fn(),
}));

const cryptoMock = vi.hoisted(() => ({
  deriveLoginCrypto: vi.fn(),
  deriveNewCredsAfterRecovery: vi.fn(),
  deriveRecoveryUnwrap: vi.fn(),
}));

const authCtxMock = vi.hoisted(() => ({
  logout: vi.fn(),
}));

// The hard-redirect seam (window.location.replace is non-configurable in real
// Chromium, so the destroy flow routes through this module for testability).
const navigateMock = vi.hoisted(() => ({ hardRedirect: vi.fn() }));

vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api/auth")>();
  return { ...actual, ...authApiMock };
});

vi.mock("@/lib/api/account", () => accountApiMock);

vi.mock("@/lib/navigate", () => navigateMock);

vi.mock("@/lib/auth-crypto", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth-crypto")>();
  return {
    ...actual,
    deriveLoginCrypto: cryptoMock.deriveLoginCrypto,
    deriveNewCredsAfterRecovery: cryptoMock.deriveNewCredsAfterRecovery,
    deriveRecoveryUnwrap: cryptoMock.deriveRecoveryUnwrap,
  };
});

// Force biometric to unsupported so the row is inert and does not interfere.
vi.mock("@/lib/crypto/webauthn-prf", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/crypto/webauthn-prf")>();
  return { ...actual, isBiometricSupported: () => Promise.resolve(false) };
});

vi.mock("@/providers/auth-context", async (importActual) => {
  const actual = await importActual<typeof import("@/providers/auth-context")>();
  return {
    ...actual,
    useAuth: () => ({
      state: "unlocked" as const,
      user: { userId: "user-1", username: "alice" },
      persistence: "session" as const,
      lock: vi.fn(),
      logout: authCtxMock.logout,
      login: vi.fn(),
      unlock: vi.fn(),
      registerLogoutCleanup: vi.fn(() => vi.fn()),
    }),
    readItemsKey: () =>
      crypto.getRandomValues(new Uint8Array(32)) as unknown as import("@privance/core").ItemsKey,
  };
});

import { ApiError } from "@/lib/api/client";
import { DecryptionError } from "@/lib/auth-crypto";
import { SettingsScreen as SettingsPage } from "./settings-screen";

const VALID_PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";

const NEW_CREDS = {
  newAuthHash: "bmV3LWF1dGgtaGFzaA==",
  newKdfSalt: "salt",
  newKdfParams: { memoryCost: 1, timeCost: 1, parallelism: 1, hashLength: 32 },
  newRecoveryBlob: "blob",
  newRecoverySalt: "rsalt",
  newRecoveryParams: { memoryCost: 1, timeCost: 1, parallelism: 1, hashLength: 32 },
  newWrappedDek: "wdek",
  newWrappedDekIv: "wdekiv",
  newWrappedDekRecovery: "wdekr",
  newWrappedDekRecoveryIv: "wdekriv",
  newPhrase: VALID_PHRASE,
};

const KDF_PARAMS_RES = {
  kdf_algo: "argon2id" as const,
  kdf_params: { memoryCost: 1, timeCost: 1, parallelism: 1, hashLength: 32 },
  kdf_salt: "ksalt",
};

beforeEach(() => {
  vi.clearAllMocks();
  authApiMock.kdfParams.mockResolvedValue(KDF_PARAMS_RES);
  authApiMock.logout.mockResolvedValue({ status: "ok" });
  cryptoMock.deriveLoginCrypto.mockResolvedValue({
    authHash: "Y3VyLWF1dGgtaGFzaA==",
    kek: new Uint8Array(32),
    kdfParamVersion: 1,
  });
  cryptoMock.deriveNewCredsAfterRecovery.mockResolvedValue(NEW_CREDS);
  // onDestroyed === the context logout; it returns a promise the destroy flow awaits.
  authCtxMock.logout.mockResolvedValue(undefined);
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("start veiled toggle", () => {
  it("persists the preference to localStorage as it flips", async () => {
    const screen = await render(<SettingsPage />);

    const toggle = screen.getByRole("switch", { name: "Start veiled" });
    await expect.element(toggle).toHaveAttribute("aria-checked", "false");

    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem("privance.veilStart.v1")).toBe("1");

    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-checked", "false");
    expect(localStorage.getItem("privance.veilStart.v1")).toBe("0");
  });
});

describe("version row", () => {
  it("shows the injected build version, not the 'unknown' fallback", async () => {
    const screen = await render(<SettingsPage />);

    // VITE_APP_VERSION is inlined by the vitest define (production uses the real
    // build version). The import.meta.env read must not fall back to "unknown".
    await expect.element(screen.getByText("v0.0.0-test")).toBeVisible();
    await expect.element(screen.getByText("vunknown")).not.toBeInTheDocument();
  });
});

describe("change master password", () => {
  it("reveals the new recovery phrase on success and sends the current auth hash", async () => {
    authApiMock.passwordChange.mockResolvedValue(undefined);
    const screen = await render(<SettingsPage />);

    await screen.getByRole("button", { name: /Master password/ }).click();
    await screen.getByLabelText("Current password").fill("old-password-123");
    await screen.getByLabelText("New password").fill("a-brand-new-strong-password");
    await screen.getByRole("button", { name: "Change password" }).click();

    // Success state shows the replaced-phrase copy and the new words.
    await expect.element(screen.getByText(/replaced your recovery phrase/)).toBeVisible();
    await expect.element(screen.getByText("yellow")).toBeVisible();

    // current_auth_hash from deriveLoginCrypto must be forwarded to the server.
    expect(authApiMock.passwordChange).toHaveBeenCalledWith(
      expect.objectContaining({ current_auth_hash: "Y3VyLWF1dGgtaGFzaA==" }),
    );
  });

  it("shows a wrong-password message on a 401", async () => {
    authApiMock.passwordChange.mockRejectedValue(new ApiError(401, "invalid_credentials", "no"));
    const screen = await render(<SettingsPage />);

    await screen.getByRole("button", { name: /Master password/ }).click();
    await screen.getByLabelText("Current password").fill("wrong");
    await screen.getByLabelText("New password").fill("a-brand-new-strong-password");
    await screen.getByRole("button", { name: "Change password" }).click();

    await expect.element(screen.getByText("Current password is incorrect.")).toBeVisible();
  });

  it("blocks a too-short new password before any crypto or network call", async () => {
    const screen = await render(<SettingsPage />);

    await screen.getByRole("button", { name: /Master password/ }).click();
    await screen.getByLabelText("Current password").fill("old-password-123");
    await screen.getByLabelText("New password").fill("short");
    await screen.getByRole("button", { name: "Change password" }).click();

    await expect.element(screen.getByText(/at least 12 characters/)).toBeVisible();
    expect(authApiMock.passwordChange).not.toHaveBeenCalled();
    expect(cryptoMock.deriveNewCredsAfterRecovery).not.toHaveBeenCalled();
  });
});

describe("recovery phrase check", () => {
  const RECOVERY_PARAMS = {
    ...KDF_PARAMS_RES,
    recovery_blob: "blob",
    recovery_salt: "rsalt",
    recovery_params: { memoryCost: 1, timeCost: 1, parallelism: 1, hashLength: 32 },
    wrapped_dek_recovery: "wdekr",
    wrapped_dek_recovery_iv: "wdekriv",
  };

  it("confirms the phrase still opens the vault on a successful unwrap", async () => {
    authApiMock.recoveryDeriveParams.mockResolvedValue(RECOVERY_PARAMS);
    cryptoMock.deriveRecoveryUnwrap.mockResolvedValue(new Uint8Array(32));
    const screen = await render(<SettingsPage />);

    await screen.getByRole("button", { name: /Recovery phrase/ }).click();
    await screen.getByLabelText(/Recovery phrase/).fill(VALID_PHRASE);
    await screen.getByRole("button", { name: "Verify", exact: true }).click();

    await expect.element(screen.getByRole("status")).toHaveTextContent(/Verified/);
  });

  it("reports a mismatch when the unwrap fails to decrypt", async () => {
    authApiMock.recoveryDeriveParams.mockResolvedValue(RECOVERY_PARAMS);
    cryptoMock.deriveRecoveryUnwrap.mockRejectedValue(new DecryptionError("bad"));
    const screen = await render(<SettingsPage />);

    await screen.getByRole("button", { name: /Recovery phrase/ }).click();
    await screen.getByLabelText(/Recovery phrase/).fill(VALID_PHRASE);
    await screen.getByRole("button", { name: "Verify", exact: true }).click();

    await expect.element(screen.getByText(/doesn.t match/)).toBeVisible();
  });

  it("rejects a structurally invalid phrase before any network call", async () => {
    const screen = await render(<SettingsPage />);

    await screen.getByRole("button", { name: /Recovery phrase/ }).click();
    await screen.getByLabelText(/Recovery phrase/).fill("not a real phrase at all here ok");
    await screen.getByRole("button", { name: "Verify", exact: true }).click();

    await expect.element(screen.getByText(/doesn.t match/)).toBeVisible();
    expect(authApiMock.recoveryDeriveParams).not.toHaveBeenCalled();
  });

  it("shows a distinct error when the check itself fails (non-decryption error)", async () => {
    authApiMock.recoveryDeriveParams.mockRejectedValue(new Error("network down"));
    const screen = await render(<SettingsPage />);

    await screen.getByRole("button", { name: /Recovery phrase/ }).click();
    await screen.getByLabelText(/Recovery phrase/).fill(VALID_PHRASE);
    await screen.getByRole("button", { name: "Verify", exact: true }).click();

    // Distinct from the mismatch copy.
    await expect.element(screen.getByText(/Couldn.t run the check/)).toBeVisible();
  });
});

describe("destroy vault", () => {
  it("arms the destroy button only when username matches and a password is typed", async () => {
    const screen = await render(<SettingsPage />);

    await screen.getByRole("button", { name: /Destroy vault/ }).click();

    const destroyBtn = screen.getByRole("button", { name: "Destroy forever" });
    await expect.element(destroyBtn).toBeDisabled();

    await screen.getByLabelText(/Type your username/).fill("alice");
    // Username matches but no password yet, still disabled.
    await expect.element(destroyBtn).toBeDisabled();

    await screen.getByLabelText("Master password").fill("secret");
    await expect.element(destroyBtn).toBeEnabled();
  });

  it("keeps the button disabled when the username does not match", async () => {
    const screen = await render(<SettingsPage />);

    await screen.getByRole("button", { name: /Destroy vault/ }).click();
    await screen.getByLabelText(/Type your username/).fill("bob");
    await screen.getByLabelText("Master password").fill("secret");

    await expect.element(screen.getByRole("button", { name: "Destroy forever" })).toBeDisabled();
  });

  it("surfaces a wrong-password message on a 401 and does not log out", async () => {
    accountApiMock.destroy.mockRejectedValue(new ApiError(401, "invalid_password", "no"));
    const screen = await render(<SettingsPage />);

    await screen.getByRole("button", { name: /Destroy vault/ }).click();
    await screen.getByLabelText(/Type your username/).fill("alice");
    await screen.getByLabelText("Master password").fill("wrong");
    await screen.getByRole("button", { name: "Destroy forever" }).click();

    await expect.element(screen.getByText("Password is incorrect.")).toBeVisible();
    expect(authCtxMock.logout).not.toHaveBeenCalled();
  });

  it("destroys the vault, wipes the local store, and redirects on success", async () => {
    accountApiMock.destroy.mockResolvedValue(undefined);
    const screen = await render(<SettingsPage />);

    await screen.getByRole("button", { name: /Destroy vault/ }).click();
    await screen.getByLabelText(/Type your username/).fill("alice");
    await screen.getByLabelText("Master password").fill("secret");
    await screen.getByRole("button", { name: "Destroy forever" }).click();

    await vi.waitFor(() => {
      expect(navigateMock.hardRedirect).toHaveBeenCalledWith("/auth/login");
    });
    expect(accountApiMock.destroy).toHaveBeenCalledWith({
      current_auth_hash: "Y3VyLWF1dGgtaGFzaA==",
    });
    // onDestroyed === the context logout, which wipes OPFS + clears the DEK.
    expect(authCtxMock.logout).toHaveBeenCalled();
  });

  it("still redirects when local cleanup throws after the server destroy", async () => {
    accountApiMock.destroy.mockResolvedValue(undefined);
    // OPFS-disabled hosts: logout/cleanup can reject; the redirect must still fire.
    authCtxMock.logout.mockRejectedValue(new Error("OPFS unavailable"));
    const screen = await render(<SettingsPage />);

    await screen.getByRole("button", { name: /Destroy vault/ }).click();
    await screen.getByLabelText(/Type your username/).fill("alice");
    await screen.getByLabelText("Master password").fill("secret");
    await screen.getByRole("button", { name: "Destroy forever" }).click();

    await vi.waitFor(() => {
      expect(navigateMock.hardRedirect).toHaveBeenCalledWith("/auth/login");
    });
  });
});
