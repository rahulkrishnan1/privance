# @privance/web

Next.js 16 static-export PWA for Privance. The same build artifact is wrapped by
Capacitor for native iOS and Android distribution.

All crypto runs in the browser. This workspace has no server-side rendering; the
`output: "export"` Next.js config produces a static `/out` directory.

CI is defined in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) and runs
lint, typecheck, unit tests (core / web / server), E2E (Playwright chromium + firefox + webkit storage specs),
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

**Service worker:** `/public/sw.js` is a hand-written service worker (no Workbox or next-pwa). It is registered only in production builds and skipped inside Capacitor WebViews (which manage their own asset caching).

## Development

```sh
pnpm dev          # starts on http://localhost:8081
pnpm build        # static export to /out
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest unit tests
```

## Running on iOS

### Prerequisites

- **Xcode** (latest stable) from the Mac App Store
- **An Apple Developer signing identity**, a free Apple ID is sufficient for
  Simulator builds; a paid membership is required for on-device distribution
- Capacitor 8 uses Swift Package Manager, so CocoaPods is not required

### Environment

The iOS Capacitor WebView serves the app from the `capacitor://localhost` origin.
The Privance API server must list that origin in `ALLOWED_ORIGINS` (see
`server/.env.example`). Set the API URL before building:

```sh
# Simulator pointing at local bun server (port 3000)
NEXT_PUBLIC_SERVER_URL=http://localhost:3000 pnpm -F @privance/web build

# Production build
NEXT_PUBLIC_SERVER_URL=https://privance.app pnpm -F @privance/web build
```

### First-time setup (Xcode project already scaffolded)

```sh
pnpm -F @privance/web build
pnpm -F @privance/web exec cap sync ios
```

### Re-syncing after web changes

```sh
pnpm -F @privance/web cap:ios   # build + sync + open Xcode in one step
```

Or individually:

```sh
pnpm -F @privance/web build
pnpm -F @privance/web exec cap sync ios
pnpm -F @privance/web exec cap open ios
```

### Build and run in Xcode

Open the project:

```sh
open apps/web/ios/App/App.xcodeproj
```

Select a simulator target from the scheme menu and press `Cmd+R`.

## Running on Android

### Prerequisites

- **Android Studio** (latest stable) with JDK 17 configured
- An Android emulator or physical device

### Environment

The Android Capacitor WebView uses the `https://localhost` origin. Add it to
`ALLOWED_ORIGINS` alongside the iOS origin:

```
ALLOWED_ORIGINS=http://localhost:8081,capacitor://localhost,https://localhost
```

### Re-syncing after web changes

```sh
pnpm -F @privance/web cap:android   # build + sync + open Android Studio
```

Or individually:

```sh
pnpm -F @privance/web build
pnpm -F @privance/web exec cap sync android
pnpm -F @privance/web exec cap open android
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
# Run all specs on chromium + firefox (boots servers automatically)
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
- Argon2 KDF derivation takes 3-8 s; the per-test timeout is 60 s.
- The Playwright config boots the bun server (:3000) and Next.js dev server
  (:8081) automatically. Both are reused across tests if already running
  (`reuseExistingServer: true` for local runs).
- WebKit runs the storage specs only (`webkit-storage`, `fallback-storage`)
  to cover the OPFS fallback path on Safari. The remaining specs run on
  chromium and firefox; argon2-wasm timing on macOS WebKit is too flaky for
  full-suite coverage, and core crypto is exercised by vitest unit tests in
  `packages/core`.
