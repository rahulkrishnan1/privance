"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { deriveLoginCrypto, unwrapDek } from "@/lib/auth-crypto";
import { PASSWORD_MAX, USERNAME_MAX } from "@/lib/validation";
import { useAuth } from "@/providers/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [credError, setCredError] = useState<string | undefined>(undefined);
  const [banner, setBanner] = useState<string | undefined>(undefined);

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

      login({
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
          setBanner("Login failed. Try again.");
        }
      } else {
        setBanner("Login failed. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
        Log in
      </h1>

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
          // credError is attached to username only (not password) to prevent field-level
          // enumeration, a screen reader will announce it via the role="alert" on the
          // Input error element; both 401 and 404 map to the same generic message.
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
          {pending ? "Logging in…" : "Log in"}
        </Button>
      </form>

      <p className="text-center text-sm text-neutral-500">
        <Link
          href="/auth/signup"
          className="text-gold-600 dark:text-gold-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded"
        >
          Create an account
        </Link>
        {"  ·  "}
        <Link
          href="/auth/recovery"
          className="text-gold-600 dark:text-gold-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded"
        >
          Recover account
        </Link>
      </p>
    </div>
  );
}
