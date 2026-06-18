# @privance/core

Pure TypeScript library shared across the Privance monorepo. No DOM, no Bun, no
Node built-ins. Runs in the browser, in a Web Worker, and in Node/Bun test harnesses.

All crypto primitives live here. The web app and (future) native apps depend on this
package directly. The server depends on it only for domain types and audit-event
constants, it does not perform client-side crypto.

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for how `core` fits into the overall
system.

## Key files

| Path | Purpose |
|---|---|
| `src/crypto/labels.ts` | HKDF label constants (frozen; bumping = migration) |
| `src/crypto/kdf.ts` | `stretchMasterPassword()`, Argon2id via hash-wasm |
| `src/crypto/keys.ts` | HKDF key derivation for auth hash, KEK, recovery seed |
| `src/crypto/aead.ts` | AES-256-GCM encrypt/decrypt with AAD binding |
| `src/crypto/recovery.ts` | BIP39 phrase encode/decode for the recovery seed |
| `src/storage/schema.ts` | SQLite DDL (sync_objects, outbound_queue, sync_cursor) |
| `src/storage/web-adapter.ts` | `WebSqliteAdapter`: Worker RPC over OPFS SAH Pool VFS with in-memory fallback |
| `src/sync/client.ts` | `SyncClient`: push/pull/reconcile loop |
| `src/sync/push.ts` | Outbound queue drain + batch push to server |
| `src/sync/pull.ts` | Change feed pull + local store merge |

## Exports

```
@privance/core             # everything
@privance/core/crypto      # key derivation, AES-GCM, HKDF, BIP39
@privance/core/storage     # LocalStore interface, WebSqliteAdapter, DDL
@privance/core/sync        # SyncClient, push, pull, reconcile
@privance/core/domain      # Account, Holding, Price, branded ID types
@privance/core/decimal     # BigInt minor-unit arithmetic
@privance/core/networth    # Net-worth aggregation
@privance/core/projection  # FIRE simulation engine (Monte Carlo + historical replay)
@privance/core/audit-events # Audit event name constants
```

## Development

```sh
# Run tests with coverage (gate: >= 90%)
pnpm test

# Watch mode
pnpm test:watch

# Type check
pnpm typecheck

# Build (emits to dist/)
pnpm build
```

Tests use Vitest. Property-based tests use `fast-check` for crypto round-trips,
decimal arithmetic invariants, and sync conflict resolution.
