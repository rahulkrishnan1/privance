# @privance/server

Bun + Hono API server for Privance. Stores only opaque AES-GCM ciphertext in
Postgres. Has no ability to decrypt user financial data.

See [ARCHITECTURE.md](../ARCHITECTURE.md) for the full server design and
[SECURITY.md](../SECURITY.md) for the security model.

## Key files

| Path | Purpose |
|---|---|
| `src/index.ts` | Entry point: wires feature routers, starts maintenance tasks |
| `src/core/app.ts` | `createApp()`: mounts CORS, secureHeaders, CSRF middleware globally |
| `src/core/middleware.ts` | `requireCsrfHeader`: blocks non-safe methods without `X-Requested-With` |
| `src/auth/` | Signup, login, recovery, password-change, sessions, rate limiting |
| `src/auth/rate-limit.ts` | Sliding-window + progressive backoff counters (in-memory) |
| `src/auth/hibp.ts` | HIBP k-anonymity check on signup |
| `src/prices/` | Public market-price refresh with Postgres cache (Yahoo + CoinGecko) |
| `src/sync/` | Encrypted blob CRUD + change-feed endpoint |
| `drizzle/` | Migration SQL files |

## Development

```sh
# Start with hot reload
bun run dev         # port 3000

# Run tests
bun test

# Migrations
bun run db:migrate  # apply pending migrations
bun run db:generate # generate a new migration from schema changes
bun run db:studio   # Drizzle Studio (DB browser)

# Type check
bun run typecheck
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ENUMERATION_SECRET` | Yes | Base64-encoded secret >= 32 bytes; used for fake KDF salt derivation and IP hashing |
| `NODE_ENV` | No | `production` enables Secure cookie flag |
| `PORT` | No | Defaults to 3000 |
| `SIGNUP_ALLOWLIST` | No | Comma-separated usernames allowed to sign up; empty = open registration |
| `INVITE_REQUIRED` | No | Set to `"true"` to require invite tokens on signup. Any other value (including empty/unset) leaves signup open (subject to `SIGNUP_ALLOWLIST`). Mint tokens via `server/scripts/mint-invite.ts`. |
| `ALLOWED_ORIGINS` | No | Comma-separated origins for CORS. No code default; `server/.env.example` ships `http://localhost:8081` for local dev. Production must set explicitly. For Capacitor native builds, include `capacitor://localhost` (iOS) and `https://localhost` (Android). |
| `PRIVANCE_SECRETS_DIR` | No | Directory to read `postgres_password` secret file from (Docker secrets pattern) |
| `PRICE_PROVIDER` | No | Set to `fake` to use deterministic in-process prices instead of hitting Yahoo / CoinGecko. Used in E2E and local dev. |
| `PRICE_FAKE_UNKNOWN` | No | Comma-separated tickers the fake upstream treats as unknown (no price returned). Only meaningful when `PRICE_PROVIDER=fake`. Used in E2E to exercise the proxy-failure path without touching real upstream quotas. |

## Module template

Every feature follows the same structure:

```
server/src/<feature>/
├── index.ts            # Barrel; never export service classes
├── types.ts            # Errors, result types, constants
├── schema.ts           # Drizzle table definitions
├── repo.ts             # Only layer that imports schema and queries the DB
├── wire.ts             # Hono routes + single error mapper per module
└── <flow>-service.ts   # One per cohesive flow; constructor takes options object
```

The `auth/` module is the richest reference implementation.
