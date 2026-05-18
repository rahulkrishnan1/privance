# Privance, zero-knowledge personal finance app

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
- **PostgreSQL** 17, run locally or via Docker:
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
cp .env.example server/.env
# Edit server/.env, set DATABASE_URL and ENUMERATION_SECRET (min 32 bytes base64)

# Set the web app to point at the local server
echo "NEXT_PUBLIC_SERVER_URL=http://localhost:3000" > apps/web/.env.local

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
| `NEXT_PUBLIC_SERVER_URL` | `apps/web/.env.local` | Where the browser should send API requests |
| `SIGNUP_ALLOWLIST` | `server/.env` | Optional comma-separated list of usernames allowed to sign up; empty = open |

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
├── ARCHITECTURE.md
├── SECURITY.md
├── THREAT_MODEL.md
└── CONTRIBUTING.md
```

---

## Security model

Privance implements a zero-knowledge architecture. See [SECURITY.md](SECURITY.md) for the security policy and guaranteed properties, and [THREAT_MODEL.md](THREAT_MODEL.md) for the full STRIDE-style threat analysis.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

AGPL-3.0. See [LICENSE](LICENSE).
