# Security Policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/rahulkrishnan1/privance/security/advisories/new). Do not open a public issue for security findings.

**Response SLA expectations:**
- Acknowledgement: within 3 business days of receipt
- Initial triage and severity assessment: within 7 days
- Fix timeline communicated: within 14 days
- Critical/high severity: patch target within 30 days where feasible

We follow coordinated disclosure. Please give us reasonable time to patch before publishing details.

---

## Scope

### In scope

- Server-side code (`server/`)
- Browser-side code (`apps/web/`)
- Shared crypto and sync code (`packages/core/`)
- Authentication flows (signup, login, recovery, password change)
- Sync protocol and conflict handling
- Session management and CSRF protection
- The zero-knowledge properties described below

### Out of scope

- Vulnerabilities in third-party dependencies, report those to the upstream
  project. We will update our dependency if they publish a fix.
- Issues requiring physical access to the device running the browser
- Self-inflicted misconfiguration (e.g., deploying without TLS)
- Denial-of-service attacks that require enormous resources

---

## Threat model

See [THREAT_MODEL.md](THREAT_MODEL.md) for the full asset/threat/mitigation analysis.

---

## Security contracts for changes

Read this section before changing auth, crypto, key persistence, logging, or server-visible data. Preserve these contracts and update the affected asset analysis in [THREAT_MODEL.md](THREAT_MODEL.md) when the threat surface changes.

1. **Zero-knowledge ciphertext at rest.** The server (`server/src/sync/`) stores only
   encrypted blobs. No plaintext financial data is ever written to Postgres.

2. **DEK never leaves the browser in raw form.** The Data Encryption Key (items key) lives in
   `globalThis[Symbol.for("privance.dekStore.v1")]`; persist only approved wrapped copies, never raw bytes. The [session vault](docs/adr/0004-session-persistence.md) uses a non-extractable AES-GCM wrapping key and a 15-minute activity window. Explicit lock, expiry checks, and logout attempt to purge it. Reloads within the window may restore the key; installed-PWA cold launches purge that vault, while normal browser tabs retain the timer-only behavior. Optional [biometric enrollment](docs/adr/0005-biometric-unlock.md) holds a separate user-scoped, wrapped copy with a 14-day password-unlock cadence. Explicit lock retains enrollment; logout, user mismatch, and tamper attempt to purge it. Both windows limit application unlock, not physical storage lifetime: no cleanup timer runs while the app is closed, and deletion is best-effort. See the [DEK residual risks](THREAT_MODEL.md#32-dek-items-key). A future DEK rotation must purge biometric enrollment too.

3. **HKDF labels are frozen.** The four labels, `finance/auth-v1`, `finance/kek-v1`,
   `finance/recovery-v1`, and `finance/biometric-v1`, are defined in [`labels.ts`](packages/core/src/crypto/labels.ts). A label change requires a coordinated key-rewrap migration. Argon2id parameters are versioned in stored hashes; parameter upgrades follow expand → backfill → contract rather than silently replacing existing parameters.

4. **AES-GCM AAD binds record identity, kind, and version.** Every encrypted record
   includes `{recordUuid, kind, labelVersion, kdfParamVersion}` as Additional Authenticated Data, preventing record-swap, cross-kind swap, and downgrade attacks without key compromise. Only `biometric_protector` records additionally bind `pubKeyDigest` (SHA-256 of the stored protector public key) to prevent key-swap. Preserve the serialized field order in [`aead.ts`](packages/core/src/crypto/aead.ts); changing authenticated bytes requires a migration.

5. **Constant-time comparisons.** Byte-level secret comparisons use `equalBytes` from
   `@noble/ciphers/utils` (`packages/core/src/crypto/compare.ts`), a timing-safe implementation. The server does not compare raw secrets in non-constant time.

6. **Password quality enforced on the client.** A strength meter plus a minimum-length rule
   (`apps/web/src/lib/validation.ts`) guard password choice at signup, password change, and recovery. Privance performs no third-party breach-database lookup, consistent with making no unnecessary external calls; the password never leaves the device.

7. **Username-enumeration prevention.** The `/api/auth/kdf-params` endpoint returns
   deterministic fake KDF parameters for unknown usernames, derived via HKDF-SHA256 keyed on `ENUMERATION_SECRET` (label `finance/kdf-params/v1`), at the same timing as a real response (`server/src/auth/kdf.ts`).

8. **CSRF protection on all state-changing routes.** The server requires the
   `X-Requested-With` header on every non-safe HTTP method (`server/src/core/middleware.ts`). The browser client sends this header on all mutations (`apps/web/src/lib/api/client.ts`).

9. **Rate limiting on auth endpoints.** Login, signup, and recovery are rate-limited
   by username and by IP (hashed); password change and vault destruction are rate-limited per user. Login, recovery, and the password-verifying step-up endpoints additionally apply progressive backoff after failures (`server/src/auth/rate-limit.ts`).

10. **Session cookies are HttpOnly, Secure (in production), and SameSite=Lax.**
    Session tokens are not readable by JavaScript.

11. **Invite-only signup gate.** When `INVITE_REQUIRED=true`, signup requires a 256-bit random base64url token; tokens are SHA-256-hashed at rest, single-use via atomic UPDATE, and validated BEFORE Argon2id so an attacker without a valid invite cannot consume server CPU.

12. **Minimum plaintext.** Encrypt or omit new user data. Adding a plaintext server field requires a written justification in the spec explaining why the server needs it; omit write-only metadata that no code reads.

13. **Secret-free logs.** Never log passwords, key material, recovery phrases, or decrypted user data. Keep operational pino logs separate from audit events written through `repo.logEvent`.

---

## Hardening choices

- **Exact-pinned dependencies.** Direct dependency manifests use exact versions, captured in the lockfile. The pre-push hook blocks high-severity `pnpm audit` findings; the CI dependency-audit job reports them but is currently advisory. See [verification](CONTRIBUTING.md#verification) for the full audit bar.
- **Renderer reload on auto-lock.** When the idle timer fires, the app issues a
  full page reload to scrub V8-internal copies of the DEK in addition to clearing the `Symbol`-keyed store.

---

## Known non-properties

We do not claim to defend against the following. These are design-level tradeoffs, not bugs:

- **Malicious operator or supply-chain attack.** If the server operator ships a
  compromised JavaScript bundle, client-side crypto can be subverted. Users must trust that the operator builds and deploys the published source faithfully. Self-hosting reduces third-party operator trust; it does not eliminate build or dependency compromise.

- **Endpoint (device/browser) compromise.** If the device running the browser is
  compromised, malware, a keylogger, a malicious browser extension, the DEK can be exfiltrated from memory. We cannot protect against a fully compromised browser environment. This is the fundamental limit of browser-based crypto.

- **Timing attacks against pure-JS crypto in extremely adversarial environments.**
  The `@noble/ciphers` and `@noble/hashes` libraries implement constant-time operations in JavaScript. In a controlled environment (e.g., shared hosting with accurate high-resolution timers), microsecond-level timing side channels may be theoretically exploitable. We use well-regarded audited libraries; we do not claim hardware-level isolation.

- **Server-visible metadata.** The server stores usernames, session metadata, and
  object kind/ID metadata (e.g., that a user has records of kind `account`). The server does not know the contents of those records, but it can observe how many exist. Tor or a VPN may hide a client's network address, but does not hide authenticated account metadata or record counts from the server.
