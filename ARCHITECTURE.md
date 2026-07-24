# Architecture

## High-level diagram

```
User's device  (browser)
│
├─ apps/web  ── Vite 8 static export + TanStack Router
│   ├─ React 19 + Tailwind 4 + TanStack Query 5 + Zod
│   ├─ /          landing page  (auth-aware: redirects signed-in users to /app)
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
            only encrypted blobs + session cookie cross this line

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

### `apps/web/` , Vite 8 PWA

The public-facing web application. It is a **static export**, no SSR, no server-side API routes. All server communication goes to the Bun/Hono server.

**Key directories:**

```
apps/web/src/
├── routes/                 # TanStack Router file-based routes
│   ├── __root.tsx          # Root route: document shell, HeadContent, ErrorBoundary, SW registration
│   ├── _landing.tsx        # Pathless layout: grain overlay, gradient backdrop
│   │   └── index.tsx       # Landing page (/)
│   ├── auth/
│   │   └── _auth.tsx       # Pathless layout: AuthBackdrop, centered card, redirect on unlocked
│   │       ├── login.tsx   # /auth/login
│   │       ├── signup.tsx  # /auth/signup
│   │       └── recovery.tsx # /auth/recovery
│   ├── unlock.tsx          # /unlock (session exists, DEK not in memory)
│   └── app/
│       └── _app.tsx        # Pathless layout: TopBar, BottomNav, auth gate, veil toggle
│           ├── index.tsx   # /app (investments overview)
│           ├── accounts.tsx # /app/accounts
│           ├── holdings.tsx # /app/holdings
│           ├── plan.tsx    # /app/plan
│           ├── spend.tsx   # /app/spend
│           └── settings.tsx # /app/settings
├── features/               # Feature modules (same as before, unchanged)
├── lib/
│   ├── api/                # Raw fetch wrappers + mapApiError utility
│   ├── crypto/             # KDF worker client, WebAuthn PRF
│   ├── storage/            # session-vault, biometric-store, per-user-store
│   ├── sim/                # Sim worker client + wire types
│   ├── queries/            # TanStack Query hooks (prices, profiles)
│   ├── use-auth-redirect.ts # Shared auth redirect hook
│   └── navigate.ts         # hardRedirect for DEK-scrubbing navigation
├── providers/              # Unchanged (AuthProvider, SyncProvider, QueryProvider)
├── sw-src.ts               # Workbox-based SW source (built by scripts/build-sw.mjs)
├── main.tsx                # Vite entry: createRoot + RouterProvider with providers
├── globals.css             # Tailwind v4 styles
└── index.html              # Vite HTML entry point
```

**Dependencies on:** `packages/core`, `@sqlite.org/sqlite-wasm` (via Worker), `@tanstack/react-router`, `workbox-*`.

**Build pipeline:**
1. `scripts/build-sim-worker.mjs` (prebuild): bundles projection engine into `public/sim/sim-worker.mjs`
2. `vite build`: produces static files in `out/`, generates `routeTree.gen.ts` from `routes/`
3. `scripts/build-sw.mjs` (postbuild): runs Workbox `injectManifest` over `out/`, injects revisioned precache manifest into `out/sw.js`

### `server/` , Bun + Hono API

The backend. Stores only opaque ciphertext in Postgres. Has no ability to decrypt user data.

```
server/src/
├── index.ts            # Entry point: wires feature routers, starts maintenance tasks
├── core/
│   ├── app.ts          # createApp(): mounts CORS, secureHeaders, CSRF middleware
│   ├── db.ts           # Drizzle + postgres.js connection
│   ├── middleware.ts   # requireCsrfHeader
│   └── logger.ts       # pino logger
├── auth/               # Signup, login, recovery, password-change, sessions
│   ├── wire.ts         # Hono routes; single error mapper
│   ├── middleware.ts   # requireSession session gate (used by all protected routers)
│   ├── login-service.ts
│   ├── signup-service.ts
│   ├── recovery-service.ts
│   ├── password-service.ts
│   ├── session-service.ts
│   ├── invite-service.ts  # Invite-token mint + atomic single-use claim
│   ├── repo.ts         # Only layer that queries auth tables
│   ├── rate-limit.ts   # Sliding-window + progressive backoff (in-memory)
│   └── kdf.ts          # Server-side argon2id for auth-hash storage
├── sync/               # Encrypted blob CRUD + change feed
│   ├── wire.ts
│   ├── sync-service.ts
│   └── repo.ts
├── account/            # Password-gated vault destruction (cascade delete)
├── prices/             # Market-price refresh proxy + Postgres cache (Yahoo, CoinGecko)
└── symbol-profiles/    # Symbol metadata + sector weightings (Yahoo upstream, cached)
```

**Dependencies on:** `packages/core` (domain types, audit event constants only , no crypto).

### `packages/core/` , Shared TypeScript library

Pure TypeScript. No DOM, no Bun, no Node built-ins. Can run in the browser, in a Web Worker, or in a Node/Bun test harness.

**Exports:**

| Export path | Contents |
|---|---|
| `@privance/core` | Re-exports from all submodules |
| `@privance/core/crypto` | Key derivation, AES-GCM encrypt/decrypt, HKDF, BIP39 recovery |
| `@privance/core/storage` | `LocalStore` interface, `WebSqliteAdapter`, schema DDL |
| `@privance/core/sync` | `SyncClient`, push, pull, reconcile, conflict handling |
| `@privance/core/domain` | Domain types: `Account`, `Holding`, `Price`, branded IDs |
| `@privance/core/decimal` | `Decimal` BigInt minor-unit arithmetic |
| `@privance/core/networth` | Net-worth aggregation functions |
| `@privance/core/projection` | FIRE simulation engine (Monte Carlo + historical replay) |
| `@privance/core/audit-events` | Audit event name constants |

---

## Data flow

### Create account (mutation)

```
UI (AccountsScreen)
  → useAccountMutations().createAccount(payload)
    → encrypt payload JSON with DEK (AES-GCM, AAD = {recordUuid, kind, labelVersion=1, kdfParamVersion=1})
    → store.put(kind="account", objectId, ciphertext, nonce, version=1n)
    → store.enqueue(outbound item)
    → client.pushPending()                          ← or next background sync tick

SyncClient.pushPending()
  → store.drainQueue()
  → POST /api/sync/batch { puts: [{object_id, kind, ciphertext, nonce, version}] }
  → server writes row to sync_objects (ciphertext only)
  → server returns {results: [{id, ok, server_seq, version}]}
  → store.put(..., serverSeq = result.server_seq)
  → store.ackQueueItem(id)
```

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
User enters password
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

**Session persistence and auto-lock** (`lib/storage/session-vault.ts`): the DEK is also held wrapped in IndexedDB under a non-extractable key, bounded by a single 15-minute window covering both idle-while-open and time-since-last-seen. On boot, AuthProvider holds in a transient `loading` state while it reads the vault: a same-tab reload within the window unwraps locally and resumes `unlocked` with no password or server round-trip; an expired or absent vault resolves to `locked` and routes to `/unlock`. The window slides forward on activity (throttled) and on tab-hide. Explicit lock, window expiry, and logout purge the vault. The non-secret username and userId live in `localStorage` so a reopen after a real close can still reach `/unlock` prefilled; in private browsing the browser wipes all of this on close, so closing locks instantly. See `THREAT_MODEL.md` for the posture tradeoff.

**Biometric unlock** (`lib/storage/biometric-store.ts`, `lib/crypto/webauthn-prf.ts`, `packages/core/src/crypto/biometric.ts`): an opt-in second unlock path layered on the locked state. Enrollment (Settings, while unlocked) creates a platform passkey with the WebAuthn PRF extension and a local RSA-OAEP protector keypair; the items key is wrapped under the protector public key and the protector private key is AEAD-sealed under a KEK derived from the passkey's PRF output (`finance/biometric-v1` HKDF label). The record lives in its own IndexedDB database (`privance.biometric`), is scoped to the enrolling userId, and is governed by a 14-day cadence: past it the wrapped items key is destroyed in place and the next password-derived unlock re-wraps it without re-enrollment. On `/unlock`, an enrolled device leads with the biometric action (PRF assertion unseals the protector key, which unwraps the items key) and keeps the password form one tap behind a reveal. Logout, cross-user mismatch, and tamper purge the whole record; explicit lock retains it. See `docs/adr/0005-biometric-unlock.md` and `THREAT_MODEL.md` section 3.2.

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

### Login

```
1. GET /api/auth/kdf-params?username  → { kdf_salt, kdf_params }
   (fake params returned for unknown usernames at matched timing)
2. Argon2id(password, kdf_salt) → stretchedMasterKey
3. HKDF(stretchedMasterKey, "finance/auth-v1") → authHash
4. POST /api/auth/login { username, auth_hash }
   → server verifies; returns { wrapped_dek, wrapped_dek_iv }
5. HKDF(stretchedMasterKey, "finance/kek-v1") → KEK
6. AES-GCM-decrypt(wrapped_dek, KEK, wrapped_dek_iv) → DEK
7. DEK stored in globalThis Symbol slot
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
- The worker hosts `@sqlite.org/sqlite-wasm`. It first tries to install the **SAH Pool VFS** for OPFS-backed persistence (`createSyncAccessHandle`); if OPFS is unavailable (Safari Private Browsing, restricted WKWebView hosts, ephemeral profiles), it falls back to an in-memory `sqlite3.oo1.DB`. The startup message includes a `mode: "opfs" | "memory"` field for consumers that want to surface ephemeral-session UX.
- In the in-memory branch the local store re-populates from the server's ciphertext on every session via `drainAllChanges()`. Per-tab persistence only; no data is lost because the server is the authoritative store.
- All SQLite operations are dispatched via a message-based RPC protocol from the main thread to the worker, because `createSyncAccessHandle` requires a dedicated worker context.
- In tests (Node.js), an injected synchronous `Database` object bypasses the Worker, enabling full unit test coverage without a browser.

### Web: simulation Web Worker

FIRE projections run in a second worker, `/sim/sim-worker.mjs`, using the storage worker's RPC contract (ready handshake, `{id, method, args}` request, `{id, ok, result|error}` response, pending map, per-request timeout).

- Built, not hand-written: `apps/web/scripts/build-sim-worker.mjs` bundles `sim-worker-entry.ts` plus the pure `packages/core/src/projection/` engine into `public/sim/sim-worker.mjs`, verifying the returns dataset against its recorded SHA-256 hash.
- Receives plaintext sim inputs over `postMessage`; never the DEK, ciphertext, or storage (see THREAT_MODEL.md 3.10). `worker-client.ts` memoizes per session and falls back to the main-thread engine when the worker cannot boot or times out (restricted WKWebView, strict CSP); the fallback latches for the session.

### Schema

Defined in `packages/core/src/storage/schema.ts`:

```sql
sync_objects (
  kind        TEXT,       -- "account", "holding", etc.
  object_id   TEXT,       -- UUID
  ciphertext  BLOB,       -- AES-GCM encrypted payload
  nonce       BLOB,       -- 12-byte GCM nonce
  version     INTEGER,    -- optimistic concurrency version
  server_seq  INTEGER,    -- NULL until server confirms
  tombstone   INTEGER,    -- 0 or 1
  updated_at  INTEGER     -- Unix epoch ms
  PRIMARY KEY (kind, object_id)
)

sync_cursor (
  key   TEXT PRIMARY KEY,  -- always "server_seq"
  value TEXT               -- last confirmed server sequence number
)

outbound_queue (
  id           TEXT PRIMARY KEY,
  kind, object_id, ciphertext, nonce, version, prev_version, tombstone,
  enqueued_at  INTEGER
)
```

The schema is identical in structure to the server's `sync_objects` table, enabling round-trip transport without transformation.

---

## Routing

### TanStack Router file-based route tree

Pathless layout routes use the `_` prefix and wrap child routes via `<Outlet />`.

```
routes/
├── __root.tsx          # Root: document shell, HeadContent, ErrorBoundary, SW registration
├── _landing.tsx        # Pathless layout: dark grain shell
│   └── index.tsx       # Landing page (/)
├── auth/
│   └── _auth.tsx       # Pathless layout: AuthBackdrop, centered card, auth gate
│       ├── login.tsx   # /auth/login
│       ├── signup.tsx  # /auth/signup
│       └── recovery.tsx # /auth/recovery
├── unlock.tsx          # /unlock (cookie present, DEK missing)
└── app/
    └── _app.tsx        # Pathless layout: TopBar, BottomNav, auth gate, veil toggle
        ├── index.tsx   # /app (investments overview)
        ├── accounts.tsx # /app/accounts
        ├── holdings.tsx # /app/holdings
        ├── plan.tsx    # /app/plan
        ├── spend.tsx   # /app/spend
        └── settings.tsx # /app/settings
```

**Landing page:** `_landing/index.tsx` serves the landing page at `/`. It uses `useAuthRedirect({ onUnlocked: true, onLocked: true })` for hard navigation, a DEK-scrubbing full page reload for formerly-authenticated users.

**Auth gate:** `app/_app.tsx` uses `useAuthRedirect({ onUnauthenticated: true, onLocked: true }, navigate)` for soft navigation via the router to `/auth/login` (unauthenticated) or `/unlock` (locked). The lock/logout actions do their own hard reload in `auth-context` for DEK scrub.

---

## Build outputs

### Web (`apps/web`)

```sh
pnpm --filter @privance/web build
```

Runs three steps: (1) `scripts/build-sim-worker.mjs` bundles the projection engine into `public/sim/sim-worker.mjs`, (2) `vite build` produces a static site in `apps/web/out/` with TanStack Router `autoCodeSplitting` splitting each route into its own chunk, (3) `scripts/build-sw.mjs` runs Workbox `injectManifest` over the output, injecting a revisioned precache manifest into `out/sw.js`. Deploy to any static host (Caddy, nginx, S3, etc.).

### Server (`server`)

```sh
pnpm --filter @privance/server build
```

Produces `server/dist/server.js` , a single Bun bundle. Run with `bun server/dist/server.js`.
