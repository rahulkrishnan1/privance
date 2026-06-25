"use client";

import { countRecognizedWords, validatePhrase } from "@privance/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthErrorBar } from "@/components/auth/AuthErrorBar";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { useErrorShake } from "@/components/auth/use-error-shake";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import {
  DecryptionError,
  deriveNewCredsAfterRecovery,
  deriveRecoveryProof,
  deriveRecoveryUnwrap,
} from "@/lib/auth-crypto";
import { useHydrated } from "@/lib/use-hydrated";
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
  const [phraseError, setPhraseError] = useState(false);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [usernameError, setUsernameError] = useState<string | undefined>(undefined);
  const [banner, setBanner] = useState<"limit" | "net" | "generic" | undefined>(undefined);
  const [errorSeq, setErrorSeq] = useState(0);
  const hydrated = useHydrated();
  const shaking = useErrorShake(errorSeq);

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
  const recognizedCount = countRecognizedWords(phrase);

  function raisePhraseError() {
    setPhraseError(true);
    setErrorSeq((n) => n + 1);
  }

  function raiseBanner(kind: "limit" | "net" | "generic") {
    setBanner(kind);
    setErrorSeq((n) => n + 1);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Re-entrancy guard: a second submit would fire recoveryReset again against
    // already-rotated server state and 401 over the success screen.
    if (pending) return;
    setPhraseError(false);
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
      raisePhraseError();
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
          wrappedDekRecovery: recoveryParams.wrapped_dek_recovery,
          wrappedDekRecoveryIv: recoveryParams.wrapped_dek_recovery_iv,
        });
      } catch (e) {
        if (e instanceof DecryptionError) {
          raisePhraseError();
          return;
        }
        throw e;
      }

      const recoveryProof = await deriveRecoveryProof({
        phrase: normalizedPhrase,
        recoverySalt: recoveryParams.recovery_salt,
      });

      const newCreds = await deriveNewCredsAfterRecovery({ newPassword, itemsKey });

      // Known limitation: this reset is single-phase. Once recoveryReset commits,
      // the old phrase is void server-side and the new phrase (newCreds.newPhrase)
      // lives only in React state until the user acknowledges it on the next step.
      // Closing the tab here leaves the account with no valid recovery phrase until
      // the user re-derives one. The durable fix (regenerate recovery phrase from a
      // signed-in session) is tracked for the Settings rebuild, not the auth flow.
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
          raisePhraseError();
        } else if (e.status === 429) {
          raiseBanner("limit");
        } else if (e.status === 0) {
          raiseBanner("net");
        } else {
          raiseBanner("generic");
        }
      } else {
        raiseBanner("generic");
      }
    } finally {
      setPending(false);
    }
  }

  async function onContinue() {
    if (!pendingLogin || !newPhraseAcknowledged) return;
    await login({
      user: { userId: pendingLogin.userId, username: pendingLogin.usernameValue },
      itemsKey: pendingLogin.itemsKey,
      persistence: "memory",
    });
    router.replace("/app/");
  }

  if (step === "new-phrase" && newPhrase !== null && pendingLogin !== undefined) {
    const numberedWords = newPhrase.split(" ").map((word, i) => ({ word, num: i + 1 }));
    return (
      <div className="flex flex-col">
        <div className="w-[74px] h-[74px] rounded-full border border-accent-dim mx-auto mb-[30px] flex items-center justify-center text-accent relative">
          <span className="absolute inset-[6px] border border-dashed border-[rgba(127,196,198,.3)] rounded-full" />
          <svg
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
        </div>

        <h1 className="font-serif font-normal text-5xl text-center tracking-[-0.01em] leading-[1.12]">
          A new spare <em className="text-accent">key.</em>
        </h1>
        <p className="text-center text-dim text-sm mt-[10px]">
          Recovery worked, and burned the old phrase. These twelve words replace it.
        </p>

        <div
          className="mt-6 border rounded-[8px] px-[17px] py-[15px] text-sm text-cream-soft leading-[1.6]"
          style={{ borderColor: "rgba(127,196,198,.3)", background: "rgba(127,196,198,.05)" }}
        >
          <strong className="text-accent font-medium">Your old phrase is void.</strong> It can never
          open this vault again. Only the words below can.
        </div>

        <fieldset className="border-0 p-0 m-0">
          <legend className="sr-only">New recovery phrase words</legend>
          <div
            className="grid gap-[9px] mt-[28px]"
            style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
          >
            {numberedWords.map(({ word, num }) => (
              <div
                key={num}
                className="bg-panel border border-line rounded-[7px] px-[13px] py-[11px] font-mono text-sm flex gap-[9px] items-baseline"
              >
                <span className="text-faint text-xs w-[14px] flex-none">{num}</span>
                {word}
              </div>
            ))}
          </div>
        </fieldset>

        <label className="flex gap-[11px] items-start mt-5 cursor-pointer text-sm text-cream-soft">
          <input
            type="checkbox"
            checked={newPhraseAcknowledged}
            onChange={(e) => setNewPhraseAcknowledged(e.target.checked)}
            className="mt-[3px] accent-accent"
          />
          <span>I replaced the paper. The old phrase is in the shredder.</span>
        </label>

        <button
          type="button"
          onClick={() => void onContinue()}
          disabled={!newPhraseAcknowledged}
          className="w-full mt-[26px] font-mono text-xs tracking-button uppercase bg-accent text-vault border-0 rounded-[8px] py-[17px] cursor-pointer transition-[background,opacity] hover:bg-cream disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Enter the vault
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col${shaking ? " auth-shake" : ""}`}>
      <div className="w-[74px] h-[74px] rounded-full border border-accent-dim mx-auto mb-[30px] flex items-center justify-center text-accent relative">
        <span className="absolute inset-[6px] border border-dashed border-[rgba(127,196,198,.3)] rounded-full" />
        <svg
          viewBox="0 0 24 24"
          width="26"
          height="26"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
        </svg>
      </div>

      <h1 className="font-serif font-normal text-5xl text-center tracking-[-0.01em] leading-[1.12]">
        Recover with <em className="text-accent">phrase.</em>
      </h1>
      <p className="text-center text-dim text-sm mt-[10px]">
        Enter your 12 words in order, then set a new master password.
      </p>

      {phraseError && (
        <AuthErrorBar lead="Those words don&rsquo;t derive the key.">
          Check the order and spelling of all 12. The phrase is unforgiving on purpose.
        </AuthErrorBar>
      )}
      {banner === "limit" && (
        <AuthErrorBar lead="The lock is cooling down.">
          Too many attempts. Try again in a moment.
        </AuthErrorBar>
      )}
      {banner === "net" && (
        <AuthErrorBar lead="Can&rsquo;t reach your vault host.">
          Check the connection and try again. Nothing you typed left this device.
        </AuthErrorBar>
      )}
      {banner === "generic" && <AuthErrorBar lead="Recovery failed.">Try again.</AuthErrorBar>}

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col mt-[26px]" noValidate>
        <div className="flex flex-col gap-[9px]">
          <label
            htmlFor="recovery-username"
            className="font-mono text-xs tracking-label uppercase text-faint"
          >
            Username
          </label>
          <input
            id="recovery-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={USERNAME_MAX}
            aria-invalid={usernameError !== undefined}
            aria-describedby={usernameError !== undefined ? "recovery-username-error" : undefined}
            className={[
              "w-full bg-panel border rounded-[8px] text-cream font-mono text-base px-4 py-[15px] outline-none transition-colors tracking-[0.06em] placeholder:text-faint placeholder:tracking-[0.02em]",
              usernameError
                ? "border-[rgba(208,133,98,.55)]"
                : "border-line focus:border-accent-dim",
            ].join(" ")}
          />
          {usernameError && (
            <p
              id="recovery-username-error"
              role="alert"
              className="font-mono text-xs text-down tracking-[0.04em]"
            >
              {usernameError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-[9px] mt-[26px]">
          <label
            htmlFor="recovery-phrase"
            className="font-mono text-xs tracking-label uppercase text-faint"
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
            placeholder="word word word ..."
            aria-invalid={phraseError}
            className={[
              "w-full bg-panel border rounded-[8px] text-cream font-mono text-base px-4 py-[15px] outline-none transition-colors tracking-[0.04em] placeholder:text-faint placeholder:tracking-[0.02em] resize-y min-h-[84px] leading-[1.7]",
              phraseError
                ? "border-[rgba(208,133,98,.55)]"
                : phrase.length > 0 && phraseValid
                  ? "border-accent-dim"
                  : "border-line focus:border-accent-dim",
            ].join(" ")}
          />
          {phrase.trim().length > 0 && (
            <p
              className={[
                "font-mono text-xs tracking-[0.04em]",
                recognizedCount === 12 ? "text-accent-dim" : "text-faint",
              ].join(" ")}
            >
              {recognizedCount} of 12 words recognized
            </p>
          )}
        </div>

        <div className="flex flex-col gap-[9px] mt-[26px]">
          <label
            htmlFor="recovery-newpassword"
            className="font-mono text-xs tracking-label uppercase text-faint"
          >
            New master password
          </label>
          <input
            id="recovery-newpassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            placeholder="a fresh one, not the forgotten one"
            aria-invalid={passwordError !== undefined}
            aria-describedby={passwordError !== undefined ? "recovery-password-error" : undefined}
            className={[
              "w-full bg-panel border rounded-[8px] text-cream font-mono text-base px-4 py-[15px] outline-none transition-colors tracking-[0.06em] placeholder:text-faint placeholder:tracking-[0.02em]",
              passwordError
                ? "border-[rgba(208,133,98,.55)]"
                : "border-line focus:border-accent-dim",
            ].join(" ")}
          />
          <PasswordStrength password={newPassword} />
          {passwordError && (
            <p
              id="recovery-password-error"
              role="alert"
              className="font-mono text-xs text-down tracking-[0.04em]"
            >
              {passwordError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-[9px] mt-[26px]">
          <label
            htmlFor="recovery-confirmpassword"
            className="font-mono text-xs tracking-label uppercase text-faint"
          >
            Confirm new master password
          </label>
          <input
            id="recovery-confirmpassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            className="w-full bg-panel border border-line focus:border-accent-dim rounded-[8px] text-cream font-mono text-base px-4 py-[15px] outline-none transition-colors tracking-[0.06em]"
          />
        </div>

        <button
          type="submit"
          disabled={!hydrated || pending}
          aria-busy={pending}
          className="w-full mt-[26px] font-mono text-xs tracking-button uppercase bg-accent text-vault border-0 rounded-[8px] py-[17px] cursor-pointer transition-[background,opacity] hover:bg-cream disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Recovering account…" : "Derive new keys & continue"}
        </button>
      </form>

      <p className="text-center font-mono text-xs tracking-[0.04em] text-faint mt-[26px]">
        <Link
          href="/auth/login"
          className="text-accent-dim no-underline hover:text-accent transition-colors"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
