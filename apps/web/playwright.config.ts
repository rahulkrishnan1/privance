import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, SERVER_PORT, SERVER_URL, WEB_PORT } from "./playwright/ports";

// Env for spawning the bun server (process.env overrides, else local defaults)
const serverEnv: Record<string, string> = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://privance:privance@localhost:5432/privance",
  NODE_ENV: "test",
  ENUMERATION_SECRET:
    process.env.ENUMERATION_SECRET ??
    "8iAent0DybGgc5dgpHF4IFfLWC0pViapd+5sO9i3OeDGfRTNwwkhfc6xxlITfpoL",
  SIGNUP_ALLOWLIST: "",
  ALLOWED_ORIGINS: BASE_URL,
  // Reusing a few fixture users across many specs and five projects from one IP
  // would trip the production login caps; lift them for the E2E backend only.
  // Rate limits lifted for E2E (RATE_LIMIT_SIGNUP_PER_IP=1000).
  RATE_LIMIT_LOGIN_PER_USERNAME: "1000",
  RATE_LIMIT_LOGIN_PER_IP: "1000",
  RATE_LIMIT_SIGNUP_PER_IP: "1000",
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
 *   - production static export (sirv) on :8081
 *
 * Each test uses a distinct username so no cross-test DB state leaks.
 *
 * Browser tiering follows Testing Trophy: E2E verifies critical user journeys
 * end-to-end; don't repeat the full suite across every engine.
 *   - Chromium: full suite (CDP for WebAuthn/PRF, fastest execution).
 *   - Firefox: auth smoke only (cookie behaviour, WebAuthn, storage APIs).
 *   - WebKit: storage verification (OPFS + fallback) + auth smoke. Reduced-KDF
 *     params (v2) make signup feasible on Linux runners.
 *   - Mobile Safari / Mobile Chrome: *.mobile.spec.ts for viewport-specific
 *     layout and touch interaction.
 *
 * workers:1 serialises the main-thread argon2id KDF so parallel contexts do not
 * sum to an out-of-memory kill.
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
    baseURL: BASE_URL,

    // Capture artefacts on failure only
    trace: "on-first-retry",
    video: "on-first-retry",
    screenshot: "only-on-failure",

    // Bump expect timeout for post-crypto transitions
    actionTimeout: 10_000,
  },

  projects: [
    {
      // Curated critical-user-journey subset (Testing Trophy: E2E is the tip).
      // Auth (incl. recovery), accounts, holdings (+ regressions), dashboard,
      // session, landing, plan, spend, settings, biometric PRF.
      // CDP (WebAuthn/PRF) and the recovered journeys live here only.
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch:
        /(auth|accounts|holdings|dashboard|session-persistence|landing|plan|spend|settings|biometric-prf)\.spec\.ts$/,
    },
    {
      // Auth smoke only: cookie behaviour, WebAuthn, storage APIs are where
      // browser differences matter most between engines.
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testMatch: /(auth|session-persistence)\.spec\.ts$/,
    },
    {
      // Storage verification (OPFS behaviour + fallback path) and auth smoke
      // at reduced KDF cost (v2 params make signup feasible).
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testMatch: /(auth|webkit-storage|fallback-storage|biometric-unlock)\.spec\.ts$/,
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
      url: `${SERVER_URL}/api/auth/session`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { ...serverEnv, PORT: String(SERVER_PORT) },
    },
    {
      // Production static export served by sirv (matches the Docker image).
      // Builds first — VITE_* is baked into the bundle at build time —
      // then serves ./out on WEB_PORT. --single maps non-trailing-slash deep
      // links to index.html.
      //
      // WARNING (reuseExistingServer): outside CI this reuses whatever is already
      // on :8081. A stale/foreign build, or a developer's own `pnpm dev` started
      // without VITE_PRIVANCE_KDF_REDUCED, would defeat the reduced-KDF
      // (v2) params this build enables, so signup/login derivations are full-cost
      // and slow. CI sets CI=true so reuse never happens there.
      command: `VITE_SERVER_URL=${SERVER_URL} VITE_PRIVANCE_KDF_REDUCED=true pnpm -F @privance/web build && pnpm exec sirv out --port ${WEB_PORT} --single --quiet`,
      cwd: __dirname,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      // Cold `vite build` (plus prebuild sim worker) can exceed 120s.
      timeout: 180_000,
    },
  ],
});
