# ADR-0001: Stack

- **Status:** Accepted
- **Date:** 2026-05-16
- **Deciders:** @rahulkrishnan1

## Context

Privance v1 (this rebuild) needs to ship a self-hostable, zero-knowledge personal finance app as a PWA on iOS / Android / macOS / Windows / Linux, with an architecture that does not preclude future native builds. The v0 codebase (Python FastAPI + Next.js) shipped in a week and demonstrated the design; the rebuild consolidates on a single language end-to-end and improves portability.

Constraints:

- Single language end-to-end (lower onboarding, share crypto + math + domain code between client and server)
- PWA-first today, ready for native iOS / Android via Expo and desktop via Tauri later
- Self-hostable on a single small VPS (≤ 2 vCPU / 4 GB)
- Zero-knowledge — server can never decrypt user data
- Modern, popular, actively maintained (sustainable hiring + community)
- Exact-pinned versions (Shai-Hulud lesson)

## Decision

| Layer    | Choice                                                                 |
| -------- | ---------------------------------------------------------------------- |
| Server   | Bun 1.3 + Hono 4.12 + postgres.js + Drizzle ORM + oRPC + pino, PG 17   |
| Shared   | TypeScript-only `packages/core` (crypto, decimal, domain, sync)        |
| Client   | Expo SDK 55 + Expo Router + NativeWind 4.2 + Tailwind 3.4 + Recharts   |
| Crypto   | `@noble/hashes` + `@noble/ciphers` + `@scure/bip39` + `hash-wasm`      |
| Storage  | SQLite (sqlite-wasm SAHPool on web today; expo-sqlite on native later) |
| Decimals | `BigInt` minor-units + a thin `Decimal` wrapper in `packages/core`     |
| Monorepo | pnpm 11 workspaces (`nodeLinker: hoisted`) + Turborepo                 |
| Tooling  | Biome 2.4 (lint + format), TypeScript 6 strict + `noUncheckedIndexedAccess`, Vitest + fast-check + Playwright |

## Consequences

**Easier:**

- One language across server, shared, and client. Domain types, crypto primitives, and decimal math are written once.
- Strong types via TypeScript strict + Drizzle + Zod + oRPC end-to-end.
- Single test-tooling surface (Vitest + bun test, both first-class).
- Fast iteration: Bun's startup + Vitest's runner + Expo's hot reload.

**Harder:**

- Bun is younger than Node; some ecosystem packages still ship Node-only assumptions. Mitigation: `@types/bun`, Hono is Bun-native, postgres.js works on both.
- Expo + pnpm strict layout fights transitive resolution. Mitigation: `nodeLinker: hoisted` in `pnpm-workspace.yaml`.
- oRPC ≥1.0 is recent. Mitigation: it composes cleanly with Hono; we can swap procedures for raw Hono routes per-feature if we hit a wall.

**Locked out of (until reversed):**

- Server-side LLM features that require Python ML stacks (most LLM SDKs do have JS clients, so this is mild).
- Drizzle migrations are the source of truth; switching to Prisma or Kysely later is a rewrite.

**Reversal cost:**

- Server rewrite (Bun → Node, Hono → Fastify) is mechanical, days of work, no data migration.
- Drizzle → another ORM is harder — migrations are SQL-style; we could keep migrations and only swap query code.
- Expo → bare React Native + Next.js Web is a per-screen port, weeks of work, no data migration.

## Alternatives considered

**Stay on Python + TypeScript split.** Rejected: forces every shared concept (decimal, domain, crypto labels) to be duplicated and kept in sync. The bug surface is the *gap* between the two implementations.

**Rust backend.** Rejected: stronger guarantees but small team can't sustain two languages. Bun + TypeScript is faster to ship and almost as fast at runtime.

**Next.js for the web only (defer mobile).** Rejected: locks us out of the "one app, all platforms" goal; would require a Next.js→Expo migration before native.

**Decimal library (`decimal.js`, `big.js`, `dnum`).** Rejected: `decimal.js` is large (~30 KB), `big.js` is older API, `dnum` is small but adds a dep. BigInt minor-units with a thin wrapper covers our needs (sum, sub, mul-by-rate, format) without any dep — and our money is always in minor units anyway when serialized.

**Prisma instead of Drizzle.** Rejected: Drizzle is closer to SQL, has lower runtime overhead, and the schema is plain TypeScript files (no codegen).

**tRPC instead of oRPC.** Rejected: tRPC v11 is mature but ties closely to React Query and lacks OpenAPI emission; oRPC ships OpenAPI for free, which we need for any future curl-based integrations and for documentation.

**Tailwind 4 + NativeWind 5.** Rejected: NativeWind 5 is alpha; Tailwind 4 + NativeWind 4.2 isn't a supported combo yet. Will revisit when NativeWind 5 stabilizes.
