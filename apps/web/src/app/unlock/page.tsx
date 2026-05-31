"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Logo } from "@/components/index";
import { Loading } from "@/components/Loading";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { deriveLoginCrypto, unwrapDek } from "@/lib/auth-crypto";
import { destroyUserStore } from "@/lib/storage/per-user-store";
import { PASSWORD_MAX } from "@/lib/validation";
import { USER_ID_KEY, useAuth } from "@/providers/auth-context";

export default function UnlockPage() {
  const router = useRouter();
  const { unlock, logout, user } = useAuth();
  const username = user?.username ?? "";

  const [sessionLoading, setSessionLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [credError, setCredError] = useState<string | undefined>(undefined);
  const [banner, setBanner] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await authApi.session();
        if (!cancelled) setSessionLoading(false);
      } catch {
        if (!cancelled) {
          // Session is gone server-side. Await logout so the locked marker is
          // cleared before the hard redirect, or AuthProvider re-boots into
          // "locked" and auth/layout bounces straight back to /unlock in an
          // infinite loop.
          await logout();
          window.location.replace("/auth/login/");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logout]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCredError(undefined);
    setBanner(undefined);

    if (!username || !password) return;

    setPending(true);
    try {
      const kdfRes = await authApi.kdfParams(username);
      const { authHash, kek, kdfParamVersion } = await deriveLoginCrypto({
        password,
        kdfSalt: kdfRes.kdf_salt,
        kdfParams: kdfRes.kdf_params,
      });

      const loginRes = await authApi.login({ username, auth_hash: authHash });

      const itemsKey = unwrapDek({
        wrappedDek: loginRes.wrapped_dek,
        wrappedDekIv: loginRes.wrapped_dek_iv,
        kek,
        kdfParamVersion,
      });

      unlock({
        user: { userId: loginRes.user_id, username },
        itemsKey,
        persistence: "memory",
      });
      router.replace("/app/");
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401 || e.status === 404) {
          setCredError("Wrong password.");
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

  async function handleSignOut() {
    await authApi.logout().catch(() => undefined);
    // The lock-reload wiped the in-memory store and its destroy cleanup, so
    // erase the per-user ciphertext file directly before clearing the session.
    const userId = sessionStorage.getItem(USER_ID_KEY);
    if (userId !== null) await destroyUserStore(userId);
    await logout();
    window.location.replace("/auth/login/");
  }

  if (sessionLoading) {
    return (
      <main className="dark flex min-h-svh items-center justify-center bg-app-bg text-app-text">
        <Loading />
      </main>
    );
  }

  return (
    <main className="dark relative flex min-h-svh flex-col items-center justify-center bg-app-bg text-app-text px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] bg-[radial-gradient(ellipse_at_top,_rgba(230,211,154,0.08),_transparent_60%)]"
      />
      <div className="relative z-10 mb-10 flex items-center gap-2.5">
        <Logo size={26} className="text-gold-accent" />
        <span
          className="font-serif text-[17px] text-app-text"
          style={{ fontVariationSettings: '"opsz" 24, "SOFT" 80' }}
        >
          Privance
        </span>
      </div>
      <div className="relative z-10 w-full max-w-md flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1
            className="font-serif text-[32px] leading-tight font-light tracking-[-0.015em] text-app-text"
            style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
          >
            Unlock your <span className="font-editorial italic text-gold-accent">account.</span>
          </h1>
          <p className="text-[14px] text-app-muted">
            Signed in as <span className="font-mono text-app-text">{username}</span>.
          </p>
        </div>

        {banner && (
          <div role="alert" className="rounded-lg border border-app-red/40 bg-app-red/10 px-4 py-3">
            <p className="text-[13px] text-app-red">{banner}</p>
          </div>
        )}

        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-6" noValidate>
          <Input
            label="Master password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            maxLength={PASSWORD_MAX}
            autoFocus
            error={credError}
          />

          <Button type="submit" loading={pending} className="w-full mt-2">
            {pending ? "Unlocking…" : "Unlock"}
          </Button>
        </form>

        <p className="text-center font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="inline-block py-3 px-2 -my-3 -mx-2 hover:text-app-text transition-colors cursor-pointer focus-visible:outline-none focus-visible:text-gold-accent"
          >
            Sign out
          </button>
        </p>
      </div>
    </main>
  );
}
