"use client";

import { validatePhrase } from "@privance/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import {
  DecryptionError,
  deriveNewCredsAfterRecovery,
  deriveRecoveryProof,
  deriveRecoveryUnwrap,
} from "@/lib/auth-crypto";
import { PASSWORD_MAX, USERNAME_MAX, validatePassword, validateUsername } from "@/lib/validation";
import { useAuth } from "@/providers/auth-context";

type Step = "form" | "new-phrase";

export default function RecoveryPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [phrase, setPhrase] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [phraseError, setPhraseError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [usernameError, setUsernameError] = useState<string | undefined>(undefined);
  const [banner, setBanner] = useState<string | undefined>(undefined);

  const [step, setStep] = useState<Step>("form");
  const [newPhrase, setNewPhrase] = useState<string | null>(null);
  const [newPhraseAcknowledged, setNewPhraseAcknowledged] = useState(false);
  const [pendingLogin, setPendingLogin] = useState<
    | {
        userId: string;
        itemsKey: Parameters<ReturnType<typeof useAuth>["login"]>[0]["itemsKey"];
        usernameValue: string;
      }
    | undefined
  >(undefined);

  const normalizedPhrase = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  const phraseValid = validatePhrase(normalizedPhrase);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhraseError(undefined);
    setPasswordError(undefined);
    setUsernameError(undefined);
    setBanner(undefined);

    const trimmedUsername = username.trim().toLowerCase();
    const usernameValidationError = validateUsername(trimmedUsername);
    if (usernameValidationError !== undefined) {
      setUsernameError(usernameValidationError);
      return;
    }
    if (!phraseValid) {
      setPhraseError("Invalid recovery phrase. Check all 12 words and try again.");
      return;
    }
    const passwordValidationError = validatePassword(newPassword);
    if (passwordValidationError !== undefined) {
      setPasswordError(passwordValidationError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setPending(true);
    try {
      const recoveryParams = await authApi.recoveryDeriveParams(trimmedUsername);

      let itemsKey: Awaited<ReturnType<typeof deriveRecoveryUnwrap>>;
      try {
        itemsKey = await deriveRecoveryUnwrap({
          phrase: normalizedPhrase,
          recoverySalt: recoveryParams.recovery_salt,
          recoveryKdfParams: recoveryParams.recovery_params,
          wrappedDekRecovery: recoveryParams.wrapped_dek_recovery,
          wrappedDekRecoveryIv: recoveryParams.wrapped_dek_recovery_iv,
        });
      } catch (e) {
        if (e instanceof DecryptionError) {
          setPhraseError("Invalid recovery phrase.");
          return;
        }
        throw e;
      }

      const recoveryProof = await deriveRecoveryProof({
        phrase: normalizedPhrase,
        recoverySalt: recoveryParams.recovery_salt,
        recoveryKdfParams: recoveryParams.recovery_params,
      });

      const newCreds = await deriveNewCredsAfterRecovery({ newPassword, itemsKey });

      const resetResult = await authApi.recoveryReset({
        username: trimmedUsername,
        recovery_proof: recoveryProof,
        new_auth_hash: newCreds.newAuthHash,
        new_kdf_salt: newCreds.newKdfSalt,
        new_kdf_params: newCreds.newKdfParams,
        new_recovery_blob: newCreds.newRecoveryBlob,
        new_recovery_salt: newCreds.newRecoverySalt,
        new_recovery_params: newCreds.newRecoveryParams,
        new_wrapped_dek: newCreds.newWrappedDek,
        new_wrapped_dek_iv: newCreds.newWrappedDekIv,
        new_wrapped_dek_recovery: newCreds.newWrappedDekRecovery,
        new_wrapped_dek_recovery_iv: newCreds.newWrappedDekRecoveryIv,
      });

      setNewPhrase(newCreds.newPhrase);
      setPendingLogin({ userId: resetResult.user_id, itemsKey, usernameValue: trimmedUsername });
      setStep("new-phrase");
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) {
          setPhraseError("Recovery phrase is invalid or does not match this account.");
        } else if (e.status === 429) {
          setBanner("Too many recovery attempts. Try again later.");
        } else if (e.status === 0) {
          setBanner("Network error. Check your connection and try again.");
        } else {
          setBanner("Recovery failed. Try again.");
        }
      } else {
        setBanner("Recovery failed. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  function onContinue() {
    if (!pendingLogin || !newPhraseAcknowledged) return;
    login({
      user: { userId: pendingLogin.userId, username: pendingLogin.usernameValue },
      itemsKey: pendingLogin.itemsKey,
      persistence: "memory",
    });
    router.replace("/app/");
  }

  if (step === "new-phrase" && newPhrase !== null && pendingLogin !== undefined) {
    const numberedWords = newPhrase.split(" ").map((word, i) => ({ word, num: i + 1 }));
    return (
      <div className="flex flex-col gap-8">
        <h1
          className="font-serif text-[32px] leading-tight font-light tracking-[-0.015em] text-app-text"
          style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
        >
          Save your new{" "}
          <span className="font-editorial italic text-gold-accent">recovery phrase.</span>
        </h1>

        <div
          role="alert"
          className="rounded-lg border border-gold-accent/30 bg-gold-accent/[0.06] px-4 py-3"
        >
          <p className="text-[13px] text-gold-accent">
            Your old recovery phrase no longer works. Write down this new phrase now.
          </p>
        </div>

        <fieldset className="rounded-xl border border-app-line bg-app-panel p-5">
          <legend className="sr-only">Recovery phrase words</legend>
          <div className="grid grid-cols-4 gap-3">
            {numberedWords.map(({ word, num }) => (
              <div key={num} className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] text-app-dim">{num}</span>
                <span className="font-mono text-[13px] text-app-text break-all">{word}</span>
              </div>
            ))}
          </div>
        </fieldset>

        <p className="text-[12px] text-app-red">This phrase will not be shown again.</p>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={newPhraseAcknowledged}
            onChange={(e) => setNewPhraseAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-app-line accent-gold-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit]"
          />
          <span className="text-[14px] text-app-text">
            I have written down my new recovery phrase in a safe place.
          </span>
        </label>

        <Button
          type="button"
          onClick={onContinue}
          disabled={!newPhraseAcknowledged}
          className="w-full"
        >
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1
          className="font-serif text-[32px] leading-tight font-light tracking-[-0.015em] text-app-text"
          style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
        >
          Recover your <span className="font-editorial italic text-gold-accent">account.</span>
        </h1>
        <p className="text-[14px] text-app-muted">
          Use your 12-word recovery phrase to set a new master password.
        </p>
      </div>

      {banner && (
        <div role="alert" className="rounded-lg border border-app-red/40 bg-app-red/10 px-4 py-3">
          <p className="text-[13px] text-app-red">{banner}</p>
        </div>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-6" noValidate>
        <Input
          label="Username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={USERNAME_MAX}
          error={usernameError}
        />

        <div className="flex flex-col gap-2">
          <label
            htmlFor="recovery-phrase"
            className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim"
          >
            Recovery phrase (12 words)
          </label>
          <textarea
            id="recovery-phrase"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            rows={3}
            maxLength={200}
            placeholder="word1 word2 word3 …"
            aria-invalid={phraseError !== undefined}
            aria-describedby={phraseError !== undefined ? "phrase-error" : undefined}
            className={[
              "w-full bg-transparent border-b px-1 py-2.5 font-mono text-sm text-app-text",
              "placeholder:text-app-dim/70 resize-none transition-colors duration-150",
              "focus:outline-none",
              phraseError
                ? "border-app-red"
                : phrase.length > 0 && phraseValid
                  ? "border-gold-accent"
                  : "border-app-line focus:border-gold-accent",
            ].join(" ")}
          />
          {phraseError ? (
            <p id="phrase-error" role="alert" className="text-[13px] text-app-red">
              {phraseError}
            </p>
          ) : phrase.length > 0 && phraseValid ? (
            <p className="text-[13px] text-gold-accent">Phrase looks valid.</p>
          ) : null}
        </div>

        <Input
          label="New master password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          error={passwordError}
        />

        <Input
          label="Confirm new master password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
        />

        <Button type="submit" loading={pending} className="w-full mt-2">
          {pending ? "Recovering account…" : "Recover account"}
        </Button>
      </form>

      <p className="text-center font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
        <Link
          href="/auth/login"
          className="hover:text-app-text transition-colors focus-visible:outline-none focus-visible:text-gold-accent"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
