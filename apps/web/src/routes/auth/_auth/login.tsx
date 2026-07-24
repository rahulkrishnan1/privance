import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components";
import { AuthErrorBar } from "@/components/auth/AuthErrorBar";
import { useErrorShake } from "@/components/auth/use-error-shake";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mapApiError } from "@/lib/api/apierror";
import * as authApi from "@/lib/api/auth";
import { deriveLoginCrypto, unwrapDek } from "@/lib/auth-crypto";
import { warmKdfWorker } from "@/lib/crypto/kdf";
import { useHydrated } from "@/lib/use-hydrated";
import { PASSWORD_MAX, USERNAME_MAX } from "@/lib/validation";
import { useAuth } from "@/providers/auth-context";

type LoginBanner =
  | { kind: "wrong" }
  | { kind: "limit" }
  | { kind: "net" }
  | { kind: "generic" }
  | undefined;

export const Route = createFileRoute("/auth/_auth/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LoginBanner>(undefined);
  const [errorSeq, setErrorSeq] = useState(0);
  const hydrated = useHydrated();
  const shaking = useErrorShake(errorSeq);
  const usernameRef = useRef<HTMLInputElement>(null);
  const kdfPrefetch = useRef<Promise<Awaited<ReturnType<typeof authApi.kdfParams>> | null> | null>(
    null,
  );

  useEffect(() => {
    if (!username.trim()) return;
    kdfPrefetch.current = authApi.kdfParams(username.trim().toLowerCase()).catch(() => null);
    warmKdfWorker();
  }, [username]);

  function raiseError(next: NonNullable<LoginBanner>) {
    setError(next);
    setErrorSeq((n) => n + 1);
    // Move focus back to the username field so screen readers land on the start
    // of the form with the error banner in context.
    usernameRef.current?.focus();
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
      const prefetched = kdfPrefetch.current;
      kdfPrefetch.current = null;
      const kdfRes = (await prefetched) ?? (await authApi.kdfParams(trimmedUsername));
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
      navigate({ to: "/app", replace: true });
    } catch (e) {
      const key = mapApiError(e, {
        401: "wrong",
        404: "wrong",
        429: "limit",
        0: "net",
      });
      // key is narrowed by the mapping above; runtime fallback is "generic"
      raiseError({ kind: (key ?? "generic") as "wrong" | "limit" | "net" | "generic" });
    } finally {
      setPending(false);
    }
  }

  const credInvalid = error?.kind === "wrong";
  const rateLimited = error?.kind === "limit";

  return (
    <div className={`flex flex-col gap-0${shaking ? " auth-shake" : ""}`}>
      <div className="w-[74px] h-[74px] rounded-full border border-accent-dim mx-auto mb-[30px] flex items-center justify-center text-accent relative">
        <span className="absolute inset-[6px] border border-dashed border-accent/30 rounded-full" />
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
        <AuthErrorBar id="login-cred-error" lead="That key didn&rsquo;t turn.">
          Wrong password. Forgot it? Your recovery phrase still works.
        </AuthErrorBar>
      )}
      {error?.kind === "limit" && (
        <AuthErrorBar id="login-cred-error" lead="The lock is cooling down.">
          Too many attempts. Try again in a moment.
        </AuthErrorBar>
      )}
      {error?.kind === "net" && (
        <AuthErrorBar id="login-cred-error" lead="Can&rsquo;t reach your vault host.">
          Check the connection and try again. Nothing you typed left this device.
        </AuthErrorBar>
      )}
      {error?.kind === "generic" && (
        <AuthErrorBar id="login-cred-error" lead="Sign in failed.">
          Try again.
        </AuthErrorBar>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col mt-[26px]" noValidate>
        <div className="flex flex-col gap-[9px]">
          <Label htmlFor="login-username">Username</Label>
          <Input
            ref={usernameRef}
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
            aria-describedby={credInvalid ? "login-cred-error" : undefined}
          />
        </div>

        <div className="flex flex-col gap-[9px] mt-[26px]">
          <Label htmlFor="login-password">Master password</Label>
          <Input
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
            aria-describedby={credInvalid ? "login-cred-error" : undefined}
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          disabled={!hydrated || pending || rateLimited}
          loading={pending}
          className="w-full mt-[26px]"
        >
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-center font-mono text-xs tracking-[0.04em] text-faint mt-[26px]">
        <Link
          to="/auth/signup"
          className="text-accent-dim no-underline hover:text-accent transition-colors"
        >
          Create account
        </Link>
        <span className="px-3 text-faint">/</span>
        <Link
          to="/auth/recovery"
          className="text-accent-dim no-underline hover:text-accent transition-colors"
        >
          Recover account
        </Link>
      </p>
    </div>
  );
}
