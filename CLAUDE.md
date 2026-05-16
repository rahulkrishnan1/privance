# CLAUDE.md — Privance conventions

Read this before making any changes. These are non-negotiable; deviations need explicit user approval. The canonical design contract is `SPEC.md`; this file is the operating manual.

## Identity

**Privance** — self-hostable, zero-knowledge personal finance app. Server stores ciphertext only; all crypto runs in the browser. Loss of master password + recovery phrase = permanent data loss by design.

## Stack

- **Monorepo**: pnpm workspaces (`nodeLinker: hoisted`) + Turborepo
- **Server**: Bun 1.3.x + Hono 4.12.x + postgres.js + Drizzle ORM + oRPC + pino, PostgreSQL 17
- **Shared**: `packages/core` — TypeScript-only crypto (@noble/* + hash-wasm + @scure/bip39), decimal math, domain types, sync client
- **Web/PWA/native**: Expo SDK 55 (Expo Router 55, RN 0.85, RN-Web 0.21, react 19.2) + NativeWind 4.2 + Tailwind 3.4 + Recharts (web)
- **Tests**: Vitest + fast-check (packages/core, web), `bun test` (server), Playwright (E2E)
- **Lint/format**: Biome 2.4 — replaces ESLint + Prettier
- **CI**: GitHub Actions with concurrency groups + timeouts + `pnpm audit` + `bun audit`
- **Pre-commit**: lefthook runs Biome + tsc on staged files

`pnpm typecheck` is the equivalent of `mypy --strict` in the old stack. Zero `// @ts-ignore` / `@ts-expect-error` without a tracked-issue comment.

## Module template (every feature module follows this)

### Server (`server/src/<feature>/`)

```
server/src/<feature>/
├── index.ts              # Barrel — re-exports types, errors, schemas
│                         # NEVER export service classes; DI via core/deps is canonical
├── types.ts              # Errors (subclass <Module>Error), result types, constants
├── schema.ts             # Drizzle ORM table definitions
├── repo.ts               # ONLY layer that imports schema.ts. Kw-args via options object.
├── wire.ts               # oRPC procedures (replaces wire types + routes)
├── <flow>-service.ts × N # One per cohesive flow; ≤ ~130 LOC each
│                         # Constructor takes options object with explicit deps
└── _helpers.ts           # Module-level functions taking explicit deps (optional)
```

### packages/core (`packages/core/src/<module>/`)

```
packages/core/src/<module>/
├── index.ts              # Barrel
├── types.ts              # Branded types, errors, constants
├── <feature>.ts          # Pure functions, no side effects
└── <feature>.test.ts     # Co-located with implementation
```

### Web (`apps/web/features/<feature>/`)

```
apps/web/features/<feature>/
├── index.ts              # Barrel
├── types.ts              # Feature-local types; most come from @privance/core
├── queries.ts            # TanStack Query hooks
├── mutations.ts          # TanStack Query mutation hooks
├── components/           # UI components for this feature
└── screens/              # Route-level screens (mounted by expo-router)
```

## Wiring rules

- **Service classes are NOT exported from `<feature>/index.ts`** — external callers obtain services through `core/deps.ts` `*ServiceDep` aliases or oRPC procedure context. DI is the canonical path.
- **Domain errors bubble**; a single error mapper per module converts errors to HTTP status codes at the oRPC boundary.
- **Routes only catch specific errors for rate-limit-accounting side effects**, then re-raise:
  ```ts
  try {
    const result = await service.method(input);
    rateLimit.recordSuccess(input.username);
    return result;
  } catch (err) {
    if (err instanceof SpecificError) rateLimit.recordFailure(input.username);
    throw err;
  }
  ```
- **Two log channels, never merged**: audit events via `repo.logEvent(...)`; operational logs via the pino logger.
- **CSRF: `X-Requested-With` header required on all state-changing routes** (enforced by middleware).
- **Services take options objects (kw-arg-style explicit deps)** — never positional, never inferred.

## Security model

- DEK lives in **JS memory only** by default (`globalThis[Symbol.for("privance.dekStore.v1")]`).
- Three persistence levels (in-memory / sessionStorage / biometric-WebAuthn-PRF); see SPEC.md §6.2.
- HKDF labels are versioned and **FROZEN**: `finance/auth-v1`, `finance/kek-v1`, `finance/recovery-v1`. Bumping a label is a migration, not a code change.
- Argon2id parameters are **versioned in stored hashes**. Param bumps are expand/contract migrations.
- AEAD AAD binds `{record_uuid, label_version, kdf_param_version}` to prevent record-swap, downgrade, and silent label-version drift.
- Never log secrets, master passwords, DEKs, recovery phrases, or any decrypted user data.
- HIBP password check on signup (k-anonymity, fail-open on timeout with clear error).
- Constant-time comparisons via `@noble/hashes` `equalBytes`.
- Username-enumeration prevention via deterministic fake KDF params + recovery blobs.

## Server stores the minimum

Default = encrypt or omit. Adding a plaintext field requires explicit justification in the spec. Adding a write-only metadata field is a code smell — if no code reads it, it shouldn't exist.

When a spec proposes a new server-side field, it must answer: *why does the server need this in plaintext?*

## Backward-incompatible schema changes

Follow expand/contract. **Three deploys, not one:**

1. **Expand**: add the new column nullable; deploy code that writes both old and new.
2. **Backfill**: populate the new column from the old.
3. **Contract**: deploy code that reads new only; drop old in a later release.

A single-deploy rename is a foot-gun. Always expand/contract for any change that's not strictly additive.

## Tests

- **Shared server fixtures live in `server/test/<feature>/conftest.ts`** (or `server/test/fixtures/`). Never redeclare in test files.
- **Tests verify behavior through the PUBLIC API only**. No reaching into `_private` names. If you need to inspect state, add a public helper — never expose internals.
- **E2E flows go through `apps/web/tests/e2e/helpers/auth.ts`** (`signup`, `login`, `logout`, `capturePhrase`, `acknowledgePhrase`). Don't open-code in specs.
- **Stable E2E selectors**: `getByRole` > `getByLabel` > `getByTestId`. Never reach into Tailwind classes.
- **Distinct username per E2E test** (alice, bob, dave, eve, frank, ghost…) so per-test cleanState is sufficient.
- **Cross-browser flake** → `test.skip(predicate, "rationale")` with a comment explaining what coverage is still present. Don't delete a flaky test silently.
- **Coverage gates** (enforced in vitest config / bun test config):
  - `packages/core`: ≥ 90% line + branch
  - `server`: ≥ 85% line
  - `apps/web`: ≥ 80% for non-screen logic (E2E covers screens)
- **Property tests** (`fast-check`) required for crypto primitives, decimal math, sync conflict logic.

## Commits and branching

- **Conventional Commits**: `feat / fix / refactor / chore / test / docs / ci` prefixes. Scope optional.
- **NEVER add a `Co-Authored-By` trailer.** Verify with `git log -1 --format=%B` before pushing.
- **Commit identity must be the GitHub noreply** (`40120869+rahulkrishnan1@users.noreply.github.com`). Don't override per-commit; don't reintroduce a real email.
- **Feature branches off main; squash-merge back.** main stays one commit per shipped feature.
- **Wait for CI green** before `gh pr merge --squash`. Never `--auto`.
- **Don't rewrite `main` history** once anything has been pushed.
- Plan files in `docs/superpowers/plans/` (when introduced) are **immutable historical records**.

## Verification bar (before claiming "verified clean")

Hitting these gates is necessary AND sufficient:

1. **packages/core**: `pnpm biome check` + `tsc --noEmit` + `vitest run --coverage` (≥ 90%)
2. **server**: `pnpm biome check` + `tsc --noEmit` + `bun test` (≥ 85%) + `bun audit` clean
3. **apps/web**: `pnpm biome check` + `tsc --noEmit` + `vitest run` + `expo export --platform web` (build green) + `pnpm audit` clean
4. **E2E**: actually RUN (not just `--list`), real browser, real DB (testcontainers). Skip rationale documented if any.
5. **Manual**: at least one signup → recovery → login cycle in a real browser for any auth-touching change.

If any of the four is skipped, the work is explicitly NOT verified — state that explicitly in PR descriptions.

## Adding a feature

1. Read an existing module as the template.
2. Mirror file structure exactly. Don't invent new patterns; explain in the PR if tempted.
3. Add new audit events to SPEC §7.3 (or equivalent) *before* emitting them in code.
4. Add new oRPC procedures / HTTP routes to SPEC §9 (or equivalent) *before* implementing.
5. Update relevant READMEs if the public surface changes.
6. Plan files for new specs go under `docs/architecture/<date>-<feature>-design.md`.

## Red flags

- Service file growing past ~130 LOC → split the flow
- A file growing past ~250 LOC → split by responsibility
- Repeated `try/catch` block in routes → it's the error mapper's job
- Reaching into a `_private` name from another module → add a public helper instead
- A test that calls `.skip()` on the condition it's testing → delete or fix
- A test whose name claims a behavior its body doesn't verify → delete or fix
- A `// @ts-ignore` / `@ts-expect-error` → solve the underlying type problem
- A new dep with `^` in package.json → exact-pin it (Shai-Hulud lesson)

## Workflow

- Make a backup branch before destructive git ops.
- Stop and ask if a request needs destructive action you weren't explicitly authorized for.
- Save lessons learned to user memory (`~/.claude/projects/.../memory/`) when patterns emerge.

## What's NOT here

- Architecture rationale (read `SPEC.md`)
- API contract (read SPEC §9 or `docs/openapi.json` once generated)
- Operations runbook (read `infra/README.md` once written)

This file is **conventions only**. If something isn't a rule, it doesn't belong here.
