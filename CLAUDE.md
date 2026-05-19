# CLAUDE.md, Privance conventions

Operating manual for code work in this repo. Architecture lives in `ARCHITECTURE.md`, threat analysis in `THREAT_MODEL.md`, stack rationale under `docs/decisions/`. This file is just the rules that shape day-to-day decisions.

## Identity

**Privance**, self-hostable, zero-knowledge encryption personal finance app. Server stores ciphertext only; all crypto runs in the browser. Loss of master password + recovery phrase = permanent data loss by design.

## Stack

- Monorepo: pnpm workspaces + Turborepo
- Server: Bun 1.3 + Hono 4.12 + postgres.js + Drizzle + pino, PG 17
- Shared: TypeScript `packages/core`, crypto (@noble/* + hash-wasm + @scure/bip39), decimal math, domain types, sync client, storage adapter
- Client (`apps/web`): Next.js 16 (App Router, static export) + React 19 + Tailwind 4 + TanStack Query 5 + Zod 4 + Recharts. The same static export is wrapped by Capacitor 8 for iOS / Android (`apps/web/ios`, `apps/web/android`).
- Storage on the client: `@sqlite.org/sqlite-wasm` in a Web Worker via SAH Pool VFS (OPFS-backed). The Capacitor WebView uses the same adapter.
- Tests: Vitest + fast-check (core/web), `bun test` (server), Playwright (E2E on chromium + firefox)
- Lint/format: Biome 2.4 (replaces ESLint + Prettier)

Exact-pinned versions in the lockfile, never `^` or `~` (Shai-Hulud lesson).

## Commands

- Install: `pnpm install`
- Dev (server + web): `pnpm dev`  (server :3000, web :8081)
- Lint + format check: `pnpm lint` / `pnpm fmt:check`
- Typecheck all workspaces: `pnpm typecheck`
- Unit tests: `pnpm test`  (or per workspace: `pnpm --filter @privance/{core,server,web} test`)
- Web E2E: `pnpm --filter @privance/web e2e`
- Build (web static export): `pnpm --filter @privance/web build`
- DB migrate (local): `pnpm --filter @privance/server db:migrate`

## Module template

Mirror existing modules exactly. Don't invent new patterns; if tempted, justify it.

```
server/src/<feature>/
├── index.ts            # Barrel, never export service classes
├── types.ts            # <Module>Error + subclasses, result types, constants
├── schema.ts           # Drizzle tables
├── repo.ts             # ONLY layer that imports schema. Kw-arg options object.
├── wire.ts             # Routes + single error mapper per module
├── <flow>-service.ts   # One per cohesive flow. Constructor = options object.
└── _helpers.ts         # Optional

packages/core/src/<module>/
├── index.ts            # Barrel
├── types.ts            # Branded types, errors
├── <feature>.ts        # Pure functions
└── <feature>.test.ts

apps/web/src/features/<feature>/   # reference: apps/web/src/features/accounts/
├── index.ts
├── types.ts
├── queries.ts          # TanStack Query hooks
├── mutations.ts
└── components/
```

## Working principles

**Think before coding.** Don't assume; don't hide confusion.
- When a clear industry standard exists, use it.
- When no clear standard exists, surface tradeoffs and ask - don't pick silently.
- State your assumptions explicitly. If uncertain, ask.
- Present interpretations when the request is ambiguous.

**Simplicity first.** Minimum code that solves the problem.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- No comments restating what the code already says; explain why when it isn't obvious.
- If you write 200 lines and it could be 50, rewrite it.

**Surgical changes.** Touch only what the task demands.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Address every flagged finding (Critical / Important / Minor) with the minimum diff per fix.

**Goal-driven execution.** Define success criteria; loop until verified.
- Transform tasks into verifiable goals: "Fix the bug" becomes "test reproduces, then passes."
- For multi-step work, state the checks up front.

## Wiring rules

- Repo is the only layer touching Drizzle. Services never import `schema.ts`.
- Services take options objects (kw-arg style), never positional.
- Domain errors bubble; one error mapper per module at the wire boundary.
- Two log channels, audit via `repo.logEvent`, operational via pino, never merged.
- CSRF `X-Requested-With` header required on all state-changing routes.
- **Money math uses `Decimal` (BigInt minor-units) end-to-end.** Never coerce balances or amounts to `Number` or use floating-point arithmetic on them. Format-for-display at the UI boundary is the only place `.toString()` lives.
- Routes catch specific errors **only** to record rate-limit side-effects, then re-raise:
  ```ts
  try { const r = await service.method(input); rateLimit.recordSuccess(input.username); return r; }
  catch (e) { if (e instanceof SpecificError) rateLimit.recordFailure(input.username); throw e; }
  ```
  Repeated `try/catch` in routes for any other reason is a smell, it's the error mapper's job.

## Security contracts (never drift)

- HKDF labels are **frozen**: `finance/auth-v1`, `finance/kek-v1`, `finance/recovery-v1`. Bumping = migration, not a code change.
- Argon2id params are versioned in stored hashes. Param bumps follow expand/contract.
- AEAD AAD = `{recordUuid, kind, labelVersion, kdfParamVersion}`, prevents record-swap, cross-kind, and downgrade.
- DEK lives in JS memory only via `globalThis[Symbol.for("privance.dekStore.v1")]`. Cleared on tab close and on auto-lock; refresh = re-auth. This is the zero-knowledge tradeoff; don't try to "fix" it by persisting the DEK.
- Constant-time compare via `equalBytes` (`@noble/ciphers/utils`).
- HIBP check on signup, fail-closed on timeout: surface a clear error rather than silently allowing a potentially breached password.
- Username enumeration prevention via deterministic fake KDF params at matched latency.
- Never log secrets, passwords, DEKs, recovery phrases, or any decrypted user data.

## Server stores the minimum

Default = encrypt or omit. Adding a plaintext field requires a written *why does the server need this?* justification in the spec. Write-only metadata fields are a smell, if no code reads it, drop it.

## Schema migrations

Backward-incompatible changes follow **expand → backfill → contract** (three deploys). Single-deploy renames are forbidden.

## Tests

- Test through the public API only. No reaching into `_private` names.
- Property tests (`fast-check`) for crypto, decimal math, sync conflict logic.
- E2E selectors: `getByRole` > `getByLabel` > `getByTestId`. Never Tailwind classes.
- E2E auth flows go through `apps/web/tests/e2e/helpers/auth.ts` (`signup`, `login`, `logout`, `capturePhrase`, `acknowledgePhrase`). Never copy-paste auth helpers across specs.
- Distinct username per E2E test (alice, bob, dave, …) for cleanState isolation.
- A test that calls `.skip()` on the condition it's testing, or whose name claims behavior its body doesn't verify, is broken, delete or fix it.
- Coverage gates: `packages/core` ≥ 90%, `server` ≥ 85%, `apps/web` ≥ 80% (E2E covers screens).

## Commits

- Conventional Commits (`feat / fix / refactor / chore / test / docs / ci`).
- Identity = the GitHub noreply already configured in `git config user.email`. Never override per-commit; never reintroduce a real email.
- **Never** add a `Co-Authored-By` trailer. Verify with `git log -1 --format=%B` before push.
- Feature branches off `main`, squashed locally to one commit before push. Subject ≤72 chars, imperative mood; body leads with motivation (problem solved, debt closed, risk reduced), the diff shows what. PR title + body (per `.github/pull_request_template.md`) become the main-line commit verbatim on squash-merge. Merge only after CI green and maintainer local-test approval.
- Make a backup branch (`git branch backup-<context>`) before any destructive git op (reset --hard, rebase, force-push). Stop and ask if a request needs destructive action you weren't explicitly authorized for.
- **Never rewrite `main` history once anything has been pushed.** No force-push, no rebase, no reset onto remote main.
- **No personal info in tracked files**, no real names, personal emails, GitHub handles, absolute `/Users/…` paths, or specific cities/regions in committed docs. Treat anything tracked as public-facing even when the repo is private.

## Verification bar

"Verified clean" means **all** of these pass:

1. `pnpm biome check` + `tsc --noEmit` (every workspace)
2. `packages/core`: `vitest run --coverage` ≥ 90%
3. `server`: `bun test` ≥ 85% + `bun audit` clean
4. `apps/web`: `vitest run` + `next build` + `pnpm audit` clean
5. E2E: Playwright on chromium + firefox against real backend + real Postgres
6. Manual: signup → recovery → login cycle in a real browser for any auth-touching change

Skipping any of these → state it explicitly. Don't claim "verified" without backing.
