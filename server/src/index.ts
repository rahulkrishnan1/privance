import {
  featureRouter as authFeatureRouter,
  getAuthRepo,
  initAuthServices,
  requireSession,
} from "./auth/index.js";
import { evictInactive } from "./auth/rate-limit.js";
import { createApp } from "./core/app.js";
import { logger } from "./core/logger.js";
import { createFeatureRouter as createPricesRouter } from "./prices/index.js";
import { createFeatureRouter as createSymbolProfilesRouter } from "./symbol-profiles/index.js";
import { createFeatureRouter as createSyncRouter } from "./sync/index.js";

// Validate required env vars at startup, fails fast before accepting requests.
initAuthServices();

const syncFeatureRouter = createSyncRouter(requireSession);
const pricesFeatureRouter = createPricesRouter(requireSession);
const symbolProfilesFeatureRouter = createSymbolProfilesRouter(requireSession);
const app = createApp([
  authFeatureRouter,
  syncFeatureRouter,
  pricesFeatureRouter,
  symbolProfilesFeatureRouter,
]);

const port = Number(process.env.PORT ?? 3000);

// ---------------------------------------------------------------------------
// Background maintenance: rate-limit eviction + audit-event prune.
// ---------------------------------------------------------------------------

// Re-use the singleton repo initialised at startup, avoids a second connection pool.
const authRepo = getAuthRepo();

const evictHandle = setInterval(() => {
  evictInactive();
}, 60_000);

const pruneHandle = setInterval(
  () => {
    authRepo.pruneOldAuditEvents().catch((err: unknown) => {
      logger.error({ err }, "audit prune failed");
    });
  },
  24 * 3600 * 1000,
);

/** Cancel background timers, used in tests and graceful shutdown. */
export function shutdown(): void {
  clearInterval(evictHandle);
  clearInterval(pruneHandle);
}

export default {
  port,
  fetch: app.fetch,
};
