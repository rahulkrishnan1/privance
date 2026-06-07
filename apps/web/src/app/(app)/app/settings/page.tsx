"use client";

import { deriveBiometricKek, sealProtectorKey } from "@privance/core";
import { useEffect, useState } from "react";
import { Button, Screen } from "@/components/index";
import { logout as apiLogout } from "@/lib/api/auth";
import {
  BiometricCancelledError,
  BiometricUnsupportedError,
  enrollCredential,
  isBiometricSupported,
} from "@/lib/crypto/webauthn-prf";
import {
  generateProtectorKeypair,
  loadEnrollment,
  purgeEnrollment,
  saveEnrollment,
  wrapItemsKeyRsa,
} from "@/lib/storage/biometric-store";
import { readItemsKey, useAuth } from "@/providers/auth-context";

const APP_VERSION = "0.1.0";

// "enrolled" = record exists and cadence is fresh (loadEnrollment returned non-null)
// "not-enrolled" = no record or cadence expired
// "enrolling" / "disabling" = operation in-flight
// "checking" = initial async check not yet complete
// "unsupported" = device cannot support biometric unlock (hide section entirely)
type BiometricPhase =
  | "checking"
  | "unsupported"
  | "not-enrolled"
  | "enrolled"
  | "enrolling"
  | "disabling";

type BiometricMessage =
  | { kind: "cancelled" }
  | { kind: "unsupported" }
  | { kind: "save-failed-with-orphan" }
  | { kind: "other"; text: string }
  | { kind: "os-passkey-notice" };

export default function SettingsPage() {
  const { lock, logout, user } = useAuth();

  const [phase, setPhase] = useState<BiometricPhase>("checking");
  const [message, setMessage] = useState<BiometricMessage | null>(null);

  // Determine initial biometric state on mount. loadEnrollment is the source of
  // truth: it applies cadence + account guards that bare record presence skips.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supported = await isBiometricSupported();
      if (cancelled) return;
      if (!supported) {
        setPhase("unsupported");
        return;
      }
      const userId = user?.userId;
      if (!userId) {
        // userId absent only during transient boot; settings only renders unlocked.
        setPhase("not-enrolled");
        return;
      }
      const record = await loadEnrollment({ now: Date.now(), userId });
      if (cancelled) return;
      setPhase(record ? "enrolled" : "not-enrolled");
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.userId]);

  async function handleEnroll() {
    if (!user?.userId || !user.username) return;
    setPhase("enrolling");
    setMessage(null);

    const itemsKey = readItemsKey();
    if (!itemsKey) {
      setPhase("not-enrolled");
      setMessage({ kind: "other", text: "Session key unavailable. Lock and unlock first." });
      return;
    }

    let prfOutput: Uint8Array | null = null;
    let ceremonySucceeded = false;

    try {
      const result = await enrollCredential({ username: user.username });
      prfOutput = result.prfOutput;
      ceremonySucceeded = true;

      const recordUuid = crypto.randomUUID();
      const { publicKeyBytes, pkcs8 } = await generateProtectorKeypair();
      const kek = deriveBiometricKek({ prfOutput, salt: result.salt });
      const sealedPrivateKey = sealProtectorKey({
        pkcs8,
        kek,
        pubKeyBytes: publicKeyBytes,
        recordUuid,
      });
      pkcs8.fill(0);
      prfOutput.fill(0);
      prfOutput = null;

      const wrappedItemsKey = await wrapItemsKeyRsa({
        itemsKey,
        publicKeyBytes,
        recordUuid,
      });

      await saveEnrollment({
        recordUuid,
        userId: user.userId,
        username: user.username,
        credentialId: result.credentialId,
        salt: result.salt,
        publicKeyBytes,
        sealedPrivateKey,
        wrappedItemsKey,
        now: Date.now(),
      });

      setPhase("enrolled");
    } catch (err) {
      if (prfOutput) {
        prfOutput.fill(0);
        prfOutput = null;
      }
      setPhase("not-enrolled");

      if (err instanceof BiometricCancelledError) {
        setMessage({ kind: "cancelled" });
      } else if (err instanceof BiometricUnsupportedError) {
        // Thrown only after create() succeeded without PRF, so an OS passkey
        // already exists; the notice renders alongside the unsupported message.
        setMessage({ kind: "unsupported" });
      } else if (ceremonySucceeded) {
        // Passkey was created but save failed. The OS-side credential remains.
        setMessage({ kind: "save-failed-with-orphan" });
      } else {
        setMessage({ kind: "other", text: "Enrollment failed. Try again." });
      }
    }
  }

  async function handleDisable() {
    setPhase("disabling");
    setMessage(null);
    await purgeEnrollment();
    setPhase("not-enrolled");
    setMessage({ kind: "os-passkey-notice" });
  }

  async function handleSignOut() {
    await apiLogout().catch(() => undefined);
    // Await logout so the registered store.destroy() finishes before we unload.
    await logout();
    window.location.replace("/auth/login/");
  }

  return (
    <Screen>
      <h1
        className="font-serif text-[32px] leading-tight font-light tracking-[-0.015em] text-app-text mb-10"
        style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
      >
        Settings
      </h1>

      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-4">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
            About
          </span>
          <div className="rounded-xl border border-app-line bg-app-panel divide-y divide-app-line-soft">
            <div className="flex justify-between items-center px-5 py-4">
              <span className="text-[14px] text-app-muted">App</span>
              <span className="font-mono text-[13px] text-app-text">Privance</span>
            </div>
            <div className="flex justify-between items-center px-5 py-4">
              <span className="text-[14px] text-app-muted">Version</span>
              <span className="font-mono text-[13px] tabular-nums text-app-text">
                {APP_VERSION}
              </span>
            </div>
          </div>
        </section>

        {phase !== "checking" && phase !== "unsupported" && (
          <section className="flex flex-col gap-4" aria-label="Biometric unlock">
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
              Biometric unlock
            </span>
            <div className="rounded-xl border border-app-line bg-app-panel p-5 flex flex-col gap-5">
              <p className="text-[14px] text-app-muted">
                {phase === "enrolled"
                  ? "Face ID or Touch ID is enabled. You can unlock without entering your master password."
                  : "Enable Face ID or Touch ID to unlock without your master password. Your master password remains required every 14 days."}
              </p>

              {message?.kind === "cancelled" && (
                <p role="alert" className="text-[13px] text-app-red">
                  Enrollment was cancelled.
                </p>
              )}
              {message?.kind === "unsupported" && (
                <p role="alert" className="text-[13px] text-app-red">
                  This device does not support biometric unlock.
                </p>
              )}
              {message?.kind === "other" && (
                <p role="alert" className="text-[13px] text-app-red">
                  {message.text}
                </p>
              )}
              {message?.kind === "save-failed-with-orphan" && (
                <p role="alert" className="text-[13px] text-app-red">
                  Enrollment failed to save. A passkey was created and may appear in your OS passkey
                  manager. You can remove it there.
                </p>
              )}
              {(message?.kind === "os-passkey-notice" ||
                message?.kind === "save-failed-with-orphan" ||
                message?.kind === "unsupported") && (
                <p className="text-[13px] text-app-muted">
                  The associated passkey remains in your device credential manager. You can remove
                  it from your OS settings.
                </p>
              )}

              {phase === "enrolled" || phase === "disabling" ? (
                <Button
                  variant="secondary"
                  onClick={() => void handleDisable()}
                  loading={phase === "disabling"}
                >
                  Disable biometric unlock
                </Button>
              ) : (
                <Button onClick={() => void handleEnroll()} loading={phase === "enrolling"}>
                  Enable biometric unlock
                </Button>
              )}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-4">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
            Security
          </span>
          <div className="rounded-xl border border-app-line bg-app-panel p-5 flex flex-col gap-5">
            <p className="text-[14px] text-app-muted">
              Privance uses zero-knowledge encryption. Your master password and data-encryption key
              never leave your device.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="secondary" onClick={lock} className="sm:flex-1">
                Lock
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleSignOut()}
                className="sm:flex-1"
              >
                Sign out
              </Button>
            </div>
          </div>
        </section>

        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim text-center pt-4">
          More settings coming soon
        </p>
      </div>
    </Screen>
  );
}
