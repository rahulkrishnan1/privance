# Threat Model

This document covers the assets Privance protects, the actors that might threaten them, the concrete threats per asset, and the mitigations in place. It is STRIDE-influenced but organized around assets rather than system components.

---

## 1. Actors

| Actor | Trust level | Notes |
|---|---|---|
| **Legitimate user** | Fully trusted | Owns the account; drives all data entry |
| **User's browser / device** | Semi-trusted | Assumed not to be actively compromised; but browser extensions and tab-sharing are acknowledged risks |
| **Passive network attacker** | Untrusted | Can observe ciphertext in transit; TLS is the primary control |
| **Active network attacker (MITM)** | Untrusted | Can modify traffic if TLS is misconfigured; TLS + HSTS is the control |
| **Self-host server operator** | Trusted by the user | In the canonical self-host model, operator = user; in any future hosted offering the operator is a separate party who sees only ciphertext |
| **Other users on the same server** | Untrusted | Privance is designed for single-user self-hosting; there are no cross-user data paths, but isolation relies on the server auth layer |
| **Malicious browser extension** | Untrusted | Can read JavaScript memory and DOM; acknowledged residual risk |
| **Supply-chain attacker** | Untrusted | Could inject malicious code into npm packages or the build pipeline |

---

## 2. Assets

| Asset | Description | Where it lives |
|---|---|---|
| **Master password** | The user's primary secret; never leaves the browser | User's memory + browser input only |
| **Stretched master key** | Argon2id output; intermediate key material | Browser JS memory (ephemeral, never persisted) |
| **KEK (Key Encryption Key)** | Derived from stretched master key via HKDF `finance/kek-v1` | Browser JS memory (ephemeral) |
| **DEK (Data Encryption Key / items key)** | AES-256 key for all user data; wrapped by KEK at rest | Browser JS memory via `globalThis[Symbol.for("privance.dekStore.v1")]`; also held wrapped under a non-extractable key in IndexedDB for up to 15 minutes so reloads survive |
| **Recovery phrase** | 12-word BIP39 mnemonic; backup path to the DEK | User's physical possession only; never stored by the server |
| **Recovery DEK wrap** | DEK wrapped under a key derived from the recovery phrase | Postgres (ciphertext only) |
| **Ciphertext at rest** | All financial records (accounts, holdings, transactions) | Postgres `sync_objects`, opaque blobs |
| **Session cookie** | HTTP-only session token | Browser cookie jar + Postgres sessions table |
| **Username** | Plaintext account identifier | Postgres, server sees this |
| **KDF parameters and salt** | Argon2id parameters and per-user salt | Postgres, required for login |
| **Object metadata** | Record kind, UUID, version, tombstone flag | Postgres `sync_objects`, server sees kind and count, not contents |
| **Invite token hash** | SHA-256 of plaintext mint token; consumed atomically on signup | Postgres `invite_tokens.token_hash` |
| **Market data cache** | Public prices and symbol/sector metadata, keyed by ticker, not by user | Postgres `prices` / `symbol_profiles`; a global cache shared across all users that reveals nothing about any user's holdings |

---

## 3. Threats per asset

### 3.1 Master password

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Password guessing (online) | Repeated login attempts | Rate limiting: 5 attempts per username per 60 s, 20 per IP per 60 s; progressive backoff up to 4 s per attempt (`server/src/auth/rate-limit.ts`) | Offline attack if attacker obtains KDF salt |
| Weak master password | User picks a guessable password | Local-only enforcement: a client-side strength meter plus a minimum-length rule (`apps/web/src/lib/validation.ts`); no third-party breach-database lookup is performed | A determined user can still choose a weak-but-valid password |
| Keylogger / screen capture | Device compromise | Outside scope; requires a clean device | Any device-level malware |
| Phishing | Fake login page | User education; self-hosted instances have user-chosen domains | Social engineering |

### 3.2 DEK (items key)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Extraction from server | Server breach | Server never holds the DEK; it only stores the KEK-wrapped form | None: the server cannot unwrap without the KEK |
| Extraction from browser memory | Malicious extension, XSS | DEK stored in a Symbol-keyed slot; no script can enumerate Symbols from another origin; CSP restricts script and connect sources to self (no third-party origins) | A malicious extension with full page access can read `globalThis` |
| DEK persistence to disk | Browser storage APIs | The raw DEK is never written to disk; only a copy wrapped under a non-extractable AES-GCM key (its bytes unexportable by script or devtools) is held in IndexedDB, and it is purged on window expiry, lock, and logout | A wrapped copy is at rest for at most 15 minutes, usable only as an unwrap oracle on the live origin; not encryption-at-rest against OS-level disk access during that window |
| Loss of DEK on page reload | Tab close | A reload (`navigation.type === "reload"`) within the window unwraps the persisted copy locally and resumes with no master password, username, or server round-trip. An installed PWA treats any cold launch (not a reload) as a close and requires the master password immediately; a browser tab locks instantly in private browsing and within 15 minutes in normal browsing | In a browser tab, a reopen within 15 minutes of last activity unlocks without the master password (bounded by the single 15-minute window); the installed PWA re-locks on any cold launch |
| Durable biometric wrapped copy of the DEK | Disk access to `privance.biometric` IndexedDB | When biometric unlock is enrolled, a second durable wrapped copy of the items key exists in `privance.biometric` IndexedDB for up to 14 days after the last password-derived unlock. An attacker with disk access to that store obtains: the RSA-OAEP ciphertext of the items key (wrapped under the protector public key), and the AEAD ciphertext of the protector private key (sealed under a KEK derived from the passkey's PRF output). The PRF output never leaves the platform authenticator; recovering the items key from the stored blobs requires the authenticator to perform biometric user verification. A same-origin script compromise is already accepted as full session compromise (see 3.9); biometric enrollment adds the ability to delay the cadence purge by overwriting the script-writable `lastPasswordUnlockAt` timestamp, but this cannot bypass the PRF gate. The wrapped items-key copy is destroyed on cadence expiry (14 days; the enrollment bookkeeping, which holds no user key material, survives so a password unlock can re-arm without re-enrollment), and the full record is purged on logout, user mismatch (a different userId in the record triggers purge on next load), and tamper-detected unwrap failure (AES-GCM tag mismatch throws `DecryptionError` and triggers purge). | The durable biometric blob extends the at-rest window from 15 minutes to 14 days; within that window the items key is recoverable only via the platform authenticator's hardware-gated PRF output. Biometric unlock is opt-in and absent unless the user enrolls. Private browsing wipes the store on session end. |

### 3.3 Recovery phrase

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Phrase exfiltration by server | Server logging | Phrase is generated entirely in the browser from a client-side random seed; never transmitted | None: server never sees the phrase |
| Phrase guessing by server | Brute force on `recovery_blob` | The recovery blob is an HKDF auth hash of the Argon2id-stretched recovery phrase (re-hashed with Argon2id server-side before storage); guessing requires brute-forcing memory-hard Argon2id over the 128-bit BIP39 phrase space | None: brute force over 128-bit entropy behind Argon2id is infeasible |
| Loss of phrase | User loses it | Acknowledged: loss of password + phrase = permanent data loss by design | User must back up the phrase externally |
| Recovery abuse | Attacker attempts recovery | Rate limited: 5 attempts per username per hour, 10 per IP per hour; progressive backoff up to 8 s | Offline if attacker clones the DB |

### 3.4 Ciphertext at rest

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| DB dump by attacker | Server breach or insider | All financial records are AES-256-GCM encrypted; without the KEK the dump reveals nothing | Object kind and UUID metadata is visible |
| Record-swap attack | Attacker substitutes ciphertext from another record or another kind | AAD includes `{recordUuid, kind, labelVersion, kdfParamVersion}`; AES-GCM authentication tag will fail on mismatch | None: authentication is built into AES-GCM |
| Downgrade attack (weaker KDF params) | Attacker modifies KDF params stored in DB and forces a login | AAD's `kdfParamVersion` field binds the wrapped DEK to the param version; a tampered param version causes decryption failure | None: AAD binding prevents silent downgrade |
| Metadata leakage | Server observes object kind and count | Server sees how many records of each kind exist, but not their contents | Unavoidable: server needs kind to route sync |
| Ciphertext lingering on shared browser | User logs out on a shared device, leaving the per-user OPFS database on disk | Logout unlinks `/privance-<userId>.sqlite3` via `store.destroy()` on both paths: while unlocked the open store's worker runs the destroy; from the locked screen the sign-out derives the filename from the persisted (non-secret) userId and destroys via a short-lived worker. Lock keeps the file so re-unlock can resume from local cache | A crash or kill between logout intent and the destroy completing leaves the file until the next session's logout re-runs the cleanup |

### 3.5 Session cookie

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Cookie theft via XSS | Injected script | Cookie is `HttpOnly`; JavaScript cannot read it | None: HttpOnly is the canonical control |
| CSRF | Cross-site form submission | `X-Requested-With` header required on all mutations; SameSite=Lax on cookie | Requires CORS misconfiguration to exploit |
| Session fixation | Attacker pre-sets a known token | Sessions are server-generated and cryptographically random; no pre-set is accepted | None |
| Session hijacking (network) | Unencrypted traffic | Cookie is `Secure` in production; not sent over HTTP | Only mitigated by TLS; operator must configure it |

### 3.6 Invite tokens

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Token guessing | Online brute force against `POST /api/auth/signup` | 256-bit base64url random token at mint; SHA-256 at rest; atomic single-use claim via `UPDATE ... WHERE used_at IS NULL` | None if entropy is preserved on mint |
| Token reuse after claim | Replay of a previously-consumed token | Atomic UPDATE with `IS NULL` condition rejects the second claim | None |
| Operator-side token disclosure | Plaintext token visible to whoever sees the mint output | Tokens are written to stdout once at mint then unrecoverable; operator must hand off plaintext over a single-use ephemeral channel | Operator discipline |

### 3.7 Username

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Username enumeration | Probe `/api/auth/kdf-params` for different usernames | Unknown usernames receive deterministic fake KDF params derived via HKDF-SHA256 keyed on `ENUMERATION_SECRET` (label `finance/kdf-params/v1`); response timing is matched by running the fake derivation (`server/src/auth/kdf.ts:deriveFakeKdfSalt`) | Timing differences from OS scheduling are not fully eliminated |
| Username brute-force | Enumerate usernames in the Postgres DB | Requires DB access; once attacker has DB access, username confidentiality is already lost | Inherent to storing usernames |

### 3.8 Supply chain

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Malicious npm package | Dependency compromise | `pnpm audit` in CI and pre-push hook; exact-pinned versions in the lockfile | Zero-day in a pinned package before audit catches it |
| Compromised build pipeline | CI system compromise | _Planned:_ deterministic builds and artifact signing (not yet implemented) | Build-time injection is an acknowledged gap |
| Bundled returns dataset tampering | Upstream source modified at regeneration, or the dataset module edited in-repo | Recorded SHA-256 hash verified at core build and sim-worker bundling (fails on mismatch), with a Damodaran cross-check and Shiller spot-tests as secondary control | A commit changing both the dataset and its hash passes the gate; skewed data biases projections but cannot exfiltrate anything |

### 3.9 Operational bound

The zero-knowledge guarantee protects data **at rest**. Server-side records are ciphertext only and a database or filesystem grab reveals only ciphertext, salts, hashed session and invite tokens, and audit-event metadata. The guarantee does NOT extend to a user's NEXT interaction with a compromised host: the browser executes whatever JS the host serves, so an attacker with control of the served bundle can exfiltrate the master password on the next login.

### 3.10 Plan record and sim worker

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Plaintext sim inputs to the worker | `postMessage` to the same-origin sim worker read by a malicious extension or XSS | The worker gets no key material (no DEK, no ciphertext), only already-decrypted values the page holds | Same as 3.9: a same-origin compromise reads the same data from the UI; the worker adds no new exposure |
| PRNG seed exposure | Seed stored in the encrypted plan payload; accidental logging | Decrypted user data under the never-log contract; carries no key material | None beyond no-logging; the seed is a reproducibility aid, not a secret |
| Singleton metadata | The plan record's deterministic object id makes its presence (and post-deletion tombstone) identifiable among sync rows | Same metadata the server already sees per record (3.4): kind and id, never contents | Server learns whether a user has (or had) a plan; accepted, consistent with 3.4 |

---

## 4. Mitigations summary

### Cryptography

| Primitive | Usage | Implementation |
|---|---|---|
| **Argon2id** | Password → stretched master key | `hash-wasm` in the browser; params: `m=65536, t=3, p=4, len=64` (`packages/core/src/crypto/types.ts`) |
| **HKDF-SHA256** | Stretch → KEK, auth hash, recovery seed | `@noble/hashes/hkdf` (`packages/core/src/crypto/hkdf.ts`) |
| **AES-256-GCM** | Envelope encryption of all data blobs | `@noble/ciphers/aes` (`packages/core/src/crypto/aead.ts`) |
| **BIP39 (12 words)** | Recovery phrase encoding of recovery seed | `@scure/bip39` (`packages/core/src/crypto/recovery.ts`) |
| **Constant-time comparison** | Byte comparison of secrets | `equalBytes` from `@noble/ciphers/utils` (`packages/core/src/crypto/compare.ts`) |

### HKDF label versioning

Labels are frozen constants in `packages/core/src/crypto/labels.ts`:

```
finance/auth-v1      , derives the auth hash sent to the server
finance/kek-v1       , derives the Key Encryption Key
finance/recovery-v1  , derives the recovery seed (entropy for BIP39 phrase)
finance/biometric-v1 , derives the KEK that seals the biometric protector key
```

Bumping any label is a migration requiring coordinated key re-wrap across all existing user records. It is not a code change.

### AAD binding

Every encrypted record's AES-GCM tag authenticates:
```json
{ "recordUuid": "<uuid>", "kind": "<account|holding|...>", "labelVersion": 1, "kdfParamVersion": 1 }
```
This prevents record-swap (same kind, different UUID), cross-kind swap (e.g. swapping an account ciphertext under a holding's UUID), replay, and downgrade attacks at the ciphertext layer.

### Server-side rate limiting

Implemented in `server/src/auth/rate-limit.ts` using sliding-window counters and progressive exponential backoff:

| Endpoint | Limit |
|---|---|
| Signup | 3 per IP per 60 s |
| Login | 5 per username per 60 s; 20 per IP per 60 s |
| Login backoff | 250 ms base, 4 s cap, doubles per consecutive failure |
| Recovery | 5 per username per hour; 10 per IP per hour |
| Recovery backoff | 500 ms base, 8 s cap |

### CSRF

`X-Requested-With` header enforced globally on all non-safe methods via `server/src/core/middleware.ts:requireCsrfHeader`. Applied to the `/api/*` prefix.

### Password quality

Password quality is enforced entirely on the client: an advisory strength meter (`apps/web/src/components/auth/PasswordStrength.tsx`) plus a minimum-length rule at signup, password change, and recovery (`apps/web/src/lib/validation.ts`). Privance performs no third-party breach-database lookup, consistent with making no unnecessary calls to external services; the password never leaves the device in any form.

---

## 5. Out-of-scope threats (acknowledged)

- **Device-level malware.** Any malware with OS-level access can read browser memory.
- **Malicious operator.** An operator who ships a modified bundle can subvert all
  client-side crypto. Self-hosting is the primary mitigation; the AGPL license requires source disclosure for distributed binaries.
- **Side-channel attacks on JS crypto.** Browser JavaScript does not provide
  hardware-level constant-time guarantees. The `@noble` libraries do their best; the residual risk in adversarial shared-CPU environments is acknowledged.
- **Metadata traffic analysis.** The server observes sync request timing, frequency,
  and record counts. Financial behavior patterns may be inferable from metadata alone.

---

## 6. Future work

- Deterministic builds and artifact signing
- Subresource Integrity for all first-party scripts
- Formal security audit of the crypto layer

Content-Security-Policy headers are already in place: API responses are set by `server/src/core/app.ts` (`default-src 'none'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`); web responses are set by the reverse proxy in `infra/Caddyfile`.
