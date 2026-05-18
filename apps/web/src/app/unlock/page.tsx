"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { deriveLoginCrypto, unwrapDek } from "@/lib/auth-crypto";
import { PASSWORD_MAX, USERNAME_MAX } from "@/lib/validation";
import { useAuth } from "@/providers/auth-context";

export default function UnlockPage() {
  const router = useRouter();
  const { unlock } = useAuth();

  const [sessionLoading, setSessionLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [credError, setCredError] = useState<string | undefined>(undefined);
  const [banner, setBanner] = useState<string | undefined>(undefined);

  // On mount: verify session is valid; redirect to login if not
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await authApi.session();
        if (!cancelled) setSessionLoading(false);
      } catch {
        if (!cancelled) window.location.replace("/auth/login/");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCredError(undefined);
    setBanner(undefined);

    const trimmedUsername = username.trim().toLowerCase();
    if (!trimmedUsername || !password) return;

    setPending(true);
    try {
      const kdfRes = await authApi.kdfParams(trimmedUsername);
      const { authHash, kek, kdfParamVersion } = await deriveLoginCrypto({
        password,
        kdfSalt: kdfRes.kdf_salt,
        kdfParams: kdfRes.kdf_params,
      });

      const loginRes = await authApi.login({ username: trimmedUsername, auth_hash: authHash });

      const itemsKey = unwrapDek({
        wrappedDek: loginRes.wrapped_dek,
        wrappedDekIv: loginRes.wrapped_dek_iv,
        kek,
        kdfParamVersion,
      });

      unlock({
        user: { userId: loginRes.user_id, username: trimmedUsername },
        itemsKey,
        persistence: "memory",
      });
      router.replace("/");
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401 || e.status === 404) {
          setCredError("Invalid username or password.");
        } else if (e.status === 429) {
          setBanner("Too many attempts. Try again later.");
        } else if (e.status === 0) {
          setBanner("Network error. Check your connection and try again.");
        } else {
          setBanner("Unlock failed. Try again.");
        }
      } else {
        setBanner("Unlock failed. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  if (sessionLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <Loading />
      </main>
    );
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4 py-12">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            Unlock Privance
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Your session is still active but your vault was locked. Enter your master password to
            continue.
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
            error={credError}
          />

          <Input
            label="Master password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            maxLength={PASSWORD_MAX}
            placeholder="Master password"
          />

          <Button type="submit" loading={pending} className="w-full">
            {pending ? "Unlocking…" : "Unlock"}
          </Button>
        </form>

        <p className="text-center text-sm text-neutral-500">
          <Link
            href="/auth/login"
            className="text-gold-600 dark:text-gold-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded"
          >
            Sign in with a different account
          </Link>
        </p>
      </div>
    </main>
  );
}
