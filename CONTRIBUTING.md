# Contributing to Privance

## Prerequisites

- Node 22+
- pnpm 11+
- Bun 1.3+
- Docker (for local Postgres when working on the server)

## First setup

```bash
git clone <repo>
cd privance
pnpm install
```

That gets you a green workspace. To start the web app against an in-memory dev mode (no server), `pnpm --filter @privance/web dev`.

To bring up the full local stack:

```bash
docker compose up -d postgres
pnpm --filter @privance/server db:migrate
pnpm dev   # turbo runs server + web together
```

## Workflow

- Branch off `main`: `git checkout -b feat/<short-name>`.
- Commit in Conventional Commits style (`feat / fix / refactor / chore / test / docs / ci`).
- **Never** add `Co-Authored-By` trailers. Commit identity must be the GitHub noreply.
- Open a PR. Wait for CI green. `gh pr merge --squash` once green; never `--auto`.
- Delete your feature branch (local + remote) after merge.

## Local gates (must pass before pushing)

| Workspace      | Command                                                       |
| -------------- | ------------------------------------------------------------- |
| Root           | `pnpm biome check .`                                          |
| All workspaces | `pnpm -r run typecheck`                                       |
| packages/core  | `cd packages/core && pnpm test` (coverage ≥ 90%)              |
| server         | `cd server && bun test` (coverage ≥ 85%)                      |
| apps/web       | `cd apps/web && pnpm exec expo export --platform web`         |
| E2E            | `cd apps/web && pnpm exec playwright test` (chromium+firefox) |

Pre-commit (`lefthook install`) runs Biome + typecheck on staged files.

## Conventions

See `CLAUDE.md` for module shape, wiring rules, security model, and verification bar. Every rule there is enforced.

For non-obvious design decisions, write an ADR under `docs/decisions/`. Template: `docs/decisions/0000-template.md`.
