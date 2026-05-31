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
          setErrors({
            password:
              "This password has appeared in a public data breach. Please choose a different one.",
          });
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

  if (phrase !== null && pendingLogin !== undefined) {
    const numberedWords = phrase.split(" ").map((word, i) => ({ word, num: i + 1 }));
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1
            className="font-serif text-[32px] leading-tight font-light tracking-[-0.015em] text-app-text"
            style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
          >
            Write down your{" "}
            <span className="font-editorial italic text-gold-accent">recovery phrase.</span>
          </h1>
          <p className="text-[14px] text-app-muted">
            These 12 words are the only way to recover your account if you forget your master
            password. Store them somewhere safe and offline. Do not share them.
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

        <p className="text-[12px] text-app-red">
          This phrase will not be shown again. Write it down before continuing.
        </p>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={phraseAcknowledged}
            onChange={(e) => setPhraseAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-app-line accent-gold-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit]"
          />
          <span className="text-[14px] text-app-text">
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
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-gold-accent">
          Invite-only beta
        </span>
        <h1
          className="font-serif text-[32px] leading-tight font-light tracking-[-0.015em] text-app-text"
          style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
        >
          Create your <span className="font-editorial italic text-gold-accent">account.</span>
        </h1>
        <p className="text-[14px] text-app-muted">
          Your master password is the only key. Save it carefully.
        </p>
      </div>

      {errors.banner && (
        <div role="alert" className="rounded-lg border border-app-red/40 bg-app-red/10 px-4 py-3">
          <p className="text-[13px] text-app-red">{errors.banner}</p>
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
          error={errors.username}
        />

        <Input
          label="Master password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          error={errors.password}
        />

        <Input
          label="Confirm master password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
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
          error={errors.inviteToken}
        />

        <Button type="submit" loading={pending} className="w-full mt-2">
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="text-center font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
        Already have an account?{" "}
        <Link
          href="/auth/login"
          className="inline-block py-3 px-2 -my-3 -mx-2 hover:text-app-text transition-colors focus-visible:outline-none focus-visible:text-gold-accent"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
