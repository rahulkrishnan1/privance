# @privance/core

Pure TypeScript library shared across the Privance monorepo. No DOM, no Bun, no
Node built-ins. Runs in the browser, in a Web Worker, and in Node/Bun test harnesses.

All client-side crypto primitives live here. The web app depends on this package directly. The server depends on it only for domain types and audit-event
constants, it does not perform client-side crypto.

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for how `core` fits into the overall
system.

## Key files

| Path | Purpose |
|---|---|
| `src/crypto/labels.ts` | HKDF label constants; see the [security contracts](../../SECURITY.md#security-contracts-for-changes) before crypto changes |
| `src/crypto/kdf.ts` | `stretchMasterPassword()`, Argon2id via hash-wasm |
| `src/crypto/keys.ts` | HKDF key derivation for auth hash, KEK, recovery seed |
| `src/crypto/aead.ts` | AES-256-GCM encrypt/decrypt with AAD binding |
| `src/crypto/recovery.ts` | BIP39 phrase encode/decode for the recovery seed |
| `src/storage/schema.ts` | SQLite DDL (sync_objects, outbound_queue, sync_cursor) |
| `src/storage/web-adapter.ts` | `WebSqliteAdapter`: Worker RPC over OPFS SAH Pool VFS with in-memory fallback |
| `src/sync/client.ts` | `SyncClient`: push/pull/reconcile loop |
| `src/sync/push.ts` | Outbound queue drain + batch push to server |
| `src/sync/pull.ts` | Change feed pull + local store merge |

## Module conventions

```text
packages/core/src/<module>/
├── index.ts            # Public barrel
├── types.ts            # Branded types, errors
├── <feature>.ts        # Pure logic
└── <feature>.test.ts    # Public-API behavior and invariants
```

Keep shared logic runtime-independent; browser lifecycle and API wiring belong in `apps/web`, server persistence in `server`. Follow the existing adapter boundary for storage rather than adding browser globals to domain logic.

Use the [package export map](package.json) for available entry points and update the relevant barrel when adding a public API. Money arithmetic follows the [Decimal guardrail](../../AGENTS.md#guardrails). Before changing crypto or key serialization, read [SECURITY.md](../../SECURITY.md#security-contracts-for-changes).

## Development

From the repository root:

```sh
pnpm --filter @privance/core test
pnpm --filter @privance/core test:watch
pnpm --filter @privance/core typecheck
pnpm --filter @privance/core build
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md#tests) for test conventions and coverage requirements. The build also verifies the projection returns dataset's recorded hash before emitting `dist/`.
