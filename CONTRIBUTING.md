# Contributing

Start with [AGENTS.md](AGENTS.md) for repository guardrails and task-specific reading. This guide owns setup, test conventions, verification, and the contribution workflow. Run commands from the repository root unless a different directory is stated.

## Setup

### Prerequisites

Use the pnpm version in the root [`package.json`](package.json), Node.js satisfying its `engines`, Bun satisfying [`server/package.json`](server/package.json), and PostgreSQL 17. Docker can provide a local Postgres. CI tool versions are in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

```sh
git clone <repo-url> privance
cd privance
pnpm install
cp server/.env.example server/.env
```

In `server/.env`, set `DATABASE_URL` and a unique `ENUMERATION_SECRET` (generate with `openssl rand -base64 48`). The [environment template](server/.env.example) describes the settings; [server/README.md](server/README.md#environment-variables) covers additional options. Web development needs no env file: Vite proxies `/api` to the API on port 3000.

For a **disposable local development database**, using the template's credentials:

```sh
docker run -d --name privance-pg \
  -e POSTGRES_USER=privance -e POSTGRES_PASSWORD=privance -e POSTGRES_DB=privance \
  -p 127.0.0.1:5432:5432 postgres:17-alpine
```

Wait for `docker exec privance-pg pg_isready -U privance -d privance` to succeed, then:

```sh
pnpm --filter @privance/server db:migrate
pnpm dev
```

Open `http://localhost:8081`. Setup is complete when signup, recovery-phrase verification, and arrival at the Investments overview succeed. The API runs on port 3000. To start one workspace, use `pnpm --filter @privance/server dev` or `pnpm --filter @privance/web dev`.

## Implementing changes

Read the affected workspace's conventions before adding a module:

- [Server](server/README.md#module-conventions): routes, services, repositories, and migrations; reference `server/src/auth/`.
- [Core](packages/core/README.md#module-conventions): runtime-independent shared logic.
- [Web](apps/web/README.md#feature-conventions): feature modules; reference `apps/web/src/features/accounts/`.

Reuse the existing structure and create only files the feature needs. Justify a new pattern in the PR. Document API changes and write an ADR from [the template](docs/adr/0000-template.md) for non-obvious design decisions.

## Tests

### Choose the layer

| Behavior under test | Layer | Command |
|---|---|---|
| Shared logic, crypto, decimal math, sync | Core Vitest (Node), with `fast-check` for invariants | `pnpm --filter @privance/core test` |
| API services, repositories, routes | Server Bun tests, including real Postgres integration | `pnpm --filter @privance/server test` |
| Web logic without rendering | Vitest `unit` project (happy-dom) | `pnpm --filter @privance/web exec vitest run --project unit` |
| Component rendering, interaction, browser APIs | Vitest `browser` project (real Chromium), `*.browser.test.{ts,tsx}` | `pnpm --filter @privance/web exec vitest run --project browser` |
| Full flows, cross-engine behavior, device viewports | Playwright E2E | `pnpm --filter @privance/web e2e` |

`pnpm test` runs all workspace test scripts; `pnpm --filter @privance/web test` runs both web projects. Core coverage runs automatically. Use the server's test script rather than bare `bun test`: it isolates test files and supplies test defaults. The outer Bun process can load `server/.env` before the wrapper starts; the child's `--no-env-file` does not clear inherited values. Always explicitly set `DATABASE_URL` to a disposable, migrated test database before running server tests, including through `pnpm test` or pre-push hooks. Do not assume the default connection or env-file handling isolates development data.

The web `browser` project needs Chromium: `pnpm --filter @privance/web exec playwright install chromium`. happy-dom/jsdom do not lay out Recharts/SVG; rendering assertions belong in a real browser. See [ADR-0003](docs/adr/0003-component-testing.md) for the runner decision and module-mocking constraints.

### Test conventions

- Test through public APIs rather than `_private` implementation details.
- Assert user-observable behavior: rendered values, chart ranges, focus changes, saved data, or error recovery. Class strings, bare element existence, and visibility alone do not establish correct behavior.
- Make each regression test fail when the behavior regresses. Fix or remove tests whose names claim unasserted behavior, or which skip on the condition they should test.
- Use `fast-check` for crypto round-trips, decimal invariants, and sync conflict logic.
- E2E selectors: `getByRole` first, then `getByLabel`, then `getByTestId` when needed. Use semantic selectors, not Tailwind classes.
- E2E auth uses [`apps/web/tests/e2e/helpers/auth.ts`](apps/web/tests/e2e/helpers/auth.ts): `signup`, `login`, `logout`, `capturePhrase`, and `acknowledgePhrase`. Keep those flows out of individual specs.
- Follow the existing fixture and `beforeEach` cleanup pattern for the spec. Tests creating users need distinct usernames; shared fixtures require isolated sync state.

### E2E setup and execution

**Use a disposable test database, never a personal or production vault.** On local fixture reuse, [global setup](apps/web/playwright/global-setup.ts) deletes the fixture users' sync rows and clears the entire price and symbol-profile caches. Its local-host guard is not a substitute for choosing a test database.

1. Start Postgres and apply migrations as in [Setup](#setup). If exporting a different `DATABASE_URL`, use it for both migrations and E2E.
2. Install browsers once: `pnpm --filter @privance/web e2e:install` (Linux hosts may also need Playwright's `install --with-deps`).
3. Stop development servers on the selected E2E ports, then run:

   ```sh
   pnpm --filter @privance/web e2e
   # Focused iteration:
   pnpm --filter @privance/web e2e --project=chromium
   pnpm --filter @privance/web e2e:headed
   pnpm --filter @privance/web e2e:ui
   ```

Playwright boots the Bun API and builds/serves the production SPA automatically. It sets a test-only enumeration secret, lifts auth rate limits, uses fake market-price upstreams, and enables reduced-KDF v2 for the web build. Keep invite gating disabled (`INVITE_REQUIRED` unset/empty or `false`) for test signups.

Local runs reuse existing servers. A reused dev server can silently defeat the reduced-KDF build and fake-provider settings; let Playwright boot its own servers. For concurrent checkouts, select unused ports:

```sh
E2E_WEB_PORT=8181 E2E_SERVER_PORT=3100 pnpm --filter @privance/web e2e
```

Ports do not isolate database state or shared price caches; use a separate test database for concurrent runs. Fixture users are cached in the gitignored `apps/web/.playwright-fixtures.json`; after a database wipe, use `FORCE_SETUP=1` to recreate them.

All five projects run locally and in CI: `chromium`, `firefox`, `webkit`, `mobile-safari`, and `mobile-chrome`. Coverage is tiered, not the full suite on every engine; [`playwright.config.ts`](apps/web/playwright.config.ts) owns the exact spec selection. Global setup uses Chromium even when targeting another project.

Failure screenshots go to `apps/web/test-results/`; traces and videos are captured on the first retry. Local runs have no retries by default; use `--retries=1` when those artifacts are needed. Use `e2e:ui` for interactive debugging.

## Verification

The implementer, including a coding agent, owns testing and verification end-to-end; maintainer hands-on testing is not a prerequisite. For focused iteration, run the affected workspace/test project first. Before a PR, run the full bar below or explicitly list each omitted check and why. A green focused test or CI run alone is not “verified clean.”

| Check | Command / completion criterion |
|---|---|
| Lint and formatting | `pnpm lint` (Biome check); `pnpm fmt:check` for formatting alone |
| Types | `pnpm typecheck` (all workspaces) |
| Core tests and coverage | `pnpm --filter @privance/core test`; at least 90% lines, branches, functions, statements |
| Server tests and coverage | `pnpm --filter @privance/server test` against real Postgres; project floor 85% overall |
| Web logic and components | `pnpm --filter @privance/web test`; project coverage floor 80%, with E2E covering screens |
| Static build | `pnpm --filter @privance/web build` |
| Dependency audits | `pnpm audit` and, from `server/`, `bun audit`; both clean, with any findings reported |
| E2E | `pnpm --filter @privance/web e2e`; all five projects, real API and Postgres |
| UI/mobile interaction | [Browser and iOS Simulator checks](#browser-and-ios-simulator-checks) for the affected flows |
| Auth/crypto browser flow | Exercise signup → recovery → login in a real browser using a disposable test account |

Coverage policy and enforcement differ: [core config](packages/core/vitest.config.ts) enforces 90%; [Bun config](server/bunfig.toml) enforces a 65% per-file threshold with exclusions, not the 85% overall policy; [web config](apps/web/vitest.config.ts) has no automated coverage gate. Do not infer those policy floors passed from a green test exit. CI's dependency audit is advisory (`continue-on-error`); the pre-push audit is blocking.

For deployment changes, also run `bash infra/test.sh`; with the local Compose trial running, run `node infra/test-browser.mjs` (Chromium and WebKit through Caddy). Follow [infra/README.md](infra/README.md) for deployment and restore checks.

For targeted auto-fixes, use `pnpm exec biome check --write <paths>` or `pnpm exec biome format --write <paths>`. The root `pnpm lint:fix` and `pnpm fmt` scripts write across the repository; inspect their diffs for unrelated changes.

### Browser and iOS Simulator checks

For web UI and PWA changes, the implementing agent independently:

1. Runs the relevant automated tests and exercises the affected flows in real browsers. Browser viewport emulation alone does not establish installed-PWA behavior.
2. Uses Orca with an existing iOS Simulator device/runtime to test Safari and the installed Home Screen PWA separately; confirms standalone mode for the latter. Uses touch to open the software keyboard when testing fields, rather than relying only on desktop typing or mocked viewport events.
3. Checks affected safe areas, scrolling, focus, dismissal, gestures, and form actions, including shared callers and relevant viewport/theme variants. For native-style changes, uses platform guidance and a native app on the same Simulator as references. For spacing changes, compares rendered before/after geometry, not just CSS values or overall component height.
4. Records the browser/device modes, exercised flows, results, and any blocked checks in the completion report or PR. Resolves environment problems where possible and reports remaining blockers rather than claiming untested behavior is verified or handing routine testing to the maintainer.

These Simulator checks satisfy mobile-device verification; a physical phone is not a required gate. They supplement, rather than replace, the automated checks above. Read-only synthetic fixtures are suitable for visual checks, but do not replace real API/database verification for authentication, persistence, or sync changes. Keep all test data disposable as required by [E2E setup](#e2e-setup-and-execution).

## Hooks

[`lefthook.yml`](lefthook.yml) defines the hooks: pre-commit fixes and stages supported code/JSON files; pre-push runs workspace typechecks, tests, and a high-severity dependency audit. Fix hook failures instead of bypassing them; disclose any explicit reason for a bypass.

`pnpm install` installs hooks in a normal clone. In a linked worktree, `.git` is a file and the current `prepare` script skips installation; use `pnpm exec lefthook install` if hooks are not already installed in the shared repository.

## Commits and pull requests

- Branch from `main`; keep the branch focused and squash locally to one commit before push. History rewrites require authorization and a backup branch as specified in [AGENTS.md](AGENTS.md#guardrails).
- Use Conventional Commits: `feat`, `fix`, `refactor`, `chore`, `test`, `docs`, or `ci`; scope is optional. Keep the subject imperative and at most 72 characters. Lead the body with motivation, not a diff summary.
- Use the configured GitHub noreply identity (`git config user.email`); do not override it per commit. Omit `Co-Authored-By` trailers. Check `git log -1 --format=%B` before push.
- Fill in the [PR template](.github/pull_request_template.md), including verification results, skips, and API/design documentation updates. The PR title and body become the main-line squash commit verbatim.
- Merge only after CI is green and explicit merge authorization has been given, as required by [AGENTS.md](AGENTS.md#guardrails).

## License

Contributions use [AGPL-3.0](LICENSE), the same license as the project (inbound = outbound). You retain copyright to your contributions.
