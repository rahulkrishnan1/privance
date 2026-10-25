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
| `src/account/` | Account destruction: verified cascade-delete of all per-user data |
| `src/prices/` | Public market-price refresh with Postgres cache (Yahoo + CoinGecko, optional Finnhub failover) |
| `src/symbol-profiles/` | Symbol metadata + sector weightings (Yahoo upstream + optional Finnhub failover, Postgres cache) |
| `src/sync/` | Encrypted blob CRUD + change-feed endpoint |
| `drizzle/` | Migration SQL files |

## Sync write ordering and tombstones

Public put, delete, and batch operations acquire a transaction-scoped PostgreSQL
advisory lock for the user before checking versions or allocating `server_seq`.
This serializes same-user writes across server instances, so a change-feed cursor
cannot pass a lower sequence that commits later. The lock hashes a namespaced
user ID; a hash collision only serializes unrelated users, never mixes their data.
Batches hold the lock for the entire transaction.

A delete checks `prev_version` and increments the stored version by one when
writing the tombstone. Stale pre-delete updates therefore conflict. Batch delete
results and the change feed report that new version; direct `DELETE` still
returns **204 No Content**. No ciphertext or encryption format changes.

`GET /api/sync/objects/:id` still returns 404 for tombstones by default.
Conflict resolution can opt into `?include_tombstone=true` to receive the same
object envelope plus a boolean `tombstone` discriminator (for live objects too).
This exposes the current version and sequence for an explicit delete/restore
choice without scanning the change feed. Tombstone ciphertext is not live data
and must not be decrypted. Authentication and per-user scoping are unchanged.

## Public market prices

`POST /api/prices/refresh` keeps the existing `source: "yahoo" | "coingecko"`
request and `{ prices, unknown }` response. All prices are USD decimal strings;
there is no currency conversion. Yahoo stock/ETF quotes require metadata with
exact currency `USD`. GBp (pence), GBP, EUR, missing currency, and other
unvalidated currencies are returned in `unknown`, never interpreted as USD.
Optional Finnhub failover first verifies `USD` via `/stock/profile2`, because
its `/quote` endpoint does not identify currency. An explicit currency rejection
cannot be overridden by fallback or a stale price.

Stock-price cache rows now use the internal `yahoo-usd-v1` namespace, while the
public source remains `yahoo`. Legacy `yahoo` rows are ignored even when fresh
and must be revalidated upstream; no schema migration or user-data deletion is
needed. Only validated stock quotes enter the new cache. Validated cached quotes
can still be served stale during provider/network failures or cooldowns; an
explicit currency rejection evicts the affected row. Clients must remove both
current and prior prices for tickers in a fulfilled refresh's `unknown` list,
while retaining cached prices when the refresh request itself fails.

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
| `TRUSTED_PROXY_HOPS` | No | Right-counted `X-Forwarded-For` entry for auth rate limits. Default `1` (Caddy); keep it for the documented Tailscale setup, where clients share an IP bucket. `0` ignores the header and uses a shared `unknown` bucket, not the socket IP. Change only with a verified proxy chain that rejects forged headers. |
| `NODE_ENV` | No | `production` enables Secure cookie flag |
| `PORT` | No | Defaults to 3000 |
| `SIGNUP_ALLOWLIST` | No | Comma-separated usernames allowed to sign up; empty = open registration |
| `INVITE_REQUIRED` | No | Set to `"true"` to require invite tokens on signup. Any other value (including empty/unset) leaves signup open (subject to `SIGNUP_ALLOWLIST`). Mint tokens via `server/scripts/mint-invite.ts`. |
| `ALLOWED_ORIGINS` | No | Comma-separated origins for CORS. No code default; `server/.env.example` ships `http://localhost:8081` for local dev. Production must set explicitly. |
| `PRIVANCE_SECRETS_DIR` | No | Directory to read `postgres_password` secret file from (Docker secrets pattern) |
| `PRICE_PROVIDER` | No | Set to `fake` to use deterministic in-process prices instead of hitting Yahoo / CoinGecko. Used in E2E and local dev. |
| `PRICE_FAKE_UNKNOWN` | No | Comma-separated tickers the fake upstream treats as unknown (no price returned). Only meaningful when `PRICE_PROVIDER=fake`. Used in E2E to exercise the proxy-failure path without touching real upstream quotas. |
| `FINNHUB_API_KEY` | No | Failover source for stock/ETF prices and profiles when Yahoo is unavailable. Free key at finnhub.io; unset = Yahoo only. |
| `COINGECKO_API_KEY` | No | CoinGecko Demo key for higher crypto-price rate limits. Free at coingecko.com/en/api; unset = keyless tier. |

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
