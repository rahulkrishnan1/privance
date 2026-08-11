import path from "node:path";

const coreRoot = path.resolve(__dirname, "../../packages/core/src");

// Aliases ordered most-specific-first so Vite matches subpaths before the root.
// Shared by vite.config.ts and vitest.config.ts so a new @privance/core
// subpath is added in exactly one place.
export const alias = [
  { find: "@privance/core/decimal", replacement: path.join(coreRoot, "decimal/index.ts") },
  { find: "@privance/core/projection", replacement: path.join(coreRoot, "projection/index.ts") },
  { find: "@privance/core/storage", replacement: path.join(coreRoot, "storage/index.ts") },
  { find: "@privance/core/sync", replacement: path.join(coreRoot, "sync/index.ts") },
  { find: "@privance/core", replacement: path.join(coreRoot, "index.ts") },
  { find: "@", replacement: path.resolve(__dirname, "./src") },
];
