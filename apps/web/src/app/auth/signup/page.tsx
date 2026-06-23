"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthErrorBar } from "@/components/auth/AuthErrorBar";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { useErrorShake } from "@/components/auth/use-error-shake";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { deriveSignupCrypto } from "@/lib/auth-crypto";
import { useHydrated } from "@/lib/use-hydrated";
import { PASSWORD_MAX, USERNAME_MAX, validatePassword, validateUsername } from "@/lib/validation";
import { useAuth } from "@/providers/auth-context";

type FieldError = {
  username?: string;
  usernameTaken?: boolean;
  password?: string;
  inviteToken?: string;
  banner?: "network" | "disabled" | "generic";
};

type Stage = "form" | "phrase" | "verify";

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex justify-center gap-2 mb-[30px]">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`w-[6px] h-[6px] rounded-full ${i <= current ? "bg-accent" : "bg-[rgba(235,235,230,.14)]"}`}
        />
      ))}
    </div>
  );
}

const VERIFY_INDICES = [2, 6, 11] as const;

export default function SignupPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldError>({});
  const [errorSeq, setErrorSeq] = useState(0);
  const hydrated = useHydrated();
  const shaking = useErrorShake(errorSeq);

  const [stage, setStage] = useState<Stage>("form");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [phraseAcknowledged, setPhraseAcknowledged] = useState(false);
  const [verifyWords, setVerifyWords] = useState<[string, string, string]>(["", "", ""]);
  const [verifyError, setVerifyError] = useState(false);
  const [pendingLogin, setPendingLogin] = useState<
    | {
        userId: string;
        itemsKey: Parameters<ReturnType<typeof useAuth>["login"]>[0]["itemsKey"];
      }
    | undefined
  >(undefined);

  function raiseErrors(next: FieldError) {
    setErrors(next);
    setErrorSeq((n) => n + 1);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Re-entrancy guard: disabled is async, and a second submit must not fire a
    // duplicate signup or race the stage transition out of "form".
    if (pending || stage !== "form") return;
    setErrors({});

    const trimmedUsername = username.trim().toLowerCase();
    const usernameError = validateUsername(trimmedUsername);
    if (usernameError !== undefined) {
      raiseErrors({ username: usernameError });
      return;
    }
    const passwordError = validatePassword(password);
    if (passwordError !== undefined) {
      raiseErrors({ password: passwordError });
      return;
    }
    if (password !== confirm) {
      raiseErrors({ password: "Passwords do not match." });
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
      setStage("phrase");
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "username_taken" || e.status === 409) {
          raiseErrors({ username: "Username is already taken.", usernameTaken: true });
        } else if (e.code === "invalid_invite") {
          raiseErrors({
            inviteToken:
              "That invite is invalid, used, or expired. Ask whoever sent it for a fresh one.",
          });
        } else if (e.code === "allowlist_denied" || e.status === 403) {
          raiseErrors({ banner: "disabled" });
        } else if (e.status === 0) {
          raiseErrors({ banner: "network" });
        } else {
          raiseErrors({ banner: "generic" });
        }
      } else {
        raiseErrors({ banner: "generic" });
      }
    } finally {
      setPending(false);
    }
  }

  async function onContinue() {
    if (!pendingLogin) return;
    await login({
      user: { userId: pendingLogin.userId, username: username.trim().toLowerCase() },
      itemsKey: pendingLogin.itemsKey,
      persistence: "memory",
    });
    router.replace("/app/");
  }

  function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (phrase === null) return;
    const words = phrase.split(" ");
    const ok = VERIFY_INDICES.every((idx, i) => verifyWords[i].trim().toLowerCase() === words[idx]);
    if (!ok) {
      setVerifyError(true);
      setErrorSeq((n) => n + 1);
      return;
    }
    void onContinue();
  }

  if (stage === "verify" && phrase !== null) {
    return (
      <div className={`flex flex-col${shaking ? " auth-shake" : ""}`}>
        <StepDots current={3} />
        <h1 className="font-serif font-normal text-[34px] text-center tracking-[-0.01em] leading-[1.12]">
          Prove <em className="text-accent">it.</em>
        </h1>
        <p className="text-center text-dim text-[14px] mt-[10px]">
          Type words 3, 7, and 12 to confirm the phrase survived the trip to paper.
        </p>

        {verifyError && (
          <AuthErrorBar lead="Those words don&rsquo;t match.">
            Check the order and spelling, then try again.
          </AuthErrorBar>
        )}

        <form onSubmit={onVerify} className="flex flex-col mt-[26px]" noValidate>
          {VERIFY_INDICES.map((idx, i) => (
            <div key={idx} className={`flex flex-col gap-[9px]${i > 0 ? " mt-[26px]" : ""}`}>
              <label
                htmlFor={`verify-word-${idx}`}
                className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-faint"
              >
                Word {idx + 1}
              </label>
              <input
                id={`verify-word-${idx}`}
                type="text"
                value={verifyWords[i]}
                onChange={(e) => {
                  setVerifyError(false);
                  setVerifyWords((prev) => {
                    const next = [...prev] as [string, string, string];
                    next[i] = e.target.value;
                    return next;
                  });
                }}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={verifyError}
                className={[
                  "w-full bg-panel border rounded-[8px] text-cream font-mono text-[15px] px-4 py-[15px] outline-none transition-colors tracking-[0.06em]",
                  verifyError
                    ? "border-[rgba(208,133,98,.55)]"
                    : "border-line focus:border-accent-dim",
                ].join(" ")}
              />
            </div>
          ))}

          <button
            type="submit"
            className="w-full mt-[26px] font-mono text-[12px] tracking-[0.16em] uppercase bg-accent text-vault border-0 rounded-[8px] py-[17px] cursor-pointer transition-[background,opacity] hover:bg-cream"
          >
            Seal the vault
          </button>
        </form>

        <p className="text-center font-mono text-[11px] tracking-[0.04em] text-faint mt-[26px]">
          <button
            type="button"
            onClick={() => {
              setVerifyError(false);
              setStage("phrase");
            }}
            className="text-accent-dim no-underline hover:text-accent transition-colors cursor-pointer"
          >
            Back to the phrase
          </button>
        </p>
      </div>
    );
  }

  if (stage === "phrase" && phrase !== null) {
    const numberedWords = phrase.split(" ").map((word, i) => ({ word, num: i + 1 }));
    return (
      <div className="flex flex-col">
        <StepDots current={2} />
        <h1 className="font-serif font-normal text-[34px] text-center tracking-[-0.01em] leading-[1.12]">
          Your recovery <em className="text-accent">phrase.</em>
        </h1>
        <p className="text-center text-dim text-[14px] mt-[10px]">
          Twelve words. Write them on paper. This is the only spare key in existence.
        </p>

        <fieldset className="border-0 p-0 m-0">
          <legend className="sr-only">Recovery phrase words</legend>
          <div
            className="grid gap-[9px] mt-[28px]"
            style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
          >
            {numberedWords.map(({ word, num }) => (
              <div
                key={num}
                className="bg-panel border border-line rounded-[7px] px-[13px] py-[11px] font-mono text-[12.5px] flex gap-[9px] items-baseline"
              >
                <span className="text-faint text-[9.5px] w-[14px] flex-none">{num}</span>
                {word}
              </div>
            ))}
          </div>
        </fieldset>

        <div
          className="mt-[22px] border rounded-[8px] px-[17px] py-[15px] text-[12.5px] text-cream-soft leading-[1.6]"
          style={{ borderColor: "rgba(200,85,31,.3)", background: "rgba(200,85,31,.06)" }}
        >
          <strong className="text-signal font-medium">No screenshots.</strong> Anyone with these
          words owns your data. Lose them and your password, and you can&rsquo;t get back in.
        </div>

        <label className="flex gap-[11px] items-start mt-5 cursor-pointer text-[13px] text-cream-soft">
          <input
            type="checkbox"
            checked={phraseAcknowledged}
            onChange={(e) => setPhraseAcknowledged(e.target.checked)}
            className="mt-[3px] accent-accent"
          />
          <span>I wrote the phrase down, on paper, somewhere safe.</span>
        </label>

        <button
          type="button"
          onClick={() => setStage("verify")}
          disabled={!phraseAcknowledged}
          className="w-full mt-[26px] font-mono text-[12px] tracking-[0.16em] uppercase bg-accent text-vault border-0 rounded-[8px] py-[17px] cursor-pointer transition-[background,opacity] hover:bg-cream disabled:opacity-40 disabled:cursor-not-allowed"
        >
          I have it. Continue
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col${shaking ? " auth-shake" : ""}`}>
      <StepDots current={1} />
      <h1 className="font-serif font-normal text-[34px] text-center tracking-[-0.01em] leading-[1.12]">
        Forge your <em className="text-accent">vault.</em>
      </h1>
      <p className="text-center text-dim text-[14px] mt-[10px]">
        Pick a username and a master password.
      </p>

      {errors.banner === "network" && (
        <AuthErrorBar lead="Can&rsquo;t reach your vault host.">
          Check the connection and try again. Nothing you typed left this device.
        </AuthErrorBar>
      )}
      {errors.banner === "disabled" && (
        <AuthErrorBar lead="Signups are paused.">
          New vaults are not being created right now.
        </AuthErrorBar>
      )}
      {errors.banner === "generic" && <AuthErrorBar lead="Signup failed.">Try again.</AuthErrorBar>}

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col mt-[26px]" noValidate>
        <div className="flex flex-col gap-[9px]">
          <label
            htmlFor="signup-username"
            className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-faint"
          >
            Username
          </label>
          <input
            id="signup-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={USERNAME_MAX}
            placeholder="alice"
            aria-invalid={errors.username !== undefined}
            aria-describedby={errors.username !== undefined ? "signup-username-error" : undefined}
            className={[
              "w-full bg-panel border rounded-[8px] text-cream font-mono text-[15px] px-4 py-[15px] outline-none transition-colors tracking-[0.06em] placeholder:text-faint placeholder:tracking-[0.02em]",
              errors.username
                ? "border-[rgba(208,133,98,.55)]"
                : "border-line focus:border-accent-dim",
            ].join(" ")}
          />
          {errors.usernameTaken ? (
            <p
              id="signup-username-error"
              role="alert"
              className="font-mono text-[10px] text-down tracking-[0.04em]"
            >
              taken &middot; usernames are first come, first served
            </p>
          ) : errors.username ? (
            <p
              id="signup-username-error"
              role="alert"
              className="font-mono text-[10px] text-down tracking-[0.04em]"
            >
              {errors.username}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-[9px] mt-[26px]">
          <label
            htmlFor="signup-password"
            className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-faint"
          >
            Master password
          </label>
          <input
            id="signup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            placeholder="long and memorable beats short and clever"
            aria-invalid={errors.password !== undefined}
            aria-describedby={errors.password !== undefined ? "signup-password-error" : undefined}
            className={[
              "w-full bg-panel border rounded-[8px] text-cream font-mono text-[15px] px-4 py-[15px] outline-none transition-colors tracking-[0.06em] placeholder:text-faint placeholder:tracking-[0.02em]",
              errors.password
                ? "border-[rgba(208,133,98,.55)]"
                : "border-line focus:border-accent-dim",
            ].join(" ")}
          />
          <PasswordStrength password={password} />
          {errors.password ? (
            <p
              id="signup-password-error"
              role="alert"
              className="font-mono text-[10px] text-down tracking-[0.04em]"
            >
              {errors.password}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-[9px] mt-[26px]">
          <label
            htmlFor="signup-confirm"
            className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-faint"
          >
            Confirm master password
          </label>
          <input
            id="signup-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            className="w-full bg-panel border border-line focus:border-accent-dim rounded-[8px] text-cream font-mono text-[15px] px-4 py-[15px] outline-none transition-colors tracking-[0.06em]"
          />
        </div>

        <div className="flex flex-col gap-[9px] mt-[26px]">
          <label
            htmlFor="signup-invite"
            className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-faint"
          >
            Invite code
          </label>
          <input
            id="signup-invite"
            type="text"
            value={inviteToken}
            onChange={(e) => setInviteToken(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="PRV-XXXX-XXXX"
            aria-invalid={errors.inviteToken !== undefined}
            aria-describedby={errors.inviteToken !== undefined ? "signup-invite-error" : undefined}
            className={[
              "w-full bg-panel border rounded-[8px] text-cream font-mono text-[15px] px-4 py-[15px] outline-none transition-colors tracking-[0.06em] placeholder:text-faint placeholder:tracking-[0.02em]",
              errors.inviteToken
                ? "border-[rgba(208,133,98,.55)]"
                : "border-line focus:border-accent-dim",
            ].join(" ")}
          />
          <p className="font-mono text-[10px] text-faint tracking-[0.04em]">
            invite&#8209;only for now &middot; self&#8209;hosters skip this
          </p>
          {errors.inviteToken && (
            <p
              id="signup-invite-error"
              role="alert"
              className="font-mono text-[10px] text-down tracking-[0.04em]"
            >
              {errors.inviteToken}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={!hydrated || pending}
          aria-busy={pending}
          className="w-full mt-[26px] font-mono text-[12px] tracking-[0.16em] uppercase bg-accent text-vault border-0 rounded-[8px] py-[17px] cursor-pointer transition-[background,opacity] hover:bg-cream disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Creating account…" : "Continue"}
        </button>
      </form>

      <p className="text-center font-mono text-[11px] tracking-[0.04em] text-faint mt-[26px]">
        Already vaulted?{" "}
        <Link
          href="/auth/login"
          className="text-accent-dim no-underline hover:text-accent transition-colors"
        >
          Unlock instead
        </Link>
      </p>
    </div>
  );
}
