"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { deriveSignupCrypto } from "@/lib/auth-crypto";
import { PASSWORD_MAX, USERNAME_MAX, validatePassword, validateUsername } from "@/lib/validation";
import { useAuth } from "@/providers/auth-context";

type FieldError = {
  username?: string;
  password?: string;
  inviteToken?: string;
  banner?: string;
};

export default function SignupPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldError>({});

  const [phrase, setPhrase] = useState<string | null>(null);
  const [phraseAcknowledged, setPhraseAcknowledged] = useState(false);
  const [pendingLogin, setPendingLogin] = useState<
    | {
        userId: string;
        itemsKey: Parameters<ReturnType<typeof useAuth>["login"]>[0]["itemsKey"];
      }
    | undefined
  >(undefined);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const trimmedUsername = username.trim().toLowerCase();
    const usernameError = validateUsername(trimmedUsername);
    if (usernameError !== undefined) {
      setErrors({ username: usernameError });
      return;
    }
    const passwordError = validatePassword(password);
    if (passwordError !== undefined) {
      setErrors({ password: passwordError });
      return;
    }
    if (password !== confirm) {
      setErrors({ password: "Passwords do not match." });
      return;
    }

    setPending(true);
    try {
      const trimmedInvite = inviteToken.trim();
      const crypto = await deriveSignupCrypto({ password });
      const result = await authApi.signup({
        username: trimmedUsername,
        auth_hash: crypto.authHash,
        kdf_salt: crypto.kdfSalt,
        kdf_params: crypto.kdfParams,
        recovery_blob: crypto.recoveryBlob,
        recovery_salt: crypto.recoverySalt,
        recovery_params: crypto.recoveryParams,
        wrapped_dek: crypto.wrappedDek,
        wrapped_dek_iv: crypto.wrappedDekIv,
        wrapped_dek_recovery: crypto.wrappedDekRecovery,
        wrapped_dek_recovery_iv: crypto.wrappedDekRecoveryIv,
        ...(trimmedInvite ? { invite_token: trimmedInvite } : {}),
      });

      setPhrase(crypto.phrase);
      setPendingLogin({ userId: result.user_id, itemsKey: crypto.itemsKey });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "username_taken" || e.status === 409) {
          setErrors({ username: "Username is already taken." });
        } else if (e.code === "weak_password" || e.status === 422) {
          setErrors({ password: "Password is too weak or appears in known breach lists." });
        } else if (e.code === "hibp_unavailable" || e.status === 503) {
          setErrors({ banner: "Password breach check unavailable. Try again." });
        } else if (e.code === "invalid_invite") {
          setErrors({
            inviteToken:
              "That invite is invalid, used, or expired. Ask whoever sent it for a fresh one.",
          });
        } else if (e.code === "allowlist_denied" || e.status === 403) {
          setErrors({ banner: "Signups are currently disabled." });
        } else if (e.status === 0) {
          setErrors({ banner: "Network error. Check your connection and try again." });
        } else {
          setErrors({ banner: "Signup failed. Try again." });
        }
      } else {
        setErrors({ banner: "Signup failed. Try again." });
      }
    } finally {
      setPending(false);
    }
  }

  function onContinue() {
    if (!pendingLogin || !phraseAcknowledged) return;
    login({
      user: { userId: pendingLogin.userId, username: username.trim().toLowerCase() },
      itemsKey: pendingLogin.itemsKey,
      persistence: "memory",
    });
    router.replace("/app/");
  }

  // Phrase acknowledgement screen
  if (phrase !== null && pendingLogin !== undefined) {
    const numberedWords = phrase.split(" ").map((word, i) => ({ word, num: i + 1 }));
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            Write down your recovery phrase
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            These 12 words are the only way to recover your account if you forget your master
            password. Store them somewhere safe and offline. Do not share them.
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
          This phrase will not be shown again. Write it down before continuing.
        </p>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={phraseAcknowledged}
            onChange={(e) => setPhraseAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-neutral-400 accent-gold-600 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none"
          />
          <span className="text-sm text-neutral-700 dark:text-neutral-300">
            I have written down my recovery phrase in a safe place.
          </span>
        </label>

        <Button
          type="button"
          onClick={onContinue}
          disabled={!phraseAcknowledged}
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
          Create your account
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Your master password is the only key to your data. There is no reset, only your recovery
          phrase can restore access.
        </p>
      </div>

      {errors.banner && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3"
        >
          <p className="text-sm text-red-700 dark:text-red-300">{errors.banner}</p>
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
          error={errors.username}
        />

        <Input
          label="Master password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          placeholder="At least 12 characters"
          error={errors.password}
        />

        <Input
          label="Confirm master password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          placeholder="Repeat your password"
        />

        <Input
          label="Invite code"
          type="text"
          value={inviteToken}
          onChange={(e) => setInviteToken(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Paste your invite code if you have one"
          error={errors.inviteToken}
        />

        <Button type="submit" loading={pending} className="w-full">
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="text-center text-sm text-neutral-500">
        Already have an account?{" "}
        <Link
          href="/auth/login"
          className="text-gold-600 dark:text-gold-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
