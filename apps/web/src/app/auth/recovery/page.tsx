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
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          Save your new recovery phrase
        </h1>

        <div
          role="alert"
          className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3"
        >
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Your old recovery phrase no longer works. Write down this new phrase now.
          </p>
        </div>

        {/* 4×3 numbered grid */}
        <fieldset className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <legend className="sr-only">Recovery phrase words</legend>
          <div className="grid grid-cols-4 gap-3">
            {numberedWords.map(({ word, num }) => (
              <div key={num} className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] text-neutral-400 dark:text-neutral-600">
                  {num}
                </span>
                <span className="font-mono text-sm font-medium text-neutral-900 dark:text-neutral-50 break-all">
                  {word}
                </span>
              </div>
            ))}
          </div>
        </fieldset>

        <p className="text-xs text-red-600 dark:text-red-400">
          This phrase will not be shown again.
        </p>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={newPhraseAcknowledged}
            onChange={(e) => setNewPhraseAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-neutral-400 accent-gold-600 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none"
          />
          <span className="text-sm text-neutral-700 dark:text-neutral-300">
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          Recover your account
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Use your 12-word recovery phrase to set a new master password.
        </p>
      </div>

      {banner && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3"
        >
          <p className="text-sm text-red-700 dark:text-red-300">{banner}</p>
        </div>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5" noValidate>
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
          placeholder="Username"
          error={usernameError}
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="recovery-phrase"
            className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
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
              "w-full rounded-lg border px-3 py-2.5 font-mono text-sm text-neutral-900 dark:text-neutral-50",
              "bg-white dark:bg-neutral-900",
              "placeholder:text-neutral-400 dark:placeholder:text-neutral-600",
              "resize-none transition-colors duration-150",
              "focus-visible:ring-2 focus-visible:outline-none",
              phraseError
                ? "border-red-500 focus-visible:ring-red-400"
                : phrase.length > 0 && phraseValid
                  ? "border-gold-500 focus-visible:ring-gold-400"
                  : "border-neutral-300 dark:border-neutral-700 focus-visible:ring-neutral-400",
            ].join(" ")}
          />
          {phraseError ? (
            <p id="phrase-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
              {phraseError}
            </p>
          ) : phrase.length > 0 && phraseValid ? (
            <p className="text-sm text-gold-600 dark:text-gold-400">Phrase looks valid.</p>
          ) : null}
        </div>

        <Input
          label="New master password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          placeholder="At least 12 characters"
          error={passwordError}
        />

        <Input
          label="Confirm new master password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          placeholder="Repeat your new password"
        />

        <Button type="submit" loading={pending} className="w-full">
          {pending ? "Recovering account…" : "Recover account"}
        </Button>
      </form>

      <p className="text-center text-sm text-neutral-500">
        <Link
          href="/auth/login"
          className="text-gold-600 dark:text-gold-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded"
        >
          Back to login
        </Link>
      </p>
    </div>
  );
}
