# Privance — Production Spec

A self-hostable, zero-knowledge personal finance application. Server stores ciphertext only; all cryptography runs in the browser. Loss of master password and recovery phrase results in permanent data loss by design.

This document is the canonical design contract for the build. Every implementation decision references this file. Changes to this file require explicit review.

---

## 1. Identity

**Privance** is:
- A personal finance application — net-worth tracking, investment + cash account ledger, holdings with cost basis, daily price refresh, portfolio insights, future FIRE / retirement projections.
- **Zero-knowledge** — the server stores only ciphertext and the minimum metadata required to operate. All encryption, decryption, and financial computation runs in the user's browser. The server is structurally incapable of reading user financial data.
- **Self-hostable** — ships as a single `docker compose up` deployment with no SaaS dependencies. Users may run their own instance or use the operator-hosted instance at `privance.app`.
- **Local-first** — the user's device is the source of truth for their data. Sync to a server is optional; offline-only mode is supported.
- **Privacy-preserving by default** — no telemetry, no analytics, no third-party trackers, no IP or User-Agent logging beyond what is strictly required for rate limiting (and that retention is short-lived and hashed).

## 2. Goals

1. **Trust through verification.** A user who reads the code or audits the deployment can verify that Privance cannot access their financial data, period.
2. **No vendor lock-in.** The user can export their data at any time, switch between local-only, self-hosted, and operator-hosted modes, and host their own instance with no managed dependencies.
3. **Cross-platform.** Installable as a Progressive Web App on iOS, Android, macOS, Windows, and Linux. The same codebase is structured to support future native builds (iOS/Android via Expo, desktop via Tauri) without UI rewrites.
4. **High-quality engineering as a first principle.** Code is typed end-to-end, tested at high coverage, audited for security, documented sufficiently for a new contributor to be productive in a day.
5. **Operator simplicity.** A single operator can deploy, maintain, back up, restore, and rotate secrets without specialized infrastructure knowledge.

## 3. Non-goals

- Multi-region deployment, managed Postgres, CDN, or auto-scaling. One stack on one host.
- Bank integrations (Plaid, SnapTrade, Yodlee). Holdings and transactions are user-entered or imported via CSV. Direct bank linkage is fundamentally incompatible with zero-knowledge.
- Shared / joint accounts in v1. Multi-recipient encryption is a future spec.
- Tax filing or jurisdiction-specific tax computation. We surface unrealized gains and dividend history; users handle their own tax reporting.

## 4. Architecture

### 4.1 Topology

```
┌──────────────────────────────────────────────────────────────┐
│                    User's device                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Privance (Expo Universal / PWA)                       │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ packages/core (TypeScript)                       │  │  │
│  │  │  - crypto: Argon2id, AES-GCM, HKDF, BIP39       │  │  │
│  │  │  - decimal math: networth, deltas, allocations  │  │  │
│  │  │  - domain types: account, holding, price, ...   │  │  │
│  │  │  - sync client: encrypted-blob push/pull         │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ apps/web (Expo Router + RN-Web + NativeWind)     │  │  │
│  │  │  - Dashboard, accounts, holdings, prices         │  │  │
│  │  │  - Auth flow, recovery phrase, settings          │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ Local storage: SQLite (SAHPool VFS on web)       │  │  │
│  │  │  - Source of truth for user data                 │  │  │
│  │  │  - All values stored ciphertext at rest          │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                            │                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │  HTTPS  (only ciphertext + auth tokens)
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                   Server (optional)                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Caddy (auto-TLS, security headers, reverse proxy)      │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         │                                    │
│  ┌──────────────────────▼─────────────────────────────────┐  │
│  │ Hono on Bun                                            │  │
│  │  - /auth/*: signup, login, recovery, session            │  │
│  │  - /sync/*: encrypted-blob CRUD + change feed           │  │
│  │  - /prices/*: provider proxy (server proxies the HTTP   │  │
│  │     request; never sees which user requested it for)    │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         │                                    │
│  ┌──────────────────────▼─────────────────────────────────┐  │
│  │ PostgreSQL 17 (encrypted blobs + auth material only)   │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Backup container (nightly pg_dump | restic → S3-compat)│  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Three deployment modes

A single Privance codebase supports three modes the user selects at signup:

1. **Offline-only.** The app runs entirely in the user's browser. SQLite holds all data. No server is contacted. Backup is via encrypted-file export the user manages themselves.
2. **Self-hosted sync.** The user runs `docker compose up` on their own VPS. The Privance app on each device syncs encrypted blobs to that user's server. Server still sees only ciphertext.
3. **Operator-hosted sync** (`privance.app`). Same as self-hosted but the operator (the Privance maintainer) runs the server. The trust model is identical — the operator cannot read user data — but operational simplicity is higher.

All three modes share the same client code. Selection happens at signup and can be changed later by exporting + re-importing.

### 4.3 Data flow

- **Local writes**: user creates an account / holding / transaction → encrypted in the browser → written to local SQLite → if sync is enabled, queued for push to server in background.
- **Local reads**: dashboard, accounts list, etc. read from local SQLite → decrypted in memory → rendered. No round-trip to server.
- **Sync push**: queued encrypted blobs are pushed to server `/sync/objects/{id}` with version + previous-version. Server rejects with HTTP 409 if previous-version is stale.
- **Sync pull**: on app open and periodically, client pulls `/sync/changes?since=<last_seq>` and applies new ciphertext to local SQLite. Conflicts surface to user via "keep mine / keep theirs" dialog.

The server never decrypts any user content. It validates session cookies, enforces per-user rate limits on auth endpoints, and serves opaque blobs.

## 5. Tech stack

All versions pinned exactly in the lockfile (no `^`) to mitigate supply-chain attacks. Bump policy is documented in §13.

### 5.1 Frontend / mobile / PWA

| Component | Version | Purpose |
|---|---|---|
| Expo SDK | 54.x (latest patch at install time) | Universal RN runtime (iOS + Android future + Web today) |
| expo-router | ≥ 6.0.19 | Routing |
| react-native-web | aligned to RN version in SDK 54 | Web target |
| NativeWind | 4.2.4 | Tailwind on RN + Web |
| Tailwind CSS | 3.4.17 | Style system (Tailwind 4 not yet supported on NativeWind 4.x track) |
| react-native-reanimated | 3.17.5 | Animations (v4 deferred — requires New Architecture) |
| Recharts | latest stable | Charts on web target |
| react-native-gifted-charts | 1.5.0 | Charts on native target (future) |
| TanStack Query | latest stable, exact-pinned in lockfile, audited against Shai-Hulud compromised set | Server state for sync |

A thin adapter in `packages/core/charts/` exposes identical props to both chart libraries so the calling code is identical across targets.

### 5.2 Backend

| Component | Version | Purpose |
|---|---|---|
| Bun | 1.3.14 | Runtime |
| Hono | ≥ 4.12.19 | Web framework |
| postgres.js | ≥ 3.4.9 | Postgres client (Bun.sql excluded — known production bugs) |
| Drizzle ORM | ≥ 0.45.2 | Typed schema + migrations |
| oRPC | ≥ 1.0 | End-to-end type-safe API + OpenAPI emission |
| Caddy | 2.11.2 | Reverse proxy + auto-TLS + security headers |
| PostgreSQL | 17.10 | Database |

### 5.3 Crypto

| Component | Version | Purpose |
|---|---|---|
| `@noble/hashes` | 2.2.0 | SHA-2, HKDF |
| `@noble/ciphers` | 2.2.0 | AES-GCM |
| `@scure/bip39` | 2.2.0 | Recovery phrase encoding |
| `hash-wasm` | 4.12.0 | Argon2id (noble explicitly excludes Argon2) |

WebCrypto API is used for `crypto.getRandomValues()` only. All KDF, AEAD, HKDF, BIP39 operations go through the audited noble/scure/hash-wasm stack for cross-platform parity.

### 5.4 Local storage

| Component | Version | Purpose |
|---|---|---|
| `@sqlite.org/sqlite-wasm` | 3.53.x | Browser SQLite via SAHPool VFS (no COOP/COEP required) |
| `expo-sqlite` | aligned to SDK 54 | Native SQLite (future iOS/Android) |

A thin adapter abstracts the two so feature modules use a single interface.

### 5.5 Tooling

| Component | Version | Purpose |
|---|---|---|
| pnpm | ≥ 10.28.2 | Package manager (workspaces) |
| Turborepo | 2.9.12 | Monorepo orchestration |
| Biome | 2.4.x | Lint + format (replaces ESLint + Prettier) |
| Vitest | latest stable | Unit + component tests |
| Playwright | latest stable | E2E (cross-browser: chromium + firefox) |
| `bun test` | bundled with Bun | Server-side unit tests |
| fast-check | latest stable | Property-based tests for crypto + math |
| TypeScript | latest stable, `strict: true`, `noUncheckedIndexedAccess: true` | |

### 5.6 Deployment

| Component | Purpose |
|---|---|
| Docker + Docker Compose v2 | Container orchestration |
| restic | Encrypted backup to S3-compatible storage |
| Healthchecks.io | External uptime monitoring |

## 6. Security model

### 6.1 Key hierarchy

```
master_password (user-typed, never transmitted)
       │
       ▼  Argon2id (m=64 MB, t=3, p=4, versioned)
stretched_master_key (512 bits)
       │
       ├──── HKDF(label="finance/auth-v1") ──── auth_hash (sent to server)
       │                                              │
       │                                              ▼
       │                                       server stores Argon2id(auth_hash, server_salt)
       │
       ├──── HKDF(label="finance/kek-v1") ──── KEK (key encryption key)
       │                                              │
       │                                              ▼
       │                                       AES-GCM wrap → items_key
       │                                              │
       │                                              ▼
       │                                       items_key wraps per-item DEKs
       │
       └──── HKDF(label="finance/recovery-v1") ──── recovery_seed
                                                      │
                                                      ▼ BIP39
                                              12-word recovery phrase (shown to user once)
```

Notes:
- **All HKDF labels are FROZEN.** Changing a label is a migration, not a code change.
- **Argon2id parameters are versioned in stored hashes.** Future parameter increases are migrations (expand/contract).
- **items_key indirection** allows DEK rotation without re-deriving from the master password. Rotation triggers a server-side mass re-encrypt of items_key only; per-item ciphertext is untouched.
- **AEAD AAD** includes `{record_uuid, label_version, kdf_param_version}` to prevent record-swap, downgrade, and silent label-version drift.

### 6.2 Persistence and unlock model

Three persistence levels are supported:

1. **In-memory only.** DEK lives in `globalThis[Symbol.for("privance.dekStore.v1")]` for the session. Cleared on tab close. Default for the most paranoid users.
2. **Session-scoped (default).** DEK encrypted with a random session-bound key, both stored in `sessionStorage`. Survives page refresh; cleared on tab close. Threat model is identical to level 1 (any JS that can read memory can read sessionStorage).
3. **Biometric-wrapped persistence (opt-in).** DEK wrapped with a key derived from a WebAuthn PRF credential. Wrapped DEK stored in IndexedDB. Credential lives in OS keychain (iCloud Keychain on iOS/macOS, platform authenticator elsewhere) — not extractable. On open, biometric prompt unwraps the DEK. Survives tab close, browser restart, device restart. Subject to occasional re-enrollment if browser storage is evicted (handled gracefully by falling back to master-password re-derive).

A user-facing **auto-lock** timer (default 30 min idle, configurable) clears the in-memory DEK and forces unlock again. Lock state issues `location.reload()` to scrub any V8-internal copies (memory hygiene).

### 6.3 Threat model

**Threats we mitigate:**
- **Server reads user data.** Impossible by construction — server holds only ciphertext + auth hashes. No code path on the server can produce plaintext.
- **Database leak / subpoena.** Attacker gets ciphertext + KDF parameters. Argon2id at m=64 MB makes offline brute-force infeasible for any reasonable password.
- **Network attacker.** TLS enforced; HSTS preload; certificate pinning not required because Let's Encrypt + DNS-validated.
- **Cross-site request forgery.** `X-Requested-With` header required on every state-changing route.
- **Session hijack.** Cookies are `HttpOnly`, `Secure`, `SameSite=Lax`. 30-day rolling expiry tied to server-side session row enables instant revocation.
- **Username enumeration.** Unknown usernames return deterministic fake KDF parameters at the same latency as real ones.
- **Replay / downgrade.** AEAD AAD binds record UUID and label-version; reusing ciphertext from a different record or older label fails decryption.
- **Memory scrape after lock.** Renderer reload after lock clears V8 internals.

**Threats we explicitly do not protect against:**
- **Compromised user device.** If an attacker has script execution in the user's browser or RAM access, they can read the DEK while the user is unlocked. This is fundamental to zero-knowledge web apps.
- **Malicious server pushes bad JavaScript.** A compromised operator or successful supply-chain attack on the build could ship a JS bundle that exfiltrates the DEK to the server. Mitigations: published threat model, AGPL-ish license requiring source disclosure, deterministic builds where feasible, content-security-policy that disallows external scripts.
- **Loss of master password and recovery phrase.** Data is permanently inaccessible. By design.

A full `THREAT_MODEL.md` is published alongside this spec.

### 6.4 Operational privacy promises

- **No IP logging beyond rate-limit windows.** Rate limiter stores a 24-hour sliding window of `hash(ip, salt)` — never the raw IP. After 24 hours, the hash is purged.
- **No User-Agent logging, ever.** Not in audit logs, not in HTTP access logs.
- **No telemetry.** The frontend makes zero network requests to anything other than the configured sync server.
- **No third-party trackers, fonts, or assets.** All assets bundled with the app.
- **Audit log records event class + user_id + timestamp only.** Not request bodies, not parameters, not response data. 90-day TTL with automatic prune at 02:00 UTC daily.

## 7. Module conventions

Every feature module follows the same shape. New modules mirror this exactly. No new patterns without justification.

### 7.1 Backend module template

```
server/src/<feature>/
├── index.ts          # Barrel — re-exports types, errors, schemas. Service classes NOT exported.
├── types.ts          # Errors (subclass <Module>Error), result types, domain constants
├── schema.ts         # Drizzle ORM table definitions
├── repo.ts           # ONLY layer that imports schema.ts. Kw-arg signatures via single options object.
├── wire.ts           # oRPC procedures (replaces both Pydantic wire types and FastAPI routes)
├── <flow>-service.ts × N  # One per cohesive flow. ≤ ~130 LOC each. Constructor takes options object with explicit deps.
└── _helpers.ts       # Module-level functions taking explicit deps (optional)
```

Service classes are exported from `index.ts` ONLY for the deps container; route handlers must obtain them via the container, not by importing the service file directly.

### 7.2 Frontend module template

```
apps/web/features/<feature>/
├── index.ts          # Barrel
├── types.ts          # Feature-local types (most types come from packages/core)
├── queries.ts        # TanStack Query query hooks
├── mutations.ts      # TanStack Query mutation hooks
├── components/       # UI components for this feature
└── screens/          # Route-level screens (mounted by expo-router)
```

### 7.3 Shared (packages/core)

```
packages/core/src/
├── crypto/           # Argon2id, AES-GCM, HKDF, BIP39, key wrapping, AAD construction
├── decimal/          # Money math, all values flow as Decimal
├── domain/           # Account, Holding, Price, NetWorthSnapshot, Group, AccountType, etc.
├── networth/         # computeNetWorth pipeline
├── sync/             # Sync client: queue, push, pull, conflict detection
├── storage/          # SQLite adapter (web SAHPool + native expo-sqlite behind one interface)
└── audit-events/     # Audit event type registry
```

### 7.4 Wiring rules

- **Repo as only layer that touches schema/ORM.** Services never call Drizzle directly.
- **Errors bubble.** Services throw typed errors (subclassing `<Module>Error`). oRPC procedures register a single error mapper per module that converts errors to HTTP status codes.
- **Two log channels, never merged.** Audit events via `repo.logEvent(...)`. Operational logs via the structured logger.
- **CSRF header required** on all state-changing oRPC procedures (enforced by middleware).
- **Services take options objects with kw-arg-style explicit deps** — never positional, never inferred.

## 8. Feature inventory (v1 = feature parity)

Modules to ship in v1, mirroring the current production app:

### 8.1 Auth (`auth/`)
- Signup: KDF derivation → DEK + items_key generation → recovery phrase shown
- Login: KDF re-derivation → auth hash sent → server verifies → session cookie returned
- Recovery: 12-word phrase → re-derive DEK → optionally reset master password
- Password change: re-encrypts items_key only (not all per-item ciphertext)
- Session management: 30-day rolling cookie, server-side session row, revocable
- Rate limiting: per-username sliding window with progressive backoff
- Username enumeration prevention: deterministic fake KDF parameters
- HIBP check on signup (k-anonymity, fail-open on timeout with clear error)
- Signup allowlist (env: `SIGNUP_ALLOWLIST`)

### 8.2 Accounts (`accounts/`)
- Cash accounts (checking, savings, money market, etc.)
- Investment accounts (brokerage, IRA, 401k, Roth, HSA, crypto, etc.)
- CRUD operations
- Account-level history (balances over time)

### 8.3 Holdings (`holdings/`)
- Holdings within an investment account: ticker, shares, cost basis
- Optional `proxy_ticker` + `scale_factor` for unfetchable assets (e.g., 401(k) CITs)
- User-defined groups for categorization
- CRUD operations

### 8.4 Prices (`prices/`)
- Manual price refresh (per-user server-enforced cooldown, default 60s)
- Server-side proxy to price provider (server receives ticker list only; sees no user identity in the upstream request)
- Daily net-worth snapshots stored as ciphertext for historical charting
- `DataSource` enum for pluggable provider implementations (Yahoo, CoinGecko, Manual, etc.)
- `SymbolProfile` table: ticker, FIGI/CUSIP/ISIN if available, asset class, asset sub-class — instrument metadata separate from per-user holdings

### 8.5 Dashboard
- Net-worth headline + Δ delta
- Historical chart (1D / 1M / 3M / 6M / 1Y / All)
- Portfolio table (by ticker default, by group toggle, totals row)
- Allocation donut
- Last-refreshed indicator

### 8.6 Activities (new in v1 — not in current production app)

Inspired by the canonical 14-type activity taxonomy. A future feature module that v1 stubs out at the schema level (tables exist; UI is read-only) and a later phase makes interactive:

`BUY | SELL | SPLIT | DEPOSIT | WITHDRAWAL | TRANSFER_IN | TRANSFER_OUT | DIVIDEND | INTEREST | CREDIT | FEE | TAX | ADJUSTMENT | UNKNOWN`

Each activity has documented side effects on cash balance, holdings shares, cost basis, and net contribution. v1 schema makes future activity-driven holdings derivation possible without migration.

### 8.7 Settings
- Persistence level (memory-only / session-scoped / biometric-wrapped)
- Auto-lock timer
- Mode toggle (offline-only / self-host URL / privance.app)
- Export encrypted data (for backup or migration between modes)
- Import encrypted data
- Manual refresh cooldown adjustment
- Theme (light / dark / system)

## 9. Sync protocol

### 9.1 Endpoints

```
PUT    /sync/objects/{id}
       { kind, ciphertext, nonce, version, prev_version? }
       → 200 { server_seq, version } | 409 { current_version }

GET    /sync/objects/{id}
       → 200 { kind, ciphertext, nonce, version, server_seq } | 404

GET    /sync/changes?since=<server_seq>&limit=<n>
       → 200 { changes: [{ id, kind, version, server_seq, ciphertext, nonce, tombstone }], next: <cursor> }

DELETE /sync/objects/{id}
       { prev_version }
       → 204 (writes tombstone) | 409

POST   /sync/batch
       { puts: [...], deletes: [...] }
       → 200 { results: [{ id, ok: true } | { id, ok: false, conflict: { current_version } }] }
```

### 9.2 Conflict resolution

- **Optimistic LWW with version check.** Client sends `prev_version`; server returns 409 if mismatch.
- **On 409**, client refetches the server's current ciphertext, decrypts, merges via UI dialog ("keep mine / keep theirs / both as new"), and resubmits.
- **Tombstones** are kept indefinitely at our scale (single-user typical, ≤ 10 users on operator-hosted).

### 9.3 Server schema (Drizzle)

```typescript
sync_objects:
  user_id     uuid (FK → users)
  object_id   text     // client-generated
  kind        text     // 'account' | 'holding' | 'price' | ...
  ciphertext  bytea
  nonce       bytea
  version     bigint   // client-assigned monotonic per object
  server_seq  bigserial // global monotonic per user
  updated_at  timestamptz
  tombstone   boolean default false
  PRIMARY KEY (user_id, object_id)
  INDEX ON (user_id, server_seq)
```

The server never inspects `ciphertext` or `nonce`. `kind` is plaintext but is a generic category, not user content.

## 10. Standards and quality bar

Every standard from the production app carries forward. Tightenings are noted as `(new)`.

### 10.1 Code quality
- **TypeScript strict mode** with `noUncheckedIndexedAccess: true` (new — stricter than current Python `mypy --strict`)
- **Zero `// @ts-ignore` / `@ts-expect-error`** without a tracked-issue comment justifying the deviation (mirror of current `# type: ignore` rule)
- **Biome 2.4** at default settings with security rules enabled (new — replaces ESLint + Prettier)
- **File size limits**: services ≤ ~130 LOC, files ≤ ~250 LOC
- **No `_private` cross-module access.** Add a public helper instead.
- **No comment pollution.** Default to no comment. Only add comments that explain non-obvious *why*.

### 10.2 Test discipline
- **Coverage gates:**
  - `packages/core`: ≥ 90% line + branch (new — raised from current 85% because this is where crypto + math lives)
  - `server`: ≥ 85% line
  - `apps/web`: ≥ 80% line for non-screen logic; E2E covers screens
- **Property-based tests** (new — `fast-check`) for crypto primitives, decimal math, sync conflict logic
- **Shared fixtures** in `<module>/conftest.ts` or equivalent. Never redeclared per-file.
- **Public-API-only assertions.** Tests never reach into `_private` names.
- **Stable selectors** in E2E: `getByRole` > `getByLabel` > `getByTestId`. Never Tailwind classes.
- **Distinct username per E2E test** (alice, bob, dave, …) for cleanState isolation.
- **`test.skip` requires a comment block** explaining what coverage is still present.

### 10.3 Security discipline
- All HKDF labels frozen. Label changes are migrations.
- Argon2id parameters versioned in stored hashes (new — supports painless future bumps)
- AEAD AAD binds record UUID + label version + kdf-param version (new)
- Constant-time comparisons for hashes + tokens (`@noble/hashes` `equalBytes`)
- Never log secrets, master passwords, DEKs, recovery phrases, or any decrypted user data
- `bun audit` + `pnpm audit` run in pre-commit and weekly CI cron (new)
- Exact-version pinning in lockfile for all dependencies; no `^` (new — post Shai-Hulud)
- `SECURITY.md` published with supported versions + disclosure process (new)
- `THREAT_MODEL.md` published with named threats + mitigations + explicit non-protections (new)
- Renderer reload on auto-lock to scrub V8 internals (new)

### 10.4 Operational privacy
- No IP logging beyond rate-limit sliding window of hashed IPs, 24-hour TTL (new — current production stores no IP at all; rate-limit hash is a deliberate, minimal exception)
- No User-Agent logging
- No telemetry, no analytics, no third-party assets
- Audit log: event class + user_id + timestamp; no bodies, no params
- 90-day audit prune, runs unconditionally at 02:00 UTC

### 10.5 Commit and branch discipline
- **Conventional Commits**: `feat / fix / refactor / chore / test / docs / ci` prefixes, scope optional
- **No Co-Authored-By trailer ever.** Verify before push.
- **Commit identity** = GitHub noreply (`40120869+rahulkrishnan1@users.noreply.github.com`)
- **Feature branches off main; squash-merge back.** main stays one commit per shipped feature.
- **Never force-push to main.** No exceptions.
- **Wait for CI green** before `gh pr merge --squash`. Never use `--auto`.
- **Delete feature branches** (local + remote) after merge.
- **Plan files are immutable** after the work ships.

### 10.6 Verification bar

Hitting these is necessary AND sufficient to claim "verified clean":

1. **packages/core**: `biome check` + `tsc --noEmit` + `vitest run` (coverage ≥ 90%) + `fast-check` properties pass
2. **server**: `biome check` + `tsc --noEmit` + `bun test` (coverage ≥ 85%) + `bun audit` clean
3. **apps/web**: `biome check` + `tsc --noEmit` + `vitest run` + `expo export` (web build green) + `pnpm audit` clean
4. **E2E**: Playwright suite passes on chromium + firefox against real browser + real backend + real Postgres (testcontainers). Skip rationale documented for any disabled tests.
5. **Manual smoke**: at least one signup → recovery-phrase → login → add account → add holding → dashboard cycle in a real browser before claiming any auth-touching change is complete.

If any of these is skipped, the work is explicitly NOT verified — state that explicitly in PR descriptions.

### 10.7 Documentation discipline
- `README.md` — what the app does + quick start (must work on a fresh clone)
- `CONTRIBUTING.md` — local dev workflow, conventions, pre-commit
- `CLAUDE.md` — conventions reference (this document referenced)
- `infra/README.md` — first-time deploy + day-N + rollback + restore + secret rotation + OPSEC checklist
- `THREAT_MODEL.md` — published threat model
- `SECURITY.md` — supported versions + disclosure process
- `docs/architecture/` — design contracts (this SPEC.md, future feature specs)
- Specs are forward-looking architecture; never reference peer apps in spec or design docs

## 11. Repository layout

```
privance/
├── apps/
│   └── web/                  # Expo Universal app (PWA today, native later)
├── packages/
│   └── core/                 # Shared TypeScript: crypto, math, domain, sync, storage
├── server/                   # Hono on Bun: auth + sync + price proxy
├── infra/
│   ├── Caddyfile             # Reverse proxy config
│   ├── backup/               # restic backup container
│   └── README.md             # Operations runbook
├── docs/
│   ├── architecture/         # Design docs
│   ├── decisions/            # ADR-style records for non-obvious decisions
│   └── ...
├── secrets/                  # File-based secrets (gitignored; .gitkeep tracked)
├── .env.production.example
├── .env.example
├── compose.yaml              # Dev: just Postgres
├── compose.prod.yaml         # Production: full stack
├── package.json              # pnpm workspaces root
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── tsconfig.base.json
├── README.md
├── CONTRIBUTING.md
├── CLAUDE.md
├── THREAT_MODEL.md
├── SECURITY.md
└── LICENSE
```

## 12. Deployment

### 12.1 Local dev

```bash
cp backend/.env.example backend/.env
pnpm install
pnpm dev   # starts: Postgres (Docker), server (Bun), apps/web (Expo Web)
```

`pnpm dev` brings up the full stack with sensible defaults matching the dev compose file.

### 12.2 Production via Docker Compose

`compose.prod.yaml` defines the full self-host stack:

- **caddy** — reverse proxy, auto-TLS via Let's Encrypt, security headers (HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy locked-down)
- **web** — Expo Web static export served by Caddy
- **server** — Hono on Bun
- **migrate** — one-shot Drizzle migration runner (`depends_on: service_completed_successfully` from server)
- **postgres** — PostgreSQL 17.10
- **backup** — Alpine + `pg_dump | restic --stdin` to S3-compatible storage; nightly 03:00 UTC; retention 7d/4w/6m

Per-service hardening: `cap_drop: ALL`, `security_opt: ["no-new-privileges:true"]`, `read_only: true` rootfs with explicit `tmpfs:` for write paths, memory + PID limits, healthchecks, digest-pinned upstream images.

Two compose networks (`edge` + `data`) so Postgres is unreachable from the host.

File-based secrets via Compose `secrets:` mounted at `/run/secrets/<name>`. Backend reads via `PRIVANCE_SECRETS_DIR=/run/secrets`.

### 12.3 Backups

Nightly `pg_dump --format=custom | restic backup --stdin --stdin-filename privance.dump` to S3-compatible storage (Cloudflare R2 free tier covers typical scale). Backup container streams; plaintext dump never touches disk.

`restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune` runs as part of each backup.

Restore drill is part of the operations runbook and is required at launch + monthly.

### 12.4 First-time deploy and operator runbook

Full step-by-step in `infra/README.md`. Includes:

- Domain registrar selection
- VPS provisioning (any 2 vCPU / 4 GB / 40 GB SSD host)
- Ubuntu 24.04 hardening (non-root user, SSH key-only, ufw, fail2ban, unattended-upgrades with auto-reboot, Docker log rotation)
- Secret generation (`openssl rand -base64 48` for each)
- DNS A/AAAA record setup
- First deploy (`docker compose -f compose.prod.yaml up -d --build`)
- Verification (HTTPS, HSTS, CSP, cookies)
- Backup test
- Restore drill
- Caddy ACME data backup
- Uptime monitoring (Healthchecks.io)
- 2FA on every operational account

### 12.5 Day-N deploys

```bash
ssh prod
cd /opt/privance
sudo git pull origin main
sudo docker compose -f compose.prod.yaml up -d --build
sudo docker compose -f compose.prod.yaml logs -f --tail 50
```

Brief 5–10 second 502 window during rebuild + restart is acceptable. Migrate service runs `alembic upgrade head` equivalent (Drizzle) before backend starts; failed migration blocks deploy.

## 13. Bump policy

- **Security patches**: applied within 7 days of release. Verified via `bun audit` + `pnpm audit` weekly CI cron that opens an issue when a new advisory matches a pinned dep.
- **Minor versions**: evaluated on a 30-day cadence. Bump if no breaking changes observed in changelog or community channels.
- **Major versions**: evaluated case-by-case with explicit migration ADR in `docs/decisions/`.
- **Lockfile is the source of truth.** All bumps go through PRs with the bump justification in the commit body.

## 14. Success criteria for "v1 done"

All of the following must be true:

1. Local dev experience: fresh clone → `pnpm install` → `pnpm dev` → app boots in browser → signup works → recovery phrase shown → dashboard renders. No undocumented manual steps.
2. Production stack: `compose.prod.yaml up -d --build` on a fresh Ubuntu 24.04 box → Caddy issues cert → app reachable on configured domain → signup works in real browser.
3. All v1 feature modules (auth, accounts, holdings, prices, dashboard) reach feature parity with the current production app.
4. Three sync modes operational: offline-only, self-hosted, operator-hosted. All three exercised in E2E.
5. Persistent unlock works on iOS Safari 18.4+, macOS Safari 18+, Chrome 132+, Edge 132+. Refresh stays logged in (default session-scoped); Touch ID enrolment + unlock works (opt-in biometric).
6. Test gates green on CI: ≥ 90% coverage on `packages/core`, ≥ 85% on `server`, ≥ 80% logic coverage on `apps/web`, full E2E suite (chromium + firefox) green, manual smoke green.
7. All documentation published: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `infra/README.md`, `THREAT_MODEL.md`, `SECURITY.md` written, accurate, and verified against the code.
8. Backups proven: nightly backup runs successfully, restore drill exercised end-to-end on a throwaway DB.
9. No critical or high CVEs in any pinned dependency.
10. Operator-hosted instance live at `privance.app` with the signup flow working end-to-end for a fresh user.

## 15. Out of scope for v1

The following features are explicitly deferred but the architecture must not preclude them:

- Native iOS / Android via EAS Build
- Native desktop via Tauri
- FIRE / retirement projections + Monte Carlo
- Portfolio insights (sector allocation, geographic, drift from target, dividend tracking)
- AI-driven categorization or natural-language queries (browser-side LLM, user-provided API key)
- Multi-recipient (joint) accounts
- Native broker integrations
- Tax-lot accounting + capital gains reports
- Activities interactive UI (schema is laid; UI is the next phase)
- Recent Activity / Active Sessions UI

---

End of spec.
