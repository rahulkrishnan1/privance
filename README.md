# Privance, zero-knowledge encryption personal finance app

## What this is

Privance is a personal finance application built around a single principle: the server should be structurally incapable of reading your financial data. All encryption and decryption runs in your browser. The server stores opaque ciphertext blobs, account balances, holdings, and transactions are never decrypted outside the device that owns them.

The app is self-hostable. There are no required cloud dependencies, no telemetry, and no third-party analytics. You run the stack on your own hardware and the data stays there.

Privance ships as a static-export Progressive Web App (Next.js) that can be installed from the browser on any platform. The same static export is wrapped by Capacitor for native iOS and Android distribution; iOS and Android projects live under `apps/web/ios/` and `apps/web/android/` and share the exact same build artefact as the web app.

The threat model in one sentence: a fully compromised server reveals nothing about your financial data beyond your username and session metadata, because the server never holds a decryption key.

---

## Quickstart for developers

### Prerequisites

- **Bun** ≥ 1.3.14 (server runtime)
- **Node.js** ≥ 22.0.0 (Next.js build)
- **pnpm** ≥ 11.0.0
- **PostgreSQL** 17, run locally or via Docker (dev-only credentials; production generates a random secret, see `infra/README.md`):
  ```sh
  docker run -d --name privance-pg \
    -e POSTGRES_USER=privance \
    -e POSTGRES_PASSWORD=privance \
    -e POSTGRES_DB=privance \
    -p 5432:5432 \
    postgres:17-alpine
  ```

### Install and boot

```sh
git clone <repo-url> privance
cd privance
pnpm install

# Copy env files
cp server/.env.example server/.env
# Edit server/.env: DATABASE_URL works as-is with the Docker command above;
# ENUMERATION_SECRET is required (the server refuses to start without it):
#   openssl rand -base64 48   # paste the output after ENUMERATION_SECRET=

# Point the web app at the local server in dev (production builds default to
# same-origin and need no env var; Caddy proxies /api/* on the same host).
echo "NEXT_PUBLIC_SERVER_URL=http://localhost:3000" > apps/web/.env.development.local

# Run database migrations
pnpm --filter @privance/server db:migrate

# Start everything in parallel (server + web)
pnpm dev
```

The web app will be available at `http://localhost:8081` and the API server at `http://localhost:3000`.

### Required environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | `server/.env` | PostgreSQL connection string |
| `ENUMERATION_SECRET` | `server/.env` | Base64-encoded secret (≥ 32 bytes) for HMAC-keyed username-enumeration prevention |
| `NODE_ENV` | `server/.env` | Set to `production` in prod; controls secure cookie flag |
| `NEXT_PUBLIC_SERVER_URL` | `apps/web/.env.development.local` (dev) or build-time env (Capacitor) | Where the browser sends API requests. Unset in production web builds: the bundle calls relative paths and Caddy proxies them on the same origin. Required in dev (web :8081 and server :3000 are different origins) and Capacitor (custom scheme cannot use relative URLs). |
| `SIGNUP_ALLOWLIST` | `server/.env` | Optional comma-separated list of usernames allowed to sign up; empty = open |
| `INVITE_REQUIRED` | `server/.env` | Set to `"true"` to require invite tokens on signup. Empty / unset = open registration (subject to `SIGNUP_ALLOWLIST`). Mint tokens via the bun script in `server/scripts/mint-invite.ts` (see `infra/README.md` for the in-container command). |
| `ALLOWED_ORIGINS` | `server/.env` | Comma-separated allow-list of CORS origins for the API. CORS rejects all origins when unset. Production example: `https://privance.app`. |

---

## How it's structured

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full architecture overview, module map, data-flow traces, and diagrams.

```
privance/
├── apps/
│   └── web/          # Next.js 16 static PWA
├── packages/
│   └── core/         # Pure TypeScript: crypto, decimal math, sync, storage
├── server/           # Bun + Hono + Drizzle + Postgres
├── infra/            # Docker Compose stack, deploy script, env templates
├── docs/             # Architecture decision records (docs/adr/)
├── ARCHITECTURE.md
├── SECURITY.md
├── THREAT_MODEL.md
└── CONTRIBUTING.md
```

---

## Security model

Privance implements a zero-knowledge architecture. See [SECURITY.md](SECURITY.md) for the security policy and guaranteed properties, and [THREAT_MODEL.md](THREAT_MODEL.md) for the full STRIDE-style threat analysis.

---

## Self-host

Privance is designed to be self-hosted. The reference deployment at `https://privance.app` runs on a single small VPS with a Docker Compose stack (server + Postgres + Caddy + encrypted nightly backups to Backblaze B2). The architecture rationale is in [`docs/adr/0002-deployment.md`](docs/adr/0002-deployment.md); the step-by-step bring-up procedure is in [`infra/README.md`](infra/README.md).

What you need:

- A Linux host with Docker Engine and the Compose plugin (any provider; 2 vCPU / 4 GB minimum). A Hetzner-specific provisioning and hardening guide (SSH, UFW, Docker install, deploy user, sizing) is in [`infra/hetzner-vps.md`](infra/hetzner-vps.md). Note that Docker bypasses host firewall rules for published ports; the provided compose file publishes only 80/443 and keeps Postgres loopback-bound.
- A domain you control, with DNS that supports A + AAAA records (Cloudflare DNS-only mode works; proxy/orange-cloud mode does not, as it breaks Let's Encrypt HTTP-01).
- A Backblaze B2 account for encrypted offsite backups (optional but strongly recommended; any region works).

Images are pulled from GHCR (`ghcr.io/<owner>/privance-{server,web,restic-runner}`). While the repository is private, self-hosting requires a GitHub personal access token with `read:packages` scope to authenticate with GHCR before bringing the stack up.

For the full bring-up procedure (GHCR login, env files, TLS, backups, invite-only signup, deploys), see [`infra/README.md`](infra/README.md).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

AGPL-3.0. See [LICENSE](LICENSE).
