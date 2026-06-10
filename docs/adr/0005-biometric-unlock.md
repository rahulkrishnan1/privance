# ADR-0005: Biometric unlock via WebAuthn PRF

- **Status:** Accepted
- **Date:** 2026-06-05

## Context

ADR-0004 built a session vault that persists a wrapped copy of the items key in IndexedDB for up to 15 minutes, so a same-tab reload does not force a full re-authentication. It explicitly deferred biometric unlock as a future layer.

The remaining friction point is the cold-launch unlock and the post-expiry re-auth: every time the 15-minute window has passed the user must enter their master password and wait through a multi-second Argon2id derivation. On phones with a strong master password this is the most frequent source of friction in daily use. ADR-0004 was designed to accept biometric layering; the session vault and auth state machine have explicit integration points for it.

The binding constraint is the zero-knowledge property: the items key must never be persisted in a form the server can recover, and the biometric mechanism must not weaken that guarantee in a way that is unbounded or covert. Two design rules follow from this: the biometric path must be hardware-gated (a software-only key store is not meaningfully different from plaintext), and the master password must remain load-bearing (a password that fades from memory is a data-loss risk in a zero-knowledge app; a fixed cadence keeps it rehearsed).

The session vault was also designed as a singleton per browser context, exempt from user-scoping. A biometric store that spans a user switch without purging would allow one user's enrolled credential to expose another user's items key on the same device; the biometric store must be user-scoped.

Feature support is uneven across platform and browser version. Any enrolled or unenrolled device must remain fully functional on the password path; the biometric unlock is strictly additive.

## Decision

Add optional biometric unlock using the WebAuthn PRF extension, with a protector-keypair indirection layer and a 14-day cadence requirement.

**Key hierarchy and protector-keypair indirection.** At enrollment a local asymmetric protector keypair is generated via `crypto.subtle.generateKey` (RSA-OAEP, SHA-256, 2048-bit, `encrypt`/`decrypt` only). The public key is stored plaintext. The private key is exported as PKCS8 and sealed under a biometric KEK derived from the passkey's PRF output. The items key is wrapped under the public key via `crypto.subtle.encrypt` with RSA-OAEP; `wrapKey`/`unwrapKey` is not used, which removes engine-variance risk from the path. Unlock reverses the chain: assertion releases the PRF output, HKDF derives the biometric KEK, the sealed private key is opened, and the private key decrypts the wrapped items key blob.

The indirection exists to satisfy the re-arm requirement without a biometric prompt mid-login. After a password-derived unlock the stored public key re-wraps the current items key without touching the authenticator: the biometric credential is not needed to update the wrapped blob, only to open it. This is a fresh wrap, not a timestamp extension.

**HKDF label.** PRF output (32 bytes) is fed to the existing `deriveKey` HKDF helper with the new frozen label `finance/biometric-v1`, added to `packages/core/src/crypto/labels.ts`. This label is frozen alongside the existing three; bumping it is a migration requiring key re-wrap, not a code change.

**Tamper detection: two bindings.** First, the RSA plaintext embeds the enrollment's `recordUuid` beside the 32 key bytes. The unwrap step (`unwrapItemsKeyRsa` in `apps/web/src/lib/storage/biometric-store.ts`) verifies the embedded UUID against the stored record; a substituted wrapped blob fails deterministically and triggers the purge path rather than yielding garbage bytes. Second, the AEAD seal over the PKCS8 private key includes a SHA-256 digest of the stored public key bytes in the AAD (via `sealProtectorKey` in `packages/core/src/crypto/biometric.ts`). Swapping the stored public key breaks the next private-key unseal. Both bindings are defense-in-depth; same-origin script compromise is already accepted as full session compromise.

**AEAD seal for the private key.** `encryptAead` from core with AAD `{recordUuid, kind: "biometric_protector", labelVersion, kdfParamVersion, pubKeyDigest}`, matching the convention in `items-key.ts`. Tamper detection is AES-GCM's authentication tag; a tag failure throws `DecryptionError`, which is treated as the R17 purge signal.

**Per-enrollment 32-byte salt with dual roles.** A fresh random 32-byte value is generated at enrollment. It is stored in the record and serves two functions: the HKDF salt input to `deriveBiometricKek`, and the PRF eval input (`prf.eval.first`) passed to the WebAuthn create and assert calls. One value, two documented roles.

**Durable biometric store, separate DB.** The enrollment record lives in its own IndexedDB database named `privance.biometric` (module: `apps/web/src/lib/storage/biometric-store.ts`). It is separate from `privance.session` because its lifecycle differs: it is exempt from the 15-minute TTL and the cold-launch purge. The store mirrors the session vault's module shape: pure `withStore` wrapper, best-effort degrade on storage faults, dev-only warnings. The single record key is `"current"`.

**User-scoped record.** The record holds the enrolling user's `userId`. `loadEnrollment` purges and returns null when the `userId` in the record does not match the `userId` argument. This prevents a failed logout purge (interrupted tab close) from leaving one user's wrapped items key accessible to a different user on the same device.

**14-day cadence.** `lastPasswordUnlockAt` is stored in the record. When `now - lastPasswordUnlockAt` exceeds 14 days (`CADENCE_TTL_MS`), `loadEnrollment` destroys the wrapped items key in place and returns null; the enrollment bookkeeping (credential id, salt, protector keypair material, none of which contains user key material) survives so the next password-derived unlock re-arms without re-enrollment, per the origin R9 contract. Full-record purges are reserved for logout, userId mismatch, and tamper. The check is fail-closed: a negative age (clock moved backwards) is treated as stale. The timestamp is origin-local and script-writable; tampering can only delay the destruction of an existing blob, never bypass the PRF gate.

**Re-arm triage in auth-context.** `login()` always re-arms. `unlock()` re-arms unless `payload.persistence === "biometric"` (a biometric unlock must never extend its own cadence; only password-derived unlocks reset the 14-day window). The boot rehydrate effect never re-arms (silent resume is not password-derived). `lock()` is untouched; it does not purge the biometric record (locking and logging out are distinct operations). `reArm` is a no-op when no record exists, so a re-arm racing a cross-tab logout purge cannot resurrect a deleted record. A `userId` mismatch during `reArm` purges instead of wrapping.

**Logout purge ordering.** `logout()` in `apps/web/src/providers/auth-context.tsx` awaits `purgeEnrollment()` before `finishLogout` removes `USERNAME_KEY` and broadcasts to sibling tabs. Sibling tabs therefore reload into an already-purged state. A comment at the purge site notes that any future DEK-rotation flow must also purge here, because a rotated items key would otherwise be wrapped under an enrollment keyed to the old key.

**Locked-screen sign-out.** `handleSignOut` in `apps/web/src/app/unlock/page.tsx` calls `purgeEnrollment()` directly before `logout()`, mirroring the pattern that already calls `destroyUserStore` directly from that page.

**Feature detection.** `isBiometricSupported()` in `apps/web/src/lib/crypto/webauthn-prf.ts` gates on `isSecureContext` and `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`. `getClientCapabilities()` is not consulted: iOS omits `extension:prf` from that list while fully supporting PRF (verified by spike on iPhone Safari 26.5 standalone PWA). PRF support is confirmed at enrollment from the created credential's PRF result; absence after both the create and a fallback assertion is treated as unsupported (`BiometricUnsupportedError`).

**Ceremony code placement.** All `navigator.credentials` calls live in `apps/web/src/lib/crypto/webauthn-prf.ts` (precedent: `kdf.ts` keeps worker and browser concerns in `apps/web`). Key derivation and protector sealing live in `packages/core/src/crypto/biometric.ts`, where fast-check property tests and the 90% coverage gate apply.

**Hardware observations.** (1) Confirmed during manual verification on iPhone (iOS Safari 26.x, standalone home-screen PWA): enrollment prompts Face ID once; `create()` returns PRF output directly and the `prf.enabled` fallback-assertion path does not fire. The fallback stays in place for platforms that withhold PRF at create time, which the spec permits. (2) Whether a synced passkey (iCloud Keychain or Google Password Manager) returns identical PRF output on a different device is not specified by the W3C standard and remains unconfirmed. Per-device enrollment means either answer is safe for this version: each device's wrapped blob is independent.

## Consequences

**At-rest window extension, hardware-gated.** A durable wrapped copy of the items key now exists in IndexedDB (database `privance.biometric`) for up to 14 days after the last password-derived unlock. The unwrap barrier is the platform authenticator's PRF gate, not wall-clock expiry alone. This is a deliberate, bounded extension of the at-rest posture recorded in ADR-0004; it is recorded in `THREAT_MODEL.md` section 3.2.

**Per-device enrollment.** Each device's platform authenticator holds its own passkey and its own wrapped blob. Cross-device enrollment sync is out of scope for this version.

**Script-writable timestamp, bounded impact.** `lastPasswordUnlockAt` is stored in IndexedDB and is origin-writable by any same-origin script. Tampering with it can at most delay the purge of an existing blob; it cannot bypass the PRF gate. The PRF output never leaves the authenticator.

**DEK-rotation constraint.** No current flow rotates the items key. Any future flow that does must purge the biometric store and require a password-derived unlock to re-arm; the wrapped blob would otherwise reference the old key. This constraint is noted in a comment at the `purgeEnrollment()` call in `logout()`.

**Orphaned OS-side passkey on disable or failed save.** Web apps cannot delete platform passkeys via any standard API. When the user disables biometric unlock from settings, or when a settings-save fails after a successful passkey creation, the OS-side passkey remains in the credential manager. The UI discloses this and directs the user to their OS credential manager to remove it manually.

**Private browsing and IDB-disabled hosts.** In private browsing, site storage including the biometric store is wiped when the session ends; biometric unlock degrades to password-only on reopen with no special handling needed. On hosts where IDB is disabled (certain restricted WKWebView configurations), the store degrades to null silently and the app behaves as password-only.

**Capacitor iOS and Android surfaces.** The enrolled passkey RP ID is bound to the web origin and does not match the native WebView. Native biometric unlock for the Capacitor builds is a separate decision for a future ADR when that surface ships.

## Alternatives considered

**`largeBlob` credential extension.** Stores arbitrary bytes on the authenticator rather than deriving a key via PRF. Rejected because `largeBlob` has storage semantics rather than key-gate semantics (the bytes are retrieved, not derived), support is materially narrower than PRF across the target device matrix, and it is not available in Safari at all.

**Boolean credential-presence gate (WebAuthn assertion as a yes/no).** A successful assertion would unlock without any cryptographic binding between the assertion and the items key. Rejected because the wrapped items key would remain recoverable by anyone with disk access to the IDB store; the biometric becomes a UI affordance rather than a cryptographic barrier.

**Device PIN or custom secret.** A short PIN has no hardware gate and a weaker entropy profile than the master password. Rejected; it would degrade the posture rather than maintain it.

**No protector-keypair indirection (direct PRF-derived KEK wraps the items key).** Simpler structure, but re-arm after a password-derived unlock would require a biometric prompt to re-wrap with the new timestamp. Unacceptable: the re-arm fires inside `login()` and `unlock()`, where a Face ID prompt mid-flow is a confusing and disruptive UX regression. The indirection layer solves this at the cost of one additional key in the chain.

**ECDH P-256 for the protector keypair.** Would require a key-agreement step and a derived symmetric key to wrap the items key. Added complexity for a keypair that is single-use per enrollment. RSA-OAEP directly encrypts the 32-byte items key (well within the OAEP plaintext limit for a 2048-bit key) with no additional derive step.

## References

- ADR-0004: `docs/adr/0004-session-persistence.md`
- W3C PRF extension specification: https://w3c.github.io/webauthn/#prf-extension
