"use client";

import { deriveBiometricKek, sealProtectorKey } from "@privance/core";
import { useEffect, useState } from "react";
import { Screen } from "@/components/index";
import * as authApi from "@/lib/api/auth";
import {
  BiometricCancelledError,
  BiometricUnsupportedError,
  enrollCredential,
  isBiometricSupported,
} from "@/lib/crypto/webauthn-prf";
import { hardRedirect } from "@/lib/navigate";
import {
  generateProtectorKeypair,
  loadEnrollment,
  purgeEnrollment,
  saveEnrollment,
  wrapItemsKeyRsa,
} from "@/lib/storage/biometric-store";
import { useHydrated } from "@/lib/use-hydrated";
import { readStartVeil, writeStartVeil } from "@/lib/veil";
import { readItemsKey, useAuth } from "@/providers/auth-context";
import { Badge, Caret, Row, SectionLabel, SettingsCard, Toggle } from "./components/_primitives";
import { BiometricDialog } from "./components/biometric-dialog";
import { ChangePasswordDialog } from "./components/change-password-dialog";
import { DestroyDialog } from "./components/destroy-dialog";
import { PhraseCheckDialog } from "./components/phrase-check-dialog";
import { SignOutDialog } from "./components/sign-out-dialog";
import type { BiometricMessage, BiometricPhase, Dialog } from "./types";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";
const SOURCE_URL = "https://github.com/rahulkrishnan1/privance";
const COINGECKO_URL = "https://www.coingecko.com";

export function SettingsScreen() {
  const { logout, user } = useAuth();
  const hydrated = useHydrated();

  const [dialog, setDialog] = useState<Dialog>(null);
  const closeDialog = () => setDialog(null);

  const [veilStart, setVeilStart] = useState(false);
  useEffect(() => {
    setVeilStart(readStartVeil());
  }, []);
  const toggleVeilStart = () => {
    setVeilStart((v) => {
      const next = !v;
      writeStartVeil(next);
      return next;
    });
  };

  const [phase, setPhase] = useState<BiometricPhase>("checking");
  const [bioMessage, setBioMessage] = useState<BiometricMessage | null>(null);

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
    setBioMessage(null);

    const itemsKey = readItemsKey();
    if (!itemsKey) {
      setPhase("not-enrolled");
      setBioMessage({ kind: "other", text: "Session key unavailable. Lock and unlock first." });
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
        setBioMessage({ kind: "cancelled" });
      } else if (err instanceof BiometricUnsupportedError) {
        setBioMessage({ kind: "unsupported" });
      } else if (ceremonySucceeded) {
        setBioMessage({ kind: "save-failed-with-orphan" });
      } else {
        setBioMessage({ kind: "other", text: "Enrollment failed. Try again." });
      }
    }
  }

  async function handleDisable() {
    setPhase("disabling");
    setBioMessage(null);
    await purgeEnrollment();
    setPhase("not-enrolled");
    setBioMessage({ kind: "os-passkey-notice" });
  }

  async function handleSignOut() {
    await authApi.logout().catch(() => undefined);
    // Await logout so the registered store.destroy() finishes before we unload.
    await logout();
    hardRedirect("/auth/login/");
  }

  const bioBadge =
    phase === "enrolled" ? (
      <Badge label="Enabled" variant="on" />
    ) : phase === "unsupported" ? (
      <Badge label="Unavailable" variant="unavailable" />
    ) : phase === "checking" ? null : (
      <Badge label="Off" variant="off" />
    );

  const bioDescription =
    phase === "enrolled"
      ? "Face ID on this device, password check every 14 days"
      : phase === "unsupported"
        ? "not available in this browser"
        : "unlock without typing the master password";

  return (
    <Screen>
      <div className="mb-8">
        <p className="font-mono text-xs uppercase tracking-label text-faint">Settings</p>
        <h1 className="mt-[10px] font-serif font-normal text-[clamp(36px,5vw,52px)] leading-[1.05] tracking-[-0.015em]">
          The vault, <em className="text-accent">your way.</em>
        </h1>
      </div>

      <div className="flex flex-col gap-8">
        <section>
          <SectionLabel>Security</SectionLabel>
          <SettingsCard>
            <Row
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <circle cx="8" cy="14" r="4" />
                  <path d="M11 11 20 2m-3 3 3 3" />
                </svg>
              }
              name="Master password"
              description="change your master password"
              trailing={<Caret />}
              onClick={() => setDialog("password")}
            />

            {phase !== "checking" && (
              <Row
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path d="M7 4.5h-.5A2.5 2.5 0 0 0 4 7v.5M17 4.5h.5A2.5 2.5 0 0 1 20 7v.5M7 19.5h-.5A2.5 2.5 0 0 1 4 17v-.5M17 19.5h.5a2.5 2.5 0 0 0 2.5-2.5v-.5M9 9.5v1M15 9.5v1M9.5 14.5c.7.7 1.5 1 2.5 1s1.8-.3 2.5-1" />
                  </svg>
                }
                name="Biometric unlock"
                description={bioDescription}
                trailing={bioBadge}
                onClick={phase === "unsupported" ? undefined : () => setDialog("biometric")}
              />
            )}

            <Row
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M4 6h16M4 12h16M4 18h10" />
                </svg>
              }
              name="Recovery phrase"
              description="verify you still have it"
              trailing={<Badge label="Check" variant="off" />}
              onClick={() => setDialog("phrase")}
            />

            <Row
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              }
              name="Sign out"
              description="forget this device"
              trailing={<Caret />}
              onClick={() => setDialog("signout")}
            />
          </SettingsCard>
        </section>

        <section>
          <SectionLabel>Display</SectionLabel>
          <SettingsCard>
            <Row
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="2.6" />
                </svg>
              }
              name="Start veiled"
              description="open every session with figures hidden"
              trailing={
                hydrated ? (
                  <Toggle on={veilStart} onToggle={toggleVeilStart} label="Start veiled" />
                ) : null
              }
            />
          </SettingsCard>
        </section>

        <section>
          <SectionLabel>Data</SectionLabel>
          <SettingsCard>
            <Row
              danger
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13" />
                </svg>
              }
              name="Destroy vault"
              description="erase ciphertext everywhere, forever, no undo"
              trailing={<Caret />}
              onClick={() => setDialog("destroy")}
            />
          </SettingsCard>
        </section>

        <section>
          <SectionLabel>About</SectionLabel>
          <SettingsCard>
            <Row
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8h.01M11 12h1v4h1" />
                </svg>
              }
              name="Version"
              description={hydrated ? `running at ${window.location.host}` : "running"}
              trailing={<span className="shrink-0 font-mono text-xs text-dim">v{APP_VERSION}</span>}
            />
            <Row
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M9 19c-4 1.5-5-1-5-1m10 3v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.8 11.8 0 0 0-6.2 0C5.6 3.8 4.6 4.1 4.6 4.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.2 10.5c0 4.6 2.7 5.7 5.5 6-.4.4-.6 1-.6 1.7V22" />
                </svg>
              }
              name="Source"
              description="read the code"
              trailing={<Caret />}
              onClick={() => window.open(SOURCE_URL, "_blank", "noopener,noreferrer")}
            />
            <Row
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                </svg>
              }
              name="Data sources"
              description="Data provided by CoinGecko"
              trailing={<Caret />}
              onClick={() => window.open(COINGECKO_URL, "_blank", "noopener,noreferrer")}
            />
          </SettingsCard>
        </section>
      </div>

      <ChangePasswordDialog
        open={dialog === "password"}
        onClose={closeDialog}
        username={user?.username}
      />
      <BiometricDialog
        open={dialog === "biometric"}
        onClose={closeDialog}
        phase={phase}
        message={bioMessage}
        onEnroll={handleEnroll}
        onDisable={handleDisable}
      />
      <PhraseCheckDialog
        open={dialog === "phrase"}
        onClose={closeDialog}
        username={user?.username}
      />
      <SignOutDialog open={dialog === "signout"} onClose={closeDialog} onSignOut={handleSignOut} />
      <DestroyDialog
        open={dialog === "destroy"}
        onClose={closeDialog}
        username={user?.username}
        onDestroyed={logout}
      />
    </Screen>
  );
}
