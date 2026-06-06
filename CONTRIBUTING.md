# Contributing

## Setup

### Prerequisites

- **Bun** ≥ 1.3.14
- **Node.js** ≥ 22.0.0
- **pnpm** ≥ 11.0.0
- **PostgreSQL** 17 (or Docker to run it)

### Install

```sh
git clone <repo-url> privance
cd privance
pnpm install        # installs all workspaces; also runs lefthook install via prepare
```

### Environment variables

```sh
# Server
cp server/.env.example server/.env
# Edit server/.env:
#   DATABASE_URL      , postgres connection string
#   ENUMERATION_SECRET, base64-encoded random secret >= 32 bytes
#     generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Web app
echo "NEXT_PUBLIC_SERVER_URL=http://localhost:3000" > apps/web/.env.development.local
```

### Database setup

```sh
# Start Postgres (Docker example)
docker run -d --name privance-pg \
  -e POSTGRES_USER=privance -e POSTGRES_PASSWORD=privance -e POSTGRES_DB=privance \
  -p 5432:5432 postgres:17-alpine

# Run migrations
pnpm --filter @privance/server db:migrate
```

---

## Development loop

```sh
pnpm dev        # starts server (port 3000) + web app (port 8081) in parallel via Turborepo
```

Open `http://localhost:8081` and run through the signup flow to verify the full stack is wired. A successful signup ends on the dashboard.

To run workspaces individually:

```sh
pnpm --filter @privance/server dev   # Bun hot-reload server
pnpm --filter @privance/web dev      # Next.js dev server (webpack mode)
```

---

## Tests

### Unit tests, `packages/core`

```sh
pnpm --filter @privance/core test
# with coverage (gate: >= 90%)
pnpm --filter @privance/core test -- --coverage
```

Tests use Vitest. Property tests use `fast-check` for crypto, decimal math, and sync conflict logic.

### Unit tests, `server`

```sh
pnpm --filter @privance/server test
```

Uses `bun test`. A real Postgres connection is required (`DATABASE_URL`).

### Unit + component tests, `apps/web`

```sh
pnpm --filter @privance/web test                    # both projects
pnpm --filter @privance/web exec vitest --project unit     # logic only (happy-dom)
pnpm --filter @privance/web exec vitest --project browser  # components (real Chromium)
```

Two Vitest projects: `unit` runs pure logic in `happy-dom`; `browser` runs `*.browser.test.{ts,tsx}` in real Chromium via Vitest Browser Mode (`vitest-browser-react`), needed because happy-dom/jsdom can't lay out or render Recharts/SVG, or faithfully back browser APIs like IndexedDB and WebCrypto. The browser project needs a Chromium binary (`pnpm --filter @privance/web exec playwright install chromium`). Component CSS and full flows are covered in E2E; see [ADR-0003](docs/adr/0003-component-testing.md).

### Run all tests

```sh
pnpm test        # Turborepo runs all three in dependency order
```

### E2E tests

```sh
# Install browsers (one-time)
pnpm --filter @privance/web e2e:install

# Run (requires server + DB running)
pnpm --filter @privance/web e2e

# Headed mode for debugging
pnpm --filter @privance/web e2e:headed
```

E2E specs live in `apps/web/tests/e2e/`. Auth flows go through the helpers in `apps/web/tests/e2e/helpers/auth.ts`, do not copy-paste auth steps into specs. Use a distinct username per test (alice, bob, dave, ...) for `cleanState` isolation. Prefer `getByRole` / `getByLabel` selectors; `getByTestId` only when role/label are not unique. Never use Tailwind class names as selectors.

Playwright runs five projects: `chromium`, `firefox`, and `webkit` run the full functional suite (webkit also runs the OPFS storage specs that only apply to it), and `mobile-safari` (iPhone, WebKit) and `mobile-chrome` (Pixel 5) run `*.mobile.spec.ts` against the mobile UI. Target one with `pnpm --filter @privance/web e2e --project=<name>`. All five run locally (macOS); on CI the shared Linux runner cannot carry WebKit's 64 MB Argon2id auth flows in time, so CI scopes the WebKit projects to their storage specs and runs the mobile suite on Pixel 5 (restoring full WebKit/iPhone CI coverage via a reduced test-env KDF is a tracked follow-up).

---

## Lint and format

```sh
pnpm lint           # biome check (lint + format check), all workspaces
pnpm lint:fix       # auto-fix lint issues
pnpm fmt            # biome format --write
pnpm fmt:check      # biome format check (no writes)
```

Biome is the single tool for linting and formatting. There is no ESLint or Prettier.

---

## Type checking

```sh
pnpm typecheck      # tsc --noEmit in all workspaces via Turborepo
```

Or per workspace:

```sh
pnpm --filter @privance/core typecheck
pnpm --filter @privance/server typecheck
pnpm --filter @privance/web typecheck
```

---

## Pre-commit hooks

Lefthook is installed automatically by `pnpm install` (via the `prepare` script).

- **pre-commit:** `biome check --write` on staged `.js/.ts/.tsx/.jsx/.json` files;
  auto-stages fixes.
- **pre-push:** `pnpm -r run typecheck` + `pnpm -r run test` + `pnpm audit --audit-level=high`.

Do not skip hooks without an explicit reason. If a hook fails, fix the underlying issue rather than bypassing it.

---

## Commit conventions

- Use **Conventional Commits**: `feat`, `fix`, `refactor`, `chore`, `test`, `docs`, `ci`.
  Scope is optional: `feat(auth): add recovery phrase UI`.
- **Never add a `Co-Authored-By` trailer.** Verify with `git log -1 --format=%B`
  before pushing.
- Commit identity must be the configured GitHub noreply email. Do not override with
  `--author` or introduce a personal email.
- Feature branches off `main`; squash-merge back when work is complete.
- Do not rewrite `main` history once anything has been pushed.
- No personal information in tracked files, no real names, personal emails, or
  absolute local paths in committed content.

---

## Adding a feature

1. Read an existing feature module as the template.
   - **Server:** `server/src/auth/` is the richest example.
   - **Web feature module:** `apps/web/src/features/accounts/` is the reference.
2. Mirror the file structure exactly. If a new pattern is genuinely needed, justify
   it in the PR description.
3. Server module template:
   ```
   server/src/<feature>/
   ├── index.ts            # Barrel; never export service classes
   ├── types.ts            # Errors, result types, constants
   ├── schema.ts           # Drizzle table definitions
   ├── repo.ts             # Only layer that imports schema
   ├── wire.ts             # Hono routes + single error mapper per module
   └── <flow>-service.ts   # One per cohesive flow
   ```
4. Web feature module template:
   ```
   apps/web/src/features/<feature>/
   ├── index.ts
   ├── types.ts
   ├── queries.ts          # TanStack Query hooks
   ├── mutations.ts
   └── components/
   ```
5. Money values must use `Decimal` (BigInt minor-unit arithmetic from
   `@privance/core/decimal`). Never coerce to `Number` or use floating-point arithmetic on amounts.
6. Tests must go through the public API only, do not reach into `_private` names.

---

## Pull request expectations

Before opening a PR:

1. `pnpm lint` passes with no new errors
2. `pnpm typecheck` passes in all workspaces
3. `pnpm test` passes with no regressions, and new or changed behavior ships with a test that fails without the change, at the right layer (unit / `browser` / E2E)
4. E2E tests pass on chromium, firefox, webkit, and mobile
5. If you changed the server API: document the change
6. If you changed auth or crypto: manually verify a signup → recovery → login
   cycle in a real browser
7. Rebase the branch to one commit with a clean Conventional Commits message;
   fill in `.github/pull_request_template.md` for the PR title and body. The
   maintainer local-tests the pushed branch after CI passes, then merges with
   `gh pr merge --squash --delete-branch` (no-op squash since the branch is
   already one commit).

For non-obvious design decisions, write an ADR under `docs/adr/`.
