"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthErrorBar } from "@/components/auth/AuthErrorBar";
import { useErrorShake } from "@/components/auth/use-error-shake";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { deriveLoginCrypto, unwrapDek } from "@/lib/auth-crypto";
import { useHydrated } from "@/lib/use-hydrated";
import { PASSWORD_MAX, USERNAME_MAX } from "@/lib/validation";
import { useAuth } from "@/providers/auth-context";

type LoginBanner =
  | { kind: "wrong" }
  | { kind: "limit" }
  | { kind: "net" }
  | { kind: "generic" }
  | undefined;

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LoginBanner>(undefined);
  const [errorSeq, setErrorSeq] = useState(0);
  const hydrated = useHydrated();
  const shaking = useErrorShake(errorSeq);

  function raiseError(next: NonNullable<LoginBanner>) {
    setError(next);
    setErrorSeq((n) => n + 1);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The disabled attribute is a UX hint, not a concurrency guard: state updates
    // are async, so a fast double-submit can re-enter before the button disables.
    if (pending) return;
    setError(undefined);

    const trimmedUsername = username.trim().toLowerCase();
    if (!trimmedUsername || !password) return;

    setPending(true);
    try {
      const kdfRes = await authApi.kdfParams(trimmedUsername);
      const { authHash, kek, kdfParamVersion } = await deriveLoginCrypto({
        password,
        kdfSalt: kdfRes.kdf_salt,
      });

      const loginRes = await authApi.login({ username: trimmedUsername, auth_hash: authHash });

      const itemsKey = unwrapDek({
        wrappedDek: loginRes.wrapped_dek,
        wrappedDekIv: loginRes.wrapped_dek_iv,
        kek,
        kdfParamVersion,
      });

      await login({
        user: { userId: loginRes.user_id, username: trimmedUsername },
        itemsKey,
        persistence: "memory",
      });
      router.replace("/app/");
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401 || e.status === 404) {
          raiseError({ kind: "wrong" });
        } else if (e.status === 429) {
          raiseError({ kind: "limit" });
        } else if (e.status === 0) {
          raiseError({ kind: "net" });
        } else {
          raiseError({ kind: "generic" });
        }
      } else {
        raiseError({ kind: "generic" });
      }
    } finally {
      setPending(false);
    }
  }

  const credInvalid = error?.kind === "wrong";
  const rateLimited = error?.kind === "limit";

  return (
    <div className={`flex flex-col gap-0${shaking ? " auth-shake" : ""}`}>
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
          <circle cx="8" cy="14" r="4" />
          <path d="M11 11 20 2m-3 3 3 3" />
        </svg>
      </div>

      <h1 className="font-serif font-normal text-5xl text-center tracking-[-0.01em] leading-[1.12]">
        Unlock your <em className="text-accent">vault.</em>
      </h1>

      {error?.kind === "wrong" && (
        <AuthErrorBar lead="That key didn&rsquo;t turn.">
          Wrong password. Forgot it? Your recovery phrase still works.
        </AuthErrorBar>
      )}
      {error?.kind === "limit" && (
        <AuthErrorBar lead="The lock is cooling down.">
          Too many attempts. Try again in a moment.
        </AuthErrorBar>
      )}
      {error?.kind === "net" && (
        <AuthErrorBar lead="Can&rsquo;t reach your vault host.">
          Check the connection and try again. Nothing you typed left this device.
        </AuthErrorBar>
      )}
      {error?.kind === "generic" && <AuthErrorBar lead="Sign in failed.">Try again.</AuthErrorBar>}

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col mt-[26px]" noValidate>
        <div className="flex flex-col gap-[9px]">
          <label
            htmlFor="login-username"
            className="font-mono text-xs tracking-label uppercase text-faint"
          >
            Username
          </label>
          <input
            id="login-username"
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value.toLowerCase());
              setError(undefined);
            }}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={USERNAME_MAX}
            aria-invalid={credInvalid}
            className={[
              "w-full bg-panel border rounded-[8px] text-cream font-mono text-base px-4 py-[15px] outline-none transition-colors tracking-[0.06em]",
              credInvalid ? "border-[rgba(208,133,98,.55)]" : "border-line focus:border-accent-dim",
            ].join(" ")}
          />
        </div>

        <div className="flex flex-col gap-[9px] mt-[26px]">
          <label
            htmlFor="login-password"
            className="font-mono text-xs tracking-label uppercase text-faint"
          >
            Master password
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(undefined);
            }}
            autoComplete="current-password"
            maxLength={PASSWORD_MAX}
            placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
            aria-invalid={credInvalid}
            className={[
              "w-full bg-panel border rounded-[8px] text-cream font-mono text-base px-4 py-[15px] outline-none transition-colors tracking-[0.06em] placeholder:text-faint placeholder:tracking-[0.02em]",
              credInvalid ? "border-[rgba(208,133,98,.55)]" : "border-line focus:border-accent-dim",
            ].join(" ")}
          />
        </div>

        <button
          type="submit"
          disabled={!hydrated || pending || rateLimited}
          aria-busy={pending}
          className="w-full mt-[26px] font-mono text-xs tracking-button uppercase bg-accent text-vault border-0 rounded-[8px] py-[17px] cursor-pointer transition-[background,opacity] hover:bg-cream disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-center font-mono text-xs tracking-[0.04em] text-faint mt-[26px]">
        <Link
          href="/auth/signup"
          className="text-accent-dim no-underline hover:text-accent transition-colors"
        >
          Create account
        </Link>
        <span className="px-3">&middot;</span>
        <Link
          href="/auth/recovery"
          className="text-accent-dim no-underline hover:text-accent transition-colors"
        >
          Recover account
        </Link>
      </p>
    </div>
  );
}
