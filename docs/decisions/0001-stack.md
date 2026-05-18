# ADR-0001: Stack

- **Status:** Accepted
- **Date:** 2026-05-16

## Context

Privance is a self-hostable, zero-knowledge personal finance app that runs as a PWA on iOS / Android / macOS / Windows / Linux today, with the same static build wrapped by Capacitor for iOS and Android app-store distribution.

Constraints that shaped the stack:

- Single language end-to-end so crypto, decimal math, and domain types can be shared between server and client without a translation layer.
- PWA-first, with a path to native iOS / Android (Capacitor) and desktop (Tauri) without UI rewrites.
- Self-hostable on a single small VPS (≤ 2 vCPU / 4 GB).
- Zero-knowledge: the server can never decrypt user data.
- Modern, popular, actively maintained (sustainable hiring + community).
- Exact-pinned versions (post-Shai-Hulud supply-chain discipline).

## Decision

| Layer    | Choice |
| -------- | ------ |
| Server   | Bun 1.3 + Hono 4.12 + postgres.js + Drizzle ORM + pino, PostgreSQL 17. oRPC is installed as a dep but adoption is planned; routes are raw Hono today. |
| Shared   | TypeScript-only `packages/core` (crypto, decimal, domain, sync, storage). |
| Client   | Next.js 16 (App Router, static export) + React 19 + Tailwind 4 + Recharts. |
| Mobile   | Capacitor 8 wrapping the Next.js static export (iOS WKWebView, Android WebView). |
| Crypto   | `@noble/hashes` + `@noble/ciphers` + `@scure/bip39` + `hash-wasm`. |
| Storage  | SQLite via `@sqlite.org/sqlite-wasm` + OPFS (SAH Pool VFS) in a dedicated Web Worker. The same WASM runs inside the Capacitor WebView on mobile. |
| Decimals | `BigInt` minor-units + a thin `Decimal` wrapper in `packages/core`. |
| Monorepo | pnpm 11 workspaces (`nodeLinker: hoisted`) + Turborepo. |
| Tooling  | Biome 2.4 (lint + format), TypeScript 6 strict + `noUncheckedIndexedAccess`, Vitest + fast-check + Playwright. |

## Consequences

**Easier:**

- One language across server, shared, and client. Domain types, crypto primitives, and decimal math are written once.
- Strong types via TypeScript strict + Drizzle + Zod end-to-end (and oRPC once procedures replace the current Hono route handlers).
- Single test-tooling surface (Vitest + bun test, both first-class).
- Fast iteration: Bun's startup + Vitest's runner + Next.js fast refresh.
- iOS and Android ship from the exact same build artefact as the web app; there is no parallel native UI tree.

**Harder:**

- Bun is younger than Node; some ecosystem packages still ship Node-only assumptions. Mitigation: `@types/bun`, Hono is Bun-native, postgres.js works on both.
- oRPC ≥ 1.0 is recent. Mitigation: it composes cleanly with Hono; we can swap procedures for raw Hono routes per-feature if we hit a wall.
- Capacitor depends on WebView feature support for OPFS and WASM. Minimum targets in the shipped projects are iOS 15.0 (`IPHONEOS_DEPLOYMENT_TARGET` in `apps/web/ios/App/App.xcodeproj/project.pbxproj`) and Android API 24 (`minSdkVersion` in `apps/web/android/variables.gradle`). OPFS is available in iOS 15.2+ Safari and Android System WebView ≥ 108; older devices fall back to the IndexedDB-backed SAH Pool path inside sqlite-wasm.

**Locked out of (until reversed):**

- Server-side LLM features that require Python ML stacks (most LLM SDKs do have JS clients, so this is mild).
- Drizzle migrations are the source of truth; switching to Prisma or Kysely later is a rewrite.

**Reversal cost:**

- Server rewrite (Bun → Node, Hono → Fastify) is mechanical, days of work, no data migration.
- Drizzle → another ORM is harder; migrations are SQL-style, so we could keep migrations and only swap query code.
- Capacitor → a different native shell (React Native, native Swift/Kotlin hosts) is a UI rewrite, weeks of work, no data migration.

## Alternatives considered

**Rust backend.** Stronger memory-safety guarantees but a small team can't sustain two languages. Bun + TypeScript is faster to ship and close enough at runtime for our workload (encrypted-blob CRUD + sliding-window rate limiting).

**Python backend + TypeScript client.** Rejected: forces every shared concept (decimal, domain, crypto labels) to be duplicated and kept in sync. The bug surface is the *gap* between the two implementations.

**Decimal library (`decimal.js`, `big.js`, `dnum`).** Rejected: `decimal.js` is large (~30 KB), `big.js` is older API, `dnum` is small but adds a dep. BigInt minor-units with a thin wrapper covers our needs (sum, sub, mul-by-rate, format) without any dep, and our money is always in minor units anyway when serialized.

**Prisma instead of Drizzle.** Rejected: Drizzle is closer to SQL, has lower runtime overhead, and the schema is plain TypeScript files (no codegen).

**tRPC instead of oRPC.** Rejected: tRPC v11 is mature but ties closely to React Query and lacks OpenAPI emission; oRPC ships OpenAPI for free, which we need for any future curl-based integrations and for documentation.

**React Native instead of Capacitor for native shells.** Rejected: React Native would require a parallel UI tree (no shared DOM with the web app), doubling screen development. Capacitor reuses the exact same Next.js static export, so iOS and Android are a packaging concern rather than a separate codebase.
