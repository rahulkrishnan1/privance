# Privance: agent instructions

`AGENTS.md` is a symlink to this file. Edit this source; keep the symlink.

Privance is a self-hostable, zero-knowledge personal finance app. Financial records are encrypted in the browser; the server stores ciphertext and required metadata, not decryption keys. Losing both the master password and recovery phrase means permanent data loss.

## Workflow

1. **Scope:** read the affected code, callers, and tests. State assumptions and checkable success criteria; ask when an unresolved choice changes behavior or security.
2. **Implement:** reuse the nearest module's patterns. Make the smallest complete change, including affected callers, fixtures, exports, and docs. Keep unrelated refactors and speculative abstractions out of the diff.
3. **Check:** run the relevant checks in [CONTRIBUTING.md](CONTRIBUTING.md#verification). For a bug fix, demonstrate that the regression test fails without the fix and passes with it.
4. **Report:** state what changed, which checks passed or failed, and what was skipped. Address every flagged review finding or explicitly report why it remains unresolved. Reserve “verified clean” for the full verification bar.

## Read before the relevant task

Paths are relative to the repository root. Follow the matching links before editing; unrelated branches need not be loaded.

| Task | Read |
|---|---|
| Setup, commands, tests, or verification | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Server routes, services, repositories, or migrations | [server/README.md](server/README.md) |
| Shared crypto, decimal, domain, sync, or storage code | [packages/core/README.md](packages/core/README.md) |
| Web features, browser storage, UI, or PWA behavior | [apps/web/README.md](apps/web/README.md) |
| Cross-workspace changes, routing, or data flow | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Auth, crypto, key persistence, logging, or server-visible data | [SECURITY.md](SECURITY.md#security-contracts-for-changes) and the affected asset in [THREAT_MODEL.md](THREAT_MODEL.md) |
| Session persistence or auto-lock | [ADR-0004](docs/adr/0004-session-persistence.md) |
| Passkeys or biometric unlock | [ADR-0005](docs/adr/0005-biometric-unlock.md) |
| Test-layer or browser-runner changes | [ADR-0003](docs/adr/0003-component-testing.md) |
| Stack or deployment design decisions | [ADR-0001](docs/adr/0001-stack.md) or [ADR-0002](docs/adr/0002-deployment.md) |
| Deployment, proxies, backups, or restores | [infra/README.md](infra/README.md); for host provisioning, [infra/hetzner-vps.md](infra/hetzner-vps.md) |
| Commits, pushes, or PRs | [CONTRIBUTING.md](CONTRIBUTING.md#commits-and-pull-requests) and the [PR template](.github/pull_request_template.md) |

## Guardrails

- **Money:** use `Decimal` (BigInt minor-units) for balances and amount arithmetic. Keep floating-point conversion at display/chart boundaries, never in financial calculations; serialize using the existing decimal/minor-unit string formats.
- **Keys:** preserve the frozen HKDF labels, AAD bindings, and versioned KDF migration contracts in [SECURITY.md](SECURITY.md#security-contracts-for-changes). Persist only approved wrapped-key forms, never raw DEK bytes.
- **Privacy:** keep passwords, keys, recovery phrases, and decrypted user data out of logs. Encrypt or omit new user data; a new plaintext server field needs a written justification in the spec explaining why the server needs it.
- **Mutations:** require `X-Requested-With` on state-changing API routes. Keep database access in repositories and domain-error mapping at the wire boundary.
- **Migrations:** backward-incompatible changes use **expand → backfill → contract**, across three deploys. A single-deploy destructive rename is not safe.
- **Dependencies:** pin direct dependency versions exactly (no `^` or `~`); use workspace links for internal packages.
- **Public files:** keep personal names, emails, handles, absolute local paths, and specific personal locations out of tracked content. Use placeholders for examples.
- **Git safety:** get explicit authorization before destructive operations and create `git branch backup-<context>` before a reset, rebase, or force-push. Never rewrite pushed `main` history. Merge only after green CI and explicit maintainer local-test approval.

## Documentation sources

Keep each rule in its authoritative home: workflow here, setup/tests/commits in `CONTRIBUTING.md`, module conventions in workspace READMEs, security contracts in `SECURITY.md`, threat analysis in `THREAT_MODEL.md`, and rationale in ADRs. Link instead of copying. Package scripts, manifests, and test configs define current commands and versions; inspect them when changing tooling. Update the affected documentation when behavior changes.
