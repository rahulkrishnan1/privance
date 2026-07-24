import { deriveBiometricKek, openProtectorKey } from "@privance/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components";
import { AuthBackdrop } from "@/components/auth/AuthBackdrop";
import { AuthErrorBar } from "@/components/auth/AuthErrorBar";
import { useErrorShake } from "@/components/auth/use-error-shake";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mapApiError } from "@/lib/api/apierror";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { deriveLoginCrypto, unwrapDek } from "@/lib/auth-crypto";
import { warmKdfWorker } from "@/lib/crypto/kdf";
import {
  assertPrf,
  BiometricCancelledError,
  BiometricFailureError,
  isBiometricSupported,
} from "@/lib/crypto/webauthn-prf";
import { hardRedirect } from "@/lib/navigate";
import {
  loadEnrollment,
  purgeEnrollment,
  type UsableEnrollment,
  unwrapItemsKeyRsa,
} from "@/lib/storage/biometric-store";
import { destroyUserStore } from "@/lib/storage/per-user-store";
import { useHydrated } from "@/lib/use-hydrated";
import { PASSWORD_MAX } from "@/lib/validation";
import { USER_ID_KEY, useAuth } from "@/providers/auth-context";

type KdfParamsResponse = Awaited<ReturnType<typeof authApi.kdfParams>>;

type UnlockBanner = "wrong" | "limit" | "net" | "generic" | "bio-purged";

export const Route = createFileRoute("/unlock")({
  component: UnlockPage,
});

function UnlockPage() {
  const navigate = useNavigate();
  const { state, unlock, logout, user } = useAuth();

  // Holds the username after a session-expired logout so the cold scene and a
  // subsequent password sign-in still know who the vault belongs to.
  const [expiredUsername, setExpiredUsername] = useState("");
  const username = user?.username ?? expiredUsername;

  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<UnlockBanner | undefined>(undefined);
  const [errorSeq, setErrorSeq] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);
  const hydrated = useHydrated();
  const shaking = useErrorShake(errorSeq);
  // Holds a prefetch of kdfParams so derivation can start sooner on submit.
  const kdfPrefetch = useRef<Promise<KdfParamsResponse | null> | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Biometric unlock: enrollment record present when the device is enrolled and cadence fresh.
  // null = not enrolled or unsupported; undefined = still checking.
  const [biometricRecord, setBiometricRecord] = useState<UsableEnrollment | null | undefined>(
    undefined,
  );
  const [biometricPending, setBiometricPending] = useState(false);
  // Soft biometric failure (user cancelled / no match), distinct from a hard
  // tamper failure which purges the enrollment. Keeps the record intact and
  // nudges the user to the password path without re-enrollment.
  const [softBioError, setSoftBioError] = useState(false);

  function raiseError(kind: UnlockBanner) {
    setError(kind);
    setErrorSeq((n) => n + 1);
    if (kind === "wrong") passwordRef.current?.focus();
  }
  // Enrolled devices lead with the biometric action; the password form stays
  // one tap away (origin R7 requires the password path always reachable).
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  // Latest username, read inside the one-shot session effect without making it a
  // dependency (logout nulls user, which would otherwise re-fire the effect).
  const usernameRef = useRef(username);
  usernameRef.current = username;

  // Mirrored to a ref so the background session-expiry check can bail out while a
  // biometric ceremony is mid-flight rather than scrubbing state underneath it.
  const biometricPendingRef = useRef(false);
  biometricPendingRef.current = biometricPending;

  // Session check runs in the background while the user types their password. On
  // a confirmed rejection it runs the same logout cleanup, then surfaces the
  // session-expired scene instead of hard-navigating (a hard nav would wipe the
  // in-memory DEK path). A network failure (offline PWA boot, transient blip)
  // must not wipe the locked state; unlock itself surfaces connectivity errors.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await authApi.session();
      } catch (e) {
        const sessionGone = e instanceof ApiError && e.status === 401;
        if (sessionGone && !cancelled && !biometricPendingRef.current) {
          // Capture the username before logout clears it, so the cold scene and
          // a follow-up password sign-in still know the vault owner.
          const knownUsername = usernameRef.current;
          // Keep the biometric enrollment: a lapsed server session is orthogonal
          // to local key custody, so the user keeps biometric unlock after they
          // sign back in. Only explicit Sign out (handleSignOut) purges it.
          await logout({ keepEnrollment: true });
          if (cancelled) return;
          setExpiredUsername(knownUsername);
          setBiometricRecord(null);
          setSessionExpired(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logout]);

  // Prefetch KDF params and warm the worker so spawn + wasm compile overlap
  // the user typing instead of following submit.
  useEffect(() => {
    if (!username) return;
    kdfPrefetch.current = authApi.kdfParams(username).catch(() => null);
    warmKdfWorker();
  }, [username]);

  // Gate on state === "locked" (not "loading") so userId is stable before we
  // read the enrollment. loadEnrollment self-purges stale and mismatched records.
  useEffect(() => {
    if (state !== "locked") return;
    let cancelled = false;
    void (async () => {
      const supported = await isBiometricSupported();
      if (!supported || cancelled) {
        if (!cancelled) setBiometricRecord(null);
        return;
      }
      const userId = localStorage.getItem(USER_ID_KEY);
      if (!userId) {
        setBiometricRecord(null);
        return;
      }
      const record = await loadEnrollment({ now: Date.now(), userId });
      if (!cancelled) setBiometricRecord(record);
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  async function handleBiometric() {
    if (!biometricRecord) return;
    setBiometricPending(true);
    setSoftBioError(false);
    let pkcs8: Uint8Array | null = null;
    try {
      const prfOutput = await assertPrf({
        credentialId: biometricRecord.credentialId,
        salt: biometricRecord.salt,
      });
      const kek = deriveBiometricKek({ prfOutput, salt: biometricRecord.salt });
      prfOutput.fill(0);
      pkcs8 = openProtectorKey({
        sealed: biometricRecord.sealedPrivateKey,
        kek,
        pubKeyBytes: biometricRecord.publicKeyBytes,
        recordUuid: biometricRecord.recordUuid,
      });
      const itemsKey = await unwrapItemsKeyRsa({
        wrappedItemsKey: biometricRecord.wrappedItemsKey,
        pkcs8,
        expectedRecordUuid: biometricRecord.recordUuid,
      });
      pkcs8.fill(0);
      pkcs8 = null;
      await unlock({
        user: { userId: biometricRecord.userId, username: biometricRecord.username },
        itemsKey,
        persistence: "biometric",
      });
      navigate({ to: "/app", replace: true });
    } catch (e) {
      if (pkcs8 !== null) pkcs8.fill(0);
      if (e instanceof BiometricCancelledError || e instanceof BiometricFailureError) {
        // Recoverable: user dismissed/no match (cancelled) or the ceremony
        // completed without PRF output (failure). Leave the screen and the
        // enrollment intact, surface the soft-fail bar, and steer toward the
        // password path. Destroying the enrollment over a recoverable miss is
        // hostile; only genuine integrity failures below warrant a purge.
        setSoftBioError(true);
        setErrorSeq((n) => n + 1);
        setBiometricPending(false);
        return;
      }
      // Tamper or credential/integrity mismatch (protector open or key unwrap
      // failed): the record can no longer unlock, so purge and direct to
      // re-enroll. UI state first so a hung IDB purge cannot strand the screen.
      setBiometricRecord(null);
      raiseError("bio-purged");
      await purgeEnrollment();
    } finally {
      setBiometricPending(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    performance.mark("privance:unlock-submit");
    setError(undefined);
    setSoftBioError(false);

    if (!username || !password) return;

    setPending(true);
    try {
      // Consume the prefetch once so a failed attempt refetches fresh params
      // (the salt changes if the password was changed on another device).
      const prefetched = kdfPrefetch.current;
      kdfPrefetch.current = null;
      const kdfRes = (await prefetched) ?? (await authApi.kdfParams(username));
      const { authHash, kek, kdfParamVersion } = await deriveLoginCrypto({
        password,
        kdfSalt: kdfRes.kdf_salt,
      });

      const loginRes = await authApi.login({ username, auth_hash: authHash });

      const itemsKey = unwrapDek({
        wrappedDek: loginRes.wrapped_dek,
        wrappedDekIv: loginRes.wrapped_dek_iv,
        kek,
        kdfParamVersion,
      });

      await unlock({
        user: { userId: loginRes.user_id, username },
        itemsKey,
        persistence: "memory",
      });
      performance.mark("privance:unlock-done");
      navigate({ to: "/app", replace: true });
    } catch (e) {
      const key = mapApiError(e, {
        401: "wrong",
        404: "wrong",
        429: "limit",
        0: "net",
      });
      raiseError((key ?? "generic") as "wrong" | "limit" | "net" | "generic");
    } finally {
      setPending(false);
    }
  }

  async function handleSignOut() {
    await authApi.logout().catch(() => undefined);
    // The lock-reload wiped the in-memory store and its destroy cleanup, so
    // erase the per-user ciphertext file directly before clearing the session.
    const userId = localStorage.getItem(USER_ID_KEY);
    if (userId !== null) await destroyUserStore(userId);
    await purgeEnrollment();
    await logout();
    hardRedirect("/auth/login");
  }

  return (
    <main className="relative flex min-h-svh flex-col bg-vault text-cream">
      <AuthBackdrop />

      <div className="flex-1 flex items-center justify-center px-5 pb-16 pt-8 relative z-10">
        <div className={`auth-rise w-full max-w-[440px]${shaking ? " auth-shake" : ""}`}>
          {sessionExpired ? (
            <>
              <div className="w-[74px] h-[74px] rounded-full border border-cream/18 mx-auto mb-[30px] flex items-center justify-center text-dim relative">
                <span className="absolute inset-[6px] border border-dashed border-cream/12 rounded-full" />
                <svg
                  viewBox="0 0 24 24"
                  width="26"
                  height="26"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </div>
              <h1 className="font-serif font-normal text-5xl text-center tracking-[-0.01em] leading-[1.12]">
                The vault re&#8209;sealed <em className="text-accent">itself.</em>
              </h1>
              <p className="text-center text-dim text-sm mt-[10px]">
                You were away long enough that the session key was discarded. That&rsquo;s the deal:
                idle means locked.
              </p>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setSessionExpired(false);
                  setShowPasswordForm(true);
                }}
                className="w-full mt-[26px]"
              >
                Sign back in
              </Button>
              <p className="text-center font-mono text-xs tracking-[0.04em] text-faint mt-[26px]">
                Not{" "}
                <span className="text-cream-soft font-mono">{hydrated ? expiredUsername : ""}</span>
                ?{" "}
                <button
                  type="button"
                  onClick={() => navigate({ to: "/auth/signup" })}
                  className="text-accent-dim no-underline hover:text-accent transition-colors cursor-pointer"
                >
                  Create a vault
                </button>
              </p>
            </>
          ) : (
            <>
              {biometricRecord ? (
                <>
                  <div
                    className="bio-emblem w-[74px] h-[74px] rounded-full border border-accent-dim mx-auto mb-[30px] flex items-center justify-center text-accent relative"
                    style={{ animation: biometricPending ? "pulse 2.4s ease infinite" : undefined }}
                  >
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
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                    </svg>
                  </div>

                  <h1 className="font-serif font-normal text-5xl text-center tracking-[-0.01em] leading-[1.12]">
                    Welcome back, <em className="text-accent">{hydrated ? username : ""}.</em>
                  </h1>
                  <p className="text-center text-dim text-sm mt-[10px]">
                    The vault is sealed. Decryption happens on device.
                  </p>
                </>
              ) : (
                <>
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
                    Welcome <em className="text-accent">back.</em>
                  </h1>
                  <p className="text-center text-dim text-sm mt-[10px]">
                    Signed in as{" "}
                    <span className="text-cream-soft font-mono">{hydrated ? username : ""}</span>.
                  </p>
                </>
              )}

              {softBioError && (
                <AuthErrorBar lead="Biometric unlock didn&rsquo;t take.">
                  Unlock with your master password, then re&#8209;enable biometrics in Settings if
                  it keeps happening.
                </AuthErrorBar>
              )}
              {error === "wrong" && (
                <AuthErrorBar id="unlock-cred-error" lead="That key didn&rsquo;t turn.">
                  Wrong password. Forgot it? Your recovery phrase still works.
                </AuthErrorBar>
              )}
              {error === "limit" && (
                <AuthErrorBar id="unlock-cred-error" lead="The lock is cooling down.">
                  Too many attempts. Try again in a moment.
                </AuthErrorBar>
              )}
              {error === "net" && (
                <AuthErrorBar id="unlock-cred-error" lead="Can&rsquo;t reach your vault host.">
                  Check the connection and try again. Nothing you typed left this device.
                </AuthErrorBar>
              )}
              {error === "bio-purged" && (
                <AuthErrorBar id="unlock-cred-error" lead="Biometric unlock failed.">
                  Unlock with your password and re&#8209;enable biometrics in Settings.
                </AuthErrorBar>
              )}
              {error === "generic" && (
                <AuthErrorBar id="unlock-cred-error" lead="Unlock failed.">
                  Try again.
                </AuthErrorBar>
              )}

              {biometricRecord && !softBioError && (
                <Button
                  type="button"
                  variant="primary"
                  loading={biometricPending}
                  disabled={!hydrated || biometricPending}
                  onClick={() => void handleBiometric()}
                  className="w-full mt-[26px] gap-[11px]"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="17"
                    height="17"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    <path d="M7 4.5h-.5A2.5 2.5 0 0 0 4 7v.5M17 4.5h.5A2.5 2.5 0 0 1 20 7v.5M7 19.5h-.5A2.5 2.5 0 0 1 4 17v-.5M17 19.5h.5a2.5 2.5 0 0 0 2.5-2.5v-.5M9 9.5v1M15 9.5v1M9.5 14.5c.7.7 1.5 1 2.5 1s1.8-.3 2.5-1" />
                  </svg>
                  {biometricPending ? "Verifying…" : "Unlock with biometrics"}
                </Button>
              )}

              {(biometricRecord === null || showPasswordForm) && (
                <form
                  onSubmit={(e) => void onSubmit(e)}
                  className="flex flex-col mt-[26px]"
                  noValidate
                >
                  <div className="flex flex-col gap-[9px]">
                    <Label htmlFor="unlock-password">Master password</Label>
                    <Input
                      ref={passwordRef}
                      id="unlock-password"
                      type="password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError(undefined);
                      }}
                      autoComplete="current-password"
                      maxLength={PASSWORD_MAX}
                      placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                      aria-invalid={error === "wrong"}
                      aria-describedby={error !== undefined ? "unlock-cred-error" : undefined}
                    />
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!hydrated || pending || error === "limit"}
                    loading={pending}
                    className="w-full mt-[26px]"
                  >
                    {pending ? "Unlocking…" : "Unlock"}
                  </Button>
                </form>
              )}

              {biometricRecord && !showPasswordForm && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowPasswordForm(true)}
                  className={[
                    "w-full mt-3",
                    softBioError ? "border-accent-dim text-accent" : "",
                  ].join(" ")}
                >
                  Use master password instead
                </Button>
              )}

              {biometricRecord && (
                <p className="text-center font-mono text-xs tracking-[0.08em] text-faint mt-[14px]">
                  password still required every 14 days
                </p>
              )}

              <p className="mt-6 text-center font-mono text-xs tracking-label uppercase text-faint opacity-60">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void handleSignOut()}
                  className="py-3 px-2 -my-3 -mx-2 text-faint"
                >
                  Sign out
                </Button>
              </p>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(94,234,212,.25)}50%{box-shadow:0 0 0 16px rgba(94,234,212,0)}}
        @media(prefers-reduced-motion:reduce){.bio-emblem{animation:none!important}}
      `}</style>
    </main>
  );
}
