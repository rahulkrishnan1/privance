# @privance/web

Next.js 16 static-export PWA for Privance.

All crypto runs in the browser. This workspace has no server-side rendering; the
`output: "export"` Next.js config produces a static `/out` directory.

CI is defined in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) and runs
lint, typecheck, unit tests (core / web / server), E2E (Playwright chromium + firefox + webkit + mobile),
static build, and a dependency audit on every push to `main` and on pull requests.

## Key files

| Path | Purpose |
|---|---|
| `src/app/layout.tsx` | Root layout: QueryProvider > AuthProvider > SyncProvider |
| `src/app/(landing)/page.tsx` | Landing at `/` (auth-aware redirect for signed-in users) |
| `src/app/(app)/layout.tsx` | Auth-gated shell with sidebar + mobile tab bar (mounts under `/app/*`) |
| `src/providers/auth-context.tsx` | DEK store, auth state machine, auto-lock idle timer |
| `src/providers/sync-context.tsx` | LocalStore + SyncClient lifecycle |
| `src/features/accounts/` | Reference feature module (queries, mutations, components) |
| `src/lib/api/client.ts` | CSRF-aware fetch wrapper |
| `tests/e2e/helpers/auth.ts` | Shared auth helpers for E2E specs |

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for full data-flow and routing docs.

## PWA install

Privance ships as a Progressive Web App. The offline shell (app chrome, SQLite
WASM, icons) is pre-cached on first load; data sync requires network.

| Platform | How to install |
|---|---|
| **iOS (Safari)** | Tap Share → "Add to Home Screen" |
| **Android (Chrome)** | Tap the install icon in the address bar, or Menu → "Add to Home Screen" |
| **Desktop (Chrome / Edge)** | Click the install icon in the address bar, or Menu → "Install Privance" |

**Offline behavior:** The app shell loads offline after first visit. Account data is stored locally via SQLite-WASM, OPFS-backed where the browser allows it and in-memory when it does not (Safari Private Browsing, restricted WKWebView hosts). In the in-memory mode the local store re-populates from the server on every session; the server holds ciphertext only. A full offline experience (no network ever) is not supported because authentication and initial sync require connectivity.

**Service worker:** `/public/sw.js` is a hand-written service worker (no Workbox or next-pwa). It is registered only in production builds.

## Development

```sh
pnpm dev          # starts on http://localhost:8081
pnpm build        # static export to /out
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest unit tests
```

## Running E2E tests

### Prerequisites

1. **PostgreSQL** running on `localhost:5432` with:
   - database: `privance`
   - user: `privance`
   - password: `privance`

2. **Migrations applied** (only needed once, or after schema changes):

   ```sh
   cd server && bun run db:migrate
   ```

3. **Install Playwright browsers** (only needed once):

   ```sh
   pnpm -F @privance/web e2e:install
   ```

4. The `ENUMERATION_SECRET` env var is read from `server/.env` by the
   Playwright config automatically. No manual export needed for local runs.

5. **Signup allowlist** must be disabled (empty `SIGNUP_ALLOWLIST`). The
   default `server/.env` already has `SIGNUP_ALLOWLIST=` (empty).
   `INVITE_REQUIRED` is left unset so E2E signup flows do not require minted invite tokens.

### Running

```sh
# Run all five projects: chromium, firefox, webkit, mobile-safari, mobile-chrome (boots servers automatically)
pnpm -F @privance/web e2e

# Chromium only (faster)
pnpm -F @privance/web e2e --project=chromium

# Firefox only
pnpm -F @privance/web e2e --project=firefox

# Headed mode (watch the browser)
pnpm -F @privance/web e2e:headed

# Interactive UI (trace viewer + step-through)
pnpm -F @privance/web e2e:ui
```

### Debugging failures

- Playwright automatically saves traces, videos, and screenshots on failure
  to `test-results/`. Open with `playwright show-report playwright-report/`.
- Run with `--headed` to watch the browser in real time.
- Use `--project=chromium` to cut iteration time.

### Design notes

- Each test uses a distinct username (prefixed with the spec name +
  `Date.now().toString(36)`). No cross-test DB state; no DB reset needed.
- E2E builds run with reduced-KDF v2 params (`NEXT_PUBLIC_PRIVANCE_KDF_REDUCED`),
  so auth flows complete in well under a second; the per-test timeout is 60 s.
- The Playwright config boots the bun server (:3000) and the production static
  export (:8081 — built first, then served by sirv, matching the Docker image)
  automatically. Both are reused across tests if already running
  (`reuseExistingServer: true` for local runs).
- Coverage is tiered by engine. Chromium runs the full critical-user-journey
  suite (auth incl. recovery, accounts, holdings + regressions, dashboard,
  session, landing, plan, spend, settings, biometric PRF); firefox runs auth +
  session smoke; webkit runs the OPFS storage specs (`webkit-storage` and
  `fallback-storage`) plus auth smoke and `biometric-unlock`. The two mobile
  projects, `mobile-safari` (iPhone, WebKit) and `mobile-chrome` (Pixel 5), run
  the `*.mobile.spec.ts` suite against the mobile UI.
- All five projects run locally and in CI. The reduced-KDF v2 params
  (`NEXT_PUBLIC_PRIVANCE_KDF_REDUCED=true`) keep WebKit's Argon2id auth flows
  within the CI time budget, so CI carries the same coverage as local runs.
