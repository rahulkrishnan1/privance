"use client";

import { deriveBiometricKek, openProtectorKey } from "@privance/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthBackdrop } from "@/components/auth/AuthBackdrop";
import { AuthErrorBar } from "@/components/auth/AuthErrorBar";
import { useErrorShake } from "@/components/auth/use-error-shake";
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

export default function UnlockPage() {
  const router = useRouter();
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
      router.replace("/app/");
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
      router.replace("/app/");
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401 || e.status === 404) {
          raiseError("wrong");
        } else if (e.status === 429) {
          raiseError("limit");
        } else if (e.status === 0) {
          raiseError("net");
        } else {
          raiseError("generic");
        }
      } else {
        raiseError("generic");
      }
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
    window.location.replace("/auth/login/");
  }

  return (
    <main className="relative flex min-h-svh flex-col bg-vault text-cream">
      <AuthBackdrop />

      <div className="flex-1 flex items-center justify-center px-5 pb-16 pt-8 relative z-10">
        <div className={`auth-rise w-full max-w-[440px]${shaking ? " auth-shake" : ""}`}>
          {sessionExpired ? (
            <>
              <div className="w-[74px] h-[74px] rounded-full border border-[rgba(235,235,230,.18)] mx-auto mb-[30px] flex items-center justify-center text-dim relative">
                <span className="absolute inset-[6px] border border-dashed border-[rgba(235,235,230,.12)] rounded-full" />
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
              <h1 className="font-serif font-normal text-[34px] text-center tracking-[-0.01em] leading-[1.12]">
                The vault re&#8209;sealed <em className="text-accent">itself.</em>
              </h1>
              <p className="text-center text-dim text-[14px] mt-[10px]">
                You were away long enough that the session key was discarded. That&rsquo;s the deal:
                idle means locked.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSessionExpired(false);
                  setShowPasswordForm(true);
                }}
                className="w-full mt-[26px] font-mono text-[12px] tracking-[0.16em] uppercase bg-accent text-vault border-0 rounded-[8px] py-[17px] cursor-pointer transition-[background,opacity] hover:bg-cream"
              >
                Sign back in
              </button>
              <p className="text-center font-mono text-[11px] tracking-[0.04em] text-faint mt-[26px]">
                Not{" "}
                <span className="text-cream-soft font-mono">{hydrated ? expiredUsername : ""}</span>
                ?{" "}
                <button
                  type="button"
                  onClick={() => router.push("/auth/signup/")}
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
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                    </svg>
                  </div>

                  <h1 className="font-serif font-normal text-[34px] text-center tracking-[-0.01em] leading-[1.12]">
                    Welcome back, <em className="text-accent">{hydrated ? username : ""}.</em>
                  </h1>
                  <p className="text-center text-dim text-[14px] mt-[10px]">
                    The vault is sealed. Decryption happens here, on this device.
                  </p>
                </>
              ) : (
                <>
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

                  <h1 className="font-serif font-normal text-[34px] text-center tracking-[-0.01em] leading-[1.12]">
                    Welcome <em className="text-accent">back.</em>
                  </h1>
                  <p className="text-center text-dim text-[14px] mt-[10px]">
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
                <AuthErrorBar lead="That key didn&rsquo;t turn.">
                  Wrong password. Forgot it? Your recovery phrase still works.
                </AuthErrorBar>
              )}
              {error === "limit" && (
                <AuthErrorBar lead="The lock is cooling down.">
                  Too many attempts. Try again in a moment.
                </AuthErrorBar>
              )}
              {error === "net" && (
                <AuthErrorBar lead="Can&rsquo;t reach your vault host.">
                  Check the connection and try again. Nothing you typed left this device.
                </AuthErrorBar>
              )}
              {error === "bio-purged" && (
                <AuthErrorBar lead="Biometric unlock failed.">
                  Unlock with your password and re&#8209;enable biometrics in Settings.
                </AuthErrorBar>
              )}
              {error === "generic" && <AuthErrorBar lead="Unlock failed.">Try again.</AuthErrorBar>}

              {biometricRecord && !softBioError && (
                <button
                  type="button"
                  aria-busy={biometricPending}
                  disabled={!hydrated || biometricPending}
                  onClick={() => void handleBiometric()}
                  className="w-full mt-[26px] font-mono text-[12px] tracking-[0.16em] uppercase bg-accent text-vault border-0 rounded-[8px] py-[17px] cursor-pointer transition-[background,opacity] hover:bg-cream disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[11px]"
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
                </button>
              )}

              {(biometricRecord === null || showPasswordForm) && (
                <form
                  onSubmit={(e) => void onSubmit(e)}
                  className="flex flex-col mt-[26px]"
                  noValidate
                >
                  <div className="flex flex-col gap-[9px]">
                    <label
                      htmlFor="unlock-password"
                      className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-faint"
                    >
                      Master password
                    </label>
                    <input
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
                      className={[
                        "w-full bg-panel border rounded-[8px] text-cream font-mono text-[15px] px-4 py-[15px] outline-none transition-colors tracking-[0.06em] placeholder:text-faint placeholder:tracking-[0.02em]",
                        error === "wrong"
                          ? "border-[rgba(208,133,98,.55)]"
                          : "border-line focus:border-accent-dim",
                      ].join(" ")}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={!hydrated || pending || error === "limit"}
                    aria-busy={pending}
                    className={[
                      "w-full mt-[26px] font-mono text-[12px] tracking-[0.16em] uppercase bg-accent text-vault border-0 rounded-[8px] py-[17px] cursor-pointer transition-[background,opacity] hover:bg-cream disabled:opacity-50 disabled:cursor-not-allowed",
                      error === "limit" ? "opacity-40 pointer-events-none" : "",
                    ].join(" ")}
                  >
                    {pending ? "Unlocking…" : "Unlock"}
                  </button>
                </form>
              )}

              {biometricRecord && !showPasswordForm && (
                <button
                  type="button"
                  onClick={() => setShowPasswordForm(true)}
                  className={[
                    "w-full mt-3 font-mono text-[11px] tracking-[0.14em] uppercase bg-transparent rounded-[8px] py-[15px] cursor-pointer transition-colors flex items-center justify-center",
                    softBioError
                      ? "border border-accent-dim text-accent"
                      : "border border-line text-dim hover:text-accent hover:border-accent-dim",
                  ].join(" ")}
                >
                  Use master password instead
                </button>
              )}

              {biometricRecord && (
                <p className="text-center font-mono text-[9.5px] tracking-[0.08em] text-faint mt-[14px]">
                  password still required every 14 days, by design
                </p>
              )}

              <p className="mt-6 text-center font-mono text-[10px] tracking-[0.22em] uppercase text-faint opacity-60">
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="inline-block py-3 px-2 -my-3 -mx-2 hover:text-cream transition-colors cursor-pointer focus-visible:outline-none focus-visible:text-accent"
                >
                  Sign out
                </button>
              </p>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(127,196,198,.25)}50%{box-shadow:0 0 0 16px rgba(127,196,198,0)}}
        @media(prefers-reduced-motion:reduce){.bio-emblem{animation:none!important}}
      `}</style>
    </main>
  );
}
