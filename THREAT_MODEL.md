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
| **DEK (Data Encryption Key / items key)** | AES-256 key for all user data; wrapped by KEK at rest | Browser JS memory via `globalThis[Symbol.for("privance.dekStore.v1")]`; lost on tab close |
| **Recovery phrase** | 12-word BIP39 mnemonic; backup path to the DEK | User's physical possession only; never stored by the server |
| **Recovery DEK wrap** | DEK wrapped under a key derived from the recovery phrase | Postgres (ciphertext only) |
| **Ciphertext at rest** | All financial records (accounts, holdings, transactions) | Postgres `sync_objects`, opaque blobs |
| **Session cookie** | HTTP-only session token | Browser cookie jar + Postgres sessions table |
| **Username** | Plaintext account identifier | Postgres, server sees this |
| **KDF parameters and salt** | Argon2id parameters and per-user salt | Postgres, required for login |
| **Object metadata** | Record kind, UUID, version, tombstone flag | Postgres `sync_objects`, server sees kind and count, not contents |

---

## 3. Threats per asset

### 3.1 Master password

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Password guessing (online) | Repeated login attempts | Rate limiting: 5 attempts per username per 60 s, 20 per IP per 60 s; progressive backoff up to 4 s per attempt (`server/src/auth/rate-limit.ts`) | Offline attack if attacker obtains KDF salt |
| Password compromise via data breach | Credential stuffing | HIBP k-anonymity check on signup rejects known-breached passwords | Passwords breached after signup |
| Keylogger / screen capture | Device compromise | Outside scope; requires a clean device | Any device-level malware |
| Phishing | Fake login page | User education; self-hosted instances have user-chosen domains | Social engineering |

### 3.2 DEK (items key)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Extraction from server | Server breach | Server never holds the DEK; it only stores the KEK-wrapped form | None: the server cannot unwrap without the KEK |
| Extraction from browser memory | Malicious extension, XSS | DEK stored in a Symbol-keyed slot; no script can enumerate Symbols from another origin; CSP restricts inline scripts | A malicious extension with full page access can read `globalThis` |
| DEK persistence to disk | Browser storage APIs | DEK is never written to localStorage, sessionStorage, IndexedDB, or any persistent storage | Browser crash recovery retains nothing |
| Loss of DEK on page reload | Tab close | By design: reload = re-auth. This is the zero-knowledge tradeoff | User friction; mitigated by 30-min auto-lock idle timer with activity reset |

### 3.3 Recovery phrase

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Phrase exfiltration by server | Server logging | Phrase is generated entirely in the browser from a client-side random seed; never transmitted | None: server never sees the phrase |
| Phrase guessing by server | Brute force on `recovery_blob` | Recovery blob is an HMAC authenticator derived from the KEK, not from the phrase directly; guessing requires knowing the KEK | None beyond theoretical preimage attack |
| Loss of phrase | User loses it | Acknowledged: loss of password + phrase = permanent data loss by design | User must back up the phrase externally |
| Recovery abuse | Attacker attempts recovery | Rate limited: 5 attempts per username per hour, 10 per IP per hour; progressive backoff up to 8 s | Offline if attacker clones the DB |

### 3.4 Ciphertext at rest

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| DB dump by attacker | Server breach or insider | All financial records are AES-256-GCM encrypted; without the KEK the dump reveals nothing | Object kind and UUID metadata is visible |
| Record-swap attack | Attacker substitutes ciphertext from another record or another kind | AAD includes `{recordUuid, kind, labelVersion, kdfParamVersion}`; AES-GCM authentication tag will fail on mismatch | None: authentication is built into AES-GCM |
| Downgrade attack (weaker KDF params) | Attacker modifies KDF params stored in DB and forces a login | AAD's `kdfParamVersion` field binds the wrapped DEK to the param version; a tampered param version causes decryption failure | None: AAD binding prevents silent downgrade |
| Metadata leakage | Server observes object kind and count | Server sees how many records of each kind exist, but not their contents | Unavoidable: server needs kind to route sync |

### 3.5 Session cookie

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Cookie theft via XSS | Injected script | Cookie is `HttpOnly`; JavaScript cannot read it | None: HttpOnly is the canonical control |
| CSRF | Cross-site form submission | `X-Requested-With` header required on all mutations; SameSite=Lax on cookie | Requires CORS misconfiguration to exploit |
| Session fixation | Attacker pre-sets a known token | Sessions are server-generated and cryptographically random; no pre-set is accepted | None |
| Session hijacking (network) | Unencrypted traffic | Cookie is `Secure` in production; not sent over HTTP | Only mitigated by TLS; operator must configure it |

### 3.6 Username

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Username enumeration | Probe `/api/auth/kdf-params` for different usernames | Unknown usernames receive deterministic fake KDF params derived via HMAC-SHA256 keyed on `ENUMERATION_SECRET`; response timing is matched by running the fake derivation (`server/src/auth/login-service.ts:deriveFakeKdfSalt`) | Timing differences from OS scheduling are not fully eliminated |
| Username brute-force | Enumerate usernames in the Postgres DB | Requires DB access; once attacker has DB access, username confidentiality is already lost | Inherent to storing usernames |

### 3.7 Supply chain

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| Malicious npm package | Dependency compromise | `pnpm audit` in CI and pre-push hook; exact-pinned versions in the lockfile | Zero-day in a pinned package before audit catches it |
| Compromised build pipeline | CI system compromise | _Planned:_ deterministic builds and artifact signing (not yet implemented) | Build-time injection is an acknowledged gap |

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
finance/auth-v1     , derives the auth hash sent to the server
finance/kek-v1      , derives the Key Encryption Key
finance/recovery-v1 , derives the recovery seed (entropy for BIP39 phrase)
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

### HIBP

The server-side check (`server/src/auth/hibp.ts`) uses the k-anonymity range API: only the first 5 hex characters of the SHA-1 hash of the auth hash are transmitted. Fail-closed: if HIBP is unreachable the server returns an error and blocks signup with a clear message. It does not silently allow the password through.

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

- Deterministic builds and artifact signing (planned)
- Subresource Integrity for all first-party scripts
- Content-Security-Policy headers: API side done (`server/src/core/app.ts` sets `default-src 'none'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`). Web-side CSP belongs in the reverse-proxy / deploy config, not the static export, this is tracked in the deploy infra backlog.
- Formal security audit of the crypto layer
