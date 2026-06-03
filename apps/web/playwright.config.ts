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
  // Reusing a few fixture users across many specs and five projects from one IP
  // would trip the production login caps; lift them for the E2E backend only.
  // Signup stays capped (the suite budgets signups via global-setup's cooldown).
  RATE_LIMIT_LOGIN_PER_USERNAME: "1000",
  RATE_LIMIT_LOGIN_PER_IP: "1000",
  // Use deterministic fake price + profile upstreams so E2E doesn't depend on
  // live Yahoo / CoinGecko quotas. Real upstreams run in dev (no env override).
  PRICE_PROVIDER: "fake",
  // PROXYBAD is not a real ticker; forces the proxy-failure path in E2E without
  // affecting any other test that uses VOO, AAPL, etc.
  PRICE_FAKE_UNKNOWN: "PROXYBAD",
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
 * Coverage matches the surfaces we ship (web + installed PWA), per engine and
 * viewport: chromium, firefox, and webkit each run the full desktop functional
 * suite (webkit additionally runs the OPFS storage specs, which only apply to
 * it). The two mobile projects run the comprehensive *.mobile specs against the
 * mobile UI: iPhone (WebKit, the iOS PWA engine) and Pixel 5 (Chromium, the
 * Android PWA engine). workers:1 serialises the main-thread argon2id KDF so
 * parallel WebKit contexts do not sum to an out-of-memory kill.
 *
 * These projects run in full locally (macOS). On CI, the shared Linux runner
 * cannot carry the 64 MB Argon2id auth flows on WebKit in time, so the CI
 * workflow scopes the WebKit projects to the storage specs and runs the mobile
 * suite on Pixel 5 only. Restoring full WebKit + iPhone coverage to CI via a
 * reduced test-env KDF cost is a tracked follow-up.
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
      testIgnore: /(webkit-storage|fallback-storage|.*\.mobile)\.spec\.ts$/,
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: /(webkit-storage|fallback-storage|.*\.mobile)\.spec\.ts$/,
    },
    {
      // Full desktop suite plus the OPFS storage specs (which testMatch on
      // browserName === "webkit" internally). Only the mobile specs are ignored.
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: /\.mobile\.spec\.ts$/,
    },
    {
      // iOS PWA surface: WebKit at a phone viewport. Runs the mobile UI specs.
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
      testMatch: /\.mobile\.spec\.ts$/,
    },
    {
      // Android PWA surface: Chromium at a phone viewport. Runs the mobile UI specs.
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
      testMatch: /\.mobile\.spec\.ts$/,
    },
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
