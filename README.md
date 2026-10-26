<p align="center">
  <img src="apps/web/public/icon.svg" alt="Privance" width="76" height="76" />
</p>

<h1 align="center">Privance</h1>

<p align="center">
  <em>Personal finance, kept personal.</em>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-5EEAD4"></a>
  <img alt="Zero-knowledge" src="https://img.shields.io/badge/encryption-zero--knowledge-5EEAD4">
  <img alt="PWA installable" src="https://img.shields.io/badge/PWA-installable-5EEAD4">
</p>

<p align="center">
  <img src="docs/screenshots/hero.png" alt="Privance: net worth, trend, and accounts at a glance" width="840">
</p>

Privance is a command center for your money: net worth, holdings, spending, and a financial independence planner. Everything is encrypted in your browser before it leaves. Your server stores that encrypted data but never the keys to unlock it. Even if it were breached, all anyone would find is your username and some timestamps. Not your balances, not your investments, not a single dollar.

## Inside the vault

- **Net worth, honestly computed.** Assets minus liabilities across cash, brokerage, retirement, property, and crypto, tracked on a daily trend and calculated to the exact cent.
- **Holdings, priced live.** Stocks, funds, and crypto with fractional shares and your real cost basis. Price lookups go out anonymously, never tied to you.
- **Allocation and insights.** Your mix by asset class and sector, how much rides on any single holding, and where every dollar sits by tax treatment.
- **Spending you're committed to.** Bills and subscriptions, essentials and discretionary, logged by hand. No bank linking; the server never learns where the money went.
- **Independence, simulated.** Project your path to financial independence with thousands of Monte Carlo runs and real historical-market replays, all on your own device.
- **Face, fingerprint, phrase.** Unlock with a passkey on the devices you trust. After a stretch of inactivity the app locks itself and clears your keys from memory.
- **The veil.** One tap frosts every figure on screen. Charts stay readable, numbers don't.
- **Installs from the browser.** A progressive web app that works offline on desktop and phone. No app store in the way.

## How the server stays blind

Your privacy isn't a setting or a promise; it's built into how the encryption works, and all of it happens in your browser:

1. **Stretch.** Your master password is put through Argon2id, a deliberately slow step that makes it impractical to guess.
2. **Split.** From it, two separate keys are created: one proves who you are to the server, the other encrypts your data and never leaves your device.
3. **Seal.** Every record is locked with AES-256-GCM and bound to its place, so nothing can be swapped out or tampered with.

| The server holds | The server never holds |
| --- | --- |
| login proof | your password |
| encrypted data | your encryption keys |
| timestamps | a single balance |

The code is open and the cryptography is standard, so you never have to take our word for it. Audit it, fork it, run it.

## Try it

- **Local, one command.** Build and run the whole stack on your machine with Docker Engine 28+ and Compose (or current Docker Desktop):
  ```sh
  git clone https://github.com/rahulkrishnan1/privance.git
  cd privance
  docker compose -f infra/compose.local.yaml up --build
  ```
  Open `http://localhost:8080` and create an account; no invite is required. This binds to loopback and runs over plain HTTP with a throwaway password and a fixed dev secret, for evaluation only, so never expose it to a network. Tear it down with `docker compose -f infra/compose.local.yaml down -v` (**deletes the trial data**).

## Self-host

One server container, one Postgres, one Caddy for automatic TLS. A small VPS or even a Raspberry Pi will do. Public images ship from GHCR (`ghcr.io/rahulkrishnan1/privance-{server,web,restic-runner}`), so there is nothing to build; bring a Linux host with Docker and either a private network or your own HTTPS domain.

The full procedure (private or public HTTPS, secrets, optional encrypted offsite backups and invite-only signup) is in [`infra/README.md`](infra/README.md).

## Development

Follow [CONTRIBUTING.md](CONTRIBUTING.md#setup) to install prerequisites, configure the database, and start the app. It also covers tests, verification, and PRs. Coding agents should start with [AGENTS.md](AGENTS.md) for guardrails and task-specific reading.

```
apps/web/      Vite 8 PWA (React, Tailwind, React Router, static SPA)
packages/core/ Pure TypeScript: crypto, decimal math, sync, storage
server/        Bun + Hono + Drizzle + Postgres
infra/         Compose stack, deploy procedure, env templates
```

## Architecture and security

[ARCHITECTURE.md](ARCHITECTURE.md) maps the modules and data flow. [SECURITY.md](SECURITY.md) lists the security contracts and [THREAT_MODEL.md](THREAT_MODEL.md) the full STRIDE analysis. Found a vulnerability? Use [GitHub private vulnerability reporting](https://github.com/rahulkrishnan1/privance/security/advisories/new), not a public issue.

## License

[AGPL-3.0](LICENSE). Built in the open. No analytics, no trackers.
