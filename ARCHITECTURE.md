# Architecture

Use this map for cross-workspace changes, routing, and data flow. Module conventions live in the [server](server/README.md#module-conventions), [core](packages/core/README.md#module-conventions), and [web](apps/web/README.md#feature-conventions) READMEs; [SECURITY.md](SECURITY.md#security-contracts-for-changes) owns security contracts. Diagrams summarize behavior; linked source files define current schemas and interfaces.

## High-level diagram

```
User's device  (browser)
│
├─ apps/web  ── Vite 8 static SPA (React Router v8)
│   ├─ React 19 + Tailwind 4 + TanStack Query 5 + Zod
│   ├─ /          landing page  (auth-aware: redirects signed-in users to /app/)
│   ├─ /auth/*    unauthenticated flows  (signup, login, recovery)
│   ├─ /unlock    locked: session exists but DEK not in memory
│   └─ /app/*     auth-gated  (investments overview at /app, plus accounts, holdings, plan, spend, settings)
│
├─ providers/  ── React-context wiring
│   ├─ AuthProvider    auth state machine + DEK store
│   ├─ SyncProvider    LocalStore + SyncClient lifecycle
│   └─ QueryProvider   TanStack Query cache
│
├─ packages/core  ── pure TypeScript, no DOM
│   ├─ crypto/      Argon2id, HKDF, AES-GCM, BIP39
│   ├─ decimal/     BigInt minor-unit arithmetic
│   ├─ domain/      Account, Holding, Price types
│   ├─ sync/        SyncClient  (push / pull / reconcile)
│   ├─ storage/     LocalStore interface + WebSqliteAdapter
│   ├─ networth/    Net-worth aggregation
│   └─ projection/  FIRE simulation engine (Monte Carlo + historical replay)
│
├─ Web Worker  (/sqlite/privance-worker.mjs)
│   └─ @sqlite.org/sqlite-wasm: SAH Pool VFS (OPFS-backed) with in-memory fallback
│
├─ Web Worker  (/sim/sim-worker.mjs)
│   └─ core projection engine bundled at build time; plaintext sim inputs, no DEK
│
└─ Web Worker  (/kdf/kdf-worker.js)
    └─ Argon2id off the main thread for login/signup; main-thread hash-wasm fallback

         ↕  HTTPS + CSRF (X-Requested-With)
            encrypted financial records; auth proofs, metadata, and public-price requests

Bun + Hono server  (server/)
├─ /health                     liveness probe
├─ /api/auth/*                 signup, login, logout, recovery, session, password
├─ /api/sync/*                 ciphertext blob CRUD + change feed
├─ /api/account/*              vault destruction (password-gated)
├─ /api/prices/*               market-price proxy
├─ /api/symbol-profiles/*      symbol metadata proxy
└─ middleware                  CORS, secureHeaders, requireCsrfHeader

         ↓  postgres.js + Drizzle ORM

PostgreSQL 17
├─ auth schema   users, sessions, audit_events, invite_tokens
└─ sync schema   sync_objects  (kind, object_id, ciphertext, nonce)
```

---

## Module structure

### `apps/web/`: static SPA / PWA

The public-facing web application. It is a **static SPA** , no SSR, no API routes in the app layer. All server communication goes to the Bun/Hono server.

- `src/app/` composes route screens; see [Routing](#routing) for the route map.
- `src/features/` owns feature queries, mutations, and components. Dashboard is an Invest sub-module, not a route.
- `src/lib/` owns API wrappers, browser crypto/storage, worker clients, and server-backed price/profile queries.
- `src/providers/` owns auth, local-store/sync lifecycle, and query-cache wiring.

The [web key-file map](apps/web/README.md#key-files) identifies the entry points. Dependencies include `packages/core` and `@sqlite.org/sqlite-wasm` (via Worker).

### `server/`: Bun + Hono API

The backend. Stores only opaque ciphertext in Postgres. Has no ability to decrypt user data.

```
server/src/
├── index.ts               # Entry point: wires feature routers, starts maintenance tasks
├── core/
│   ├── app.ts             # createApp(): mounts CORS, secureHeaders, CSRF middleware
│   ├── db.ts              # Drizzle + postgres.js connection
│   ├── middleware.ts      # requireCsrfHeader
│   └── logger.ts          # pino logger
├── auth/                  # Signup, login, recovery, password-change, sessions
│   ├── wire.ts            # Hono routes; single error mapper
│   ├── middleware.ts      # requireSession session gate (used by all protected routers)
│   ├── login-service.ts
│   ├── signup-service.ts
│   ├── recovery-service.ts
│   ├── password-service.ts
│   ├── session-service.ts
│   ├── invite-service.ts  # Invite-token mint + atomic single-use claim
│   ├── repo.ts            # Only layer that queries auth tables
│   ├── rate-limit.ts      # Sliding-window + progressive backoff (in-memory)
│   └── kdf.ts             # Server-side argon2id for auth-hash storage
├── sync/                  # Encrypted blob CRUD + change feed
│   ├── wire.ts
│   ├── sync-service.ts
│   └── repo.ts
├── account/               # Password-gated vault destruction (cascade delete)
├── prices/                # Market-price refresh proxy + Postgres cache (Yahoo, CoinGecko)
└── symbol-profiles/       # Symbol metadata + sector weightings (Yahoo upstream, cached)
```

**Dependencies on:** `packages/core` (domain types, audit event constants only , no crypto).

### `packages/core/`: shared TypeScript library

Pure TypeScript. No DOM, no Bun, no Node built-ins. Can run in the browser, in a Web Worker, or in a Node/Bun test harness.

The [core README](packages/core/README.md) maps key files and module boundaries; [`packages/core/package.json`](packages/core/package.json) defines the public export paths.

---

## Data flow

### Create account (mutation)

```
UI (AccountForm)
  → useCreateAccount().create(input)
    → encrypt payload JSON with DEK (AES-GCM, AAD = {recordUuid, kind, labelVersion=1, kdfParamVersion=1})
    → useSync().save(encrypted outbound item)
      → store.putAndEnqueue(item)                    ← one object + queue transaction
      → OPFS: return local-first success, push in background (retry on failure)
      → memory: await exact queue-ID server confirmation before reporting success

SyncClient.pushPending()
  → store.drainQueue()
  → POST /api/sync/batch { puts: [{object_id, kind, ciphertext, nonce, version}] }
  → server writes row to sync_objects (ciphertext only)
  → server returns {results: [{id, ok, server_seq, version}]}
  → store.ackQueueItem(queueId, {version, serverSeq}) ← atomic identity-safe confirmation
  → onConfirmed([queueId])                          ← also for background/early-batch uploads
```

Create forms retain one object ID across retries within the same open form session. An edited retry appends a revision to that object instead of creating a duplicate or resetting versions; a newly opened create intent gets a new ID. Lost-response conflicts retain pending revisions for explicit resolution. Accepting the server version uses `ackQueueItem(queueId, undefined, serverEnvelope)` to atomically remove only that captured intent and apply the matching server envelope only if no intent remains for its object ID. An absent queue ID is a no-op; a failed write retains the queue entry and local data. Discards do not emit `onConfirmed`.

### Sync pull

```
SyncClient.pullChanges()
  → store.getCursor()   ← last known server_seq
  → GET /api/sync/changes?since=<cursor>&limit=100
  → for each change:
      if tombstone: store.put(..., tombstone=true)
      else:
        decryptEnvelope(ciphertext, nonce, objectId)   ← verify AAD; discard on failure
        store.put(kind, objectId, ciphertext, nonce, version, serverSeq)
  → store.setCursor(maxServerSeq)
```

### Login / unlock

```
User enters username and password
  → GET /api/auth/kdf-params?username            ← real or deterministic fake parameters
  → stretchMasterPassword(password, kdfSalt, argon2id params)  ← hash-wasm Argon2id in browser
  → deriveAuthHash(stretchedKey)                ← HKDF finance/auth-v1, 32 bytes
  → POST /api/auth/login { username, auth_hash }
  → server verifies argon2id(auth_hash) against stored hash
  → server returns { wrapped_dek, wrapped_dek_iv }
  → deriveKek(stretchedKey)                     ← HKDF finance/kek-v1, 32 bytes
  → AES-GCM decrypt(wrapped_dek, kek, wrapped_dek_iv)  ← produces items key (DEK)
  → store DEK in globalThis[Symbol.for("privance.dekStore.v1")]
  → wrap DEK under a fresh non-extractable AES-GCM key, persist {wrapped, key, lastActiveAt} in IndexedDB
  → AuthContext state → "unlocked"
  → SyncProvider boots LocalStore + SyncClient
```

**Boot and locking:** [`AuthProvider`](apps/web/src/providers/auth-context.tsx) stays `loading` while reading the [session vault](apps/web/src/lib/storage/session-vault.ts). A fresh wrapped key restores `unlocked`; an absent, expired, or explicitly locked vault resolves to `locked` and `/unlock`. Activity slides the 15-minute restore window. Expiry is enforced by the running app and on subsequent reads, not by timed deletion while the app is closed. Non-secret username/userId values in `localStorage` support the locked screen. [ADR-0004](docs/adr/0004-session-persistence.md) records the browser-tab versus installed-PWA behavior.

**Biometric unlock:** an optional, user-scoped enrollment provides a second path from `locked` to `unlocked`, while password unlock remains available. Browser ceremonies live in [`webauthn-prf.ts`](apps/web/src/lib/crypto/webauthn-prf.ts), enrollment persistence in [`biometric-store.ts`](apps/web/src/lib/storage/biometric-store.ts), and protector-key crypto in [`core/crypto/biometric.ts`](packages/core/src/crypto/biometric.ts). [ADR-0005](docs/adr/0005-biometric-unlock.md) owns the key hierarchy and password-unlock cadence; [the DEK threat analysis](THREAT_MODEL.md#32-dek-items-key) records residual risks.

---

## Crypto flow

### Signup

```
1. Client generates random DEK (32-byte AES-256 key)
2. Client generates random kdf_salt (16 bytes)
3. Argon2id(password, kdf_salt) → stretchedMasterKey (64 bytes)
4. HKDF(stretchedMasterKey, label="finance/auth-v1")  → authHash (32 bytes)
5. HKDF(stretchedMasterKey, label="finance/kek-v1")   → KEK (32 bytes)
6. HKDF(stretchedMasterKey, label="finance/recovery-v1") → recoverySeed (16 bytes)
7. BIP39(recoverySeed) → 12-word recovery phrase  [shown to user, never stored]
8. Argon2id(recoverySeed, recovery_salt) → recoveryKEK
9. AES-GCM-encrypt(DEK, KEK)           → wrapped_dek + wrapped_dek_iv
10. AES-GCM-encrypt(DEK, recoveryKEK)  → wrapped_dek_recovery + wrapped_dek_recovery_iv
11. POST /api/auth/signup {
      auth_hash, kdf_salt, kdf_params,
      recovery_blob (auth hash of the Argon2id-stretched recovery phrase),
      recovery_salt, recovery_params,
      wrapped_dek, wrapped_dek_iv,
      wrapped_dek_recovery, wrapped_dek_recovery_iv
    }
12. Server stores everything; argon2id-hashes auth_hash again for storage
```

### Recovery (password reset via phrase)

```
1. POST /api/auth/recovery/derive-params { username }
   → { kdf_salt, recovery_salt, recovery_params, wrapped_dek_recovery, wrapped_dek_recovery_iv, ... }
2. BIP39-decode(phrase) → recoverySeed
3. Argon2id(recoverySeed, recovery_salt, recovery_params) → recoveryKEK
4. AES-GCM-decrypt(wrapped_dek_recovery, recoveryKEK, wrapped_dek_recovery_iv) → DEK
5. User sets new password → re-derive new KEK → re-wrap DEK under new KEK
6. POST /api/auth/recovery/reset { recovery_proof, new_auth_hash, new_wrapped_dek, ... }
7. Server verifies recovery_proof; atomically updates all key material
```

---

## Storage

### Web: SQLite via OPFS Web Worker

In the browser, storage is managed by `packages/core/src/storage/web-adapter.ts` (`WebSqliteAdapter`):

- A dedicated Web Worker is spawned at `/sqlite/privance-worker.mjs` (served as a static asset from `apps/web/public/`).
- The database filename is scoped per user (`/privance-<userId>.sqlite3`) so a sign-out and sign-in as a different user on the same browser cannot decrypt the previous user's rows with the new user's DEK. The legacy filename `/privance.sqlite3` remains as a fallback for the locked-rehydration state where the userId is briefly out of memory.
- The worker hosts `@sqlite.org/sqlite-wasm`. It first tries to install the **SAH Pool VFS** for OPFS-backed persistence (`createSyncAccessHandle`); if OPFS is unavailable (Safari Private Browsing, restricted WKWebView hosts, ephemeral profiles), it falls back to an in-memory `sqlite3.oo1.DB`. The startup message includes a validated `mode: "opfs" | "memory"` field, exposed after initialization as `LocalStore.mode`. The app visibly warns when storage is temporary.
- All feature writes (including snapshots and tombstones) atomically commit the encrypted object and outbound queue entry with `putAndEnqueue()`. OPFS saves remain local-first and work offline; failed background pushes leave durable intent queued for retry.
- In-memory storage lasts only for this worker session. Saves report success only after the server confirms that exact queue ID, including confirmations from overlapping background pushes or an early successful batch. Conflicts, network failure, accepting the server copy, and another revision's acknowledgement are not confirmation. Unconfirmed saves show an explicit warning/error; reloading can lose them. Confirmed ciphertext re-populates on reload via `drainAllChanges()`. No raw DEK is persisted.
- All SQLite operations are dispatched via a message-based RPC protocol from the main thread to the worker, because `createSyncAccessHandle` requires a dedicated worker context.
- In tests (Node.js), an injected synchronous `Database` object bypasses the Worker, enabling full unit test coverage without a browser.

### Web: simulation Web Worker

FIRE projections run in a second worker, `/sim/sim-worker.mjs`, using the storage worker's RPC contract (ready handshake, `{id, method, args}` request, `{id, ok, result|error}` response, pending map, per-request timeout).

- Built, not hand-written: `apps/web/scripts/build-sim-worker.mjs` bundles `sim-worker-entry.ts` plus the pure `packages/core/src/projection/` engine into `public/sim/sim-worker.mjs`, verifying the returns dataset against its recorded SHA-256 hash.
- Receives plaintext sim inputs over `postMessage`; never the DEK, ciphertext, or storage (see [the sim-worker threat analysis](THREAT_MODEL.md#310-plan-record-and-sim-worker)). `worker-client.ts` memoizes per session and falls back to the main-thread engine when the worker cannot boot or times out (restricted WKWebView, strict CSP); the fallback latches for the session.

### Schema and sync boundaries

[`packages/core/src/storage/schema.ts`](packages/core/src/storage/schema.ts) defines the local encrypted-object cache, sync cursor, and outbound-intent queue. [`LocalStore`](packages/core/src/storage/types.ts) defines the adapter contract. The server's [`sync/schema.ts`](server/src/sync/schema.ts) adds user scoping and server sequencing; it is not an identical copy of the local schema.

Keep the encrypted envelope compatible across the transport boundary, and preserve atomic object-plus-queue writes and queue-ID acknowledgements. For server write ordering, tombstone versions, and conflict reads, see [server sync semantics](server/README.md#sync-write-ordering-and-tombstones).

---

## Routing

### Route map

```
src/
├── main.tsx                       # Entry: providers (Query, Auth, Sync) + RouterProvider
├── router.tsx                     # Route tree (createBrowserRouter)
└── app/
    ├── (landing)/                 # Public landing page group
    │   ├── layout.tsx             # Dark-forced public layout (vault base)
    │   └── page.tsx               # Landing page (/), redirects signed-in users to /app/
    ├── (app)/                     # Auth-gated group
    │   ├── layout.tsx             # Redirects to /auth/login or /unlock if not unlocked
    │   └── app/
    │       ├── page.tsx           # Investments overview (/app)
    │       ├── accounts/page.tsx  # Account list (/app/accounts)
    │       ├── holdings/page.tsx  # Holdings (/app/holdings)
    │       ├── plan/page.tsx      # FIRE projections (/app/plan)
    │       ├── spend/page.tsx     # Spending (/app/spend)
    │       └── settings/page.tsx  # Settings (/app/settings)
    ├── auth/                      # Unauthenticated flows
    │   ├── layout.tsx             # Auth shell layout
    │   ├── login/page.tsx         # /auth/login
    │   ├── signup/page.tsx        # /auth/signup
    │   └── recovery/page.tsx      # /auth/recovery
    └── unlock/page.tsx            # /unlock (cookie present, DEK missing)
```

**Landing page:** `(landing)/page.tsx` serves the landing page at `/`. It reads `useAuth()` and redirects signed-in users (`unlocked` → `/app`, `locked` → `/unlock`) so they never see the landing.

**Auth gate:** `(app)/layout.tsx` uses `useAuth()` and soft-navigates via `navigate()` to `/auth/login` (unauthenticated) or `/unlock` (locked: session cookie present but the DEK is not in memory and cannot be rehydrated from the vault, because the window expired or a lock purged it). It does not redirect while auth state is `loading`, so the brief vault read on boot cannot bounce a soon-to-be-unlocked reload to `/unlock`.

---

## Build outputs

### Web (`apps/web`)

```sh
pnpm --filter @privance/web build
```

Produces a static site in `apps/web/out/`. Deploy to any static host (Caddy, nginx, S3, etc.). All routes serve the single `index.html` shell; the host's SPA fallback (Caddy `try_files {path} /index.html`) resolves them.

### Server (`server`)

```sh
pnpm --filter @privance/server build
```

Produces `server/dist/server.js`, a single Bun bundle. Run with `bun server/dist/server.js`.
