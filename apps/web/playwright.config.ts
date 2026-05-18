import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Read env from server/.env for spawning the bun server
const serverEnv: Record<string, string> = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://privance:privance@localhost:5432/privance",
  PORT: "3000",
  NODE_ENV: "test",
  ENUMERATION_SECRET:
    process.env.ENUMERATION_SECRET ??
    "8iAent0DybGgc5dgpHF4IFfLWC0pViapd+5sO9i3OeDGfRTNwwkhfc6xxlITfpoL",
  SIGNUP_ALLOWLIST: "",
  ALLOWED_ORIGINS: "http://localhost:8081",
  // Use deterministic fake price + profile upstreams so E2E doesn't depend on
  // live Yahoo / CoinGecko quotas. Real upstreams run in dev (no env override).
  PRICE_PROVIDER: "fake",
};

// Root of the monorepo (two levels up from apps/web)
const MONOREPO_ROOT = path.resolve(__dirname, "../..");

/**
 * Playwright E2E configuration.
 *
 * Prerequisites (start before running):
 *   1. postgres on localhost:5432 with db=privance user=privance pw=privance
 *   2. `cd server && bun run db:migrate` (migrations applied once)
 *
 * The config boots two servers automatically:
 *   - bun API server on :3000
 *   - Next.js dev server on :8081
 *
 * Each test uses a distinct username so no cross-test DB state leaks.
 *
 * WebKit is skipped: on macOS CI it regularly fails on argon2-wasm crypto
 * timing. Chromium + Firefox provide sufficient cross-engine coverage.
 * WebKit coverage gap: password derivation path. The core crypto logic is
 * covered by vitest unit tests (packages/core) on all platforms.
 */
export default defineConfig({
  testDir: "./tests/e2e",

  globalSetup: "./playwright/global-setup.ts",

  // Fail fast on the first test file failure during CI
  fullyParallel: false,

  // Retry flaky tests on CI only
  retries: process.env.CI ? 2 : 0,

  // One worker to avoid DB contention (argon2 is CPU-bound anyway)
  workers: 1,

  // Argon2 KDF derivation takes 3-8s; full signup flow needs 60s headroom
  timeout: 60_000,

  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://localhost:8081",

    // Capture artefacts on failure only
    trace: "on-first-retry",
    video: "on-first-retry",
    screenshot: "only-on-failure",

    // Bump expect timeout for post-crypto transitions
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    // WebKit excluded: see docstring above.
  ],

  webServer: [
    {
      // Bun API server
      command: `bun run src/index.ts`,
      cwd: path.join(MONOREPO_ROOT, "server"),
      url: "http://localhost:3000/api/auth/session",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: serverEnv,
    },
    {
      // Next.js dev server
      command: "pnpm dev",
      cwd: __dirname,
      url: "http://localhost:8081",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        NEXT_PUBLIC_SERVER_URL: "http://localhost:3000",
      },
    },
  ],
});
