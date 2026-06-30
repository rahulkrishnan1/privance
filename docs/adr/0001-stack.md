# ADR-0001: Stack

- **Status:** Accepted
- **Date:** 2026-05-16

## Context

Privance is a self-hostable, zero-knowledge personal finance app that runs as a PWA on iOS / Android / macOS / Windows / Linux.

Constraints that shaped the stack:

- Single language end-to-end so crypto, decimal math, and domain types can be shared between server and client without a translation layer.
- PWA-first, installable on iOS / Android / desktop without UI rewrites.
- Self-hostable on a single small VPS (≤ 2 vCPU / 4 GB).
- Zero-knowledge: the server can never decrypt user data.
- Modern, popular, actively maintained (sustainable hiring + community).
- Exact-pinned versions (post-Shai-Hulud supply-chain discipline).

## Decision

| Layer    | Choice |
| -------- | ------ |
| Server   | Bun 1.3 + Hono 4.12 + postgres.js + Drizzle ORM + pino, PostgreSQL 17. Routes are raw Hono with hand-rolled validators. |
| Shared   | TypeScript-only `packages/core` (crypto, decimal, domain, sync, storage). |
| Client   | Next.js 16 (App Router, static export) + React 19 + Tailwind 4 + Recharts. |
| Crypto   | `@noble/hashes` + `@noble/ciphers` + `@scure/bip39` + `hash-wasm`. |
| Storage  | SQLite via `@sqlite.org/sqlite-wasm` in a dedicated Web Worker, OPFS SAH Pool VFS where available, in-memory fallback otherwise. |
| Decimals | `BigInt` minor-units + a thin `Decimal` wrapper in `packages/core`. |
| Monorepo | pnpm 11 workspaces (`nodeLinker: hoisted`) + Turborepo. |
| Tooling  | Biome 2.4 (lint + format), TypeScript strict + `noUncheckedIndexedAccess` (TS 6 in `core`, `server`, and root; TS 5 in `apps/web`, pending Next.js support), Vitest + fast-check + Playwright. |

## Consequences

**Easier:**

- One language across server, shared, and client. Domain types, crypto primitives, and decimal math are written once.
- Strong types via TypeScript strict + Drizzle + Zod end-to-end.
- Single test-tooling surface (Vitest + bun test, both first-class).
- Fast iteration: Bun's startup + Vitest's runner + Next.js fast refresh.

**Harder:**

- Bun is younger than Node; some ecosystem packages still ship Node-only assumptions. Mitigation: `@types/bun`, Hono is Bun-native, postgres.js works on both.
- Client storage depends on browser support for WASM and OPFS. OPFS is available in iOS 15.2+ Safari and Android System WebView ≥ 108; older runtimes fall back to an in-memory store that re-populates from the server each session.

**Locked out of (until reversed):**

- Server-side LLM features that require Python ML stacks (most LLM SDKs do have JS clients, so this is mild).
- Drizzle migrations are the source of truth; switching to Prisma or Kysely later is a rewrite.

**Reversal cost:**

- Server rewrite (Bun → Node, Hono → Fastify) is mechanical, days of work, no data migration.
- Drizzle → another ORM is harder; migrations are SQL-style, so we could keep migrations and only swap query code.

## Alternatives considered

**Rust backend.** Stronger memory-safety guarantees but a small team can't sustain two languages. Bun + TypeScript is faster to ship and close enough at runtime for our workload (encrypted-blob CRUD + sliding-window rate limiting).

**Python backend + TypeScript client.** Rejected: forces every shared concept (decimal, domain, crypto labels) to be duplicated and kept in sync. The bug surface is the *gap* between the two implementations.

**Decimal library (`decimal.js`, `big.js`, `dnum`).** Rejected: `decimal.js` is large (~30 KB), `big.js` is older API, `dnum` is small but adds a dep. BigInt minor-units with a thin wrapper covers our needs (sum, sub, mul-by-rate, format) without any dep, and our money is always in minor units anyway when serialized.

**Prisma instead of Drizzle.** Rejected: Drizzle is closer to SQL, has lower runtime overhead, and the schema is plain TypeScript files (no codegen).

**An RPC framework (tRPC, oRPC) instead of raw Hono routes.** Rejected for now: the API surface is small (encrypted-blob CRUD plus auth), and raw Hono handlers with hand-rolled validators and a single error mapper per module keep the request/response shape explicit at the wire boundary. tRPC v11 ties closely to React Query; oRPC ships OpenAPI but adds a dependency and an abstraction layer we do not yet need. Either can be adopted later per-feature without rewriting the rest.
