// Privance service worker — offline shell + static asset caching.
// Hand-written; no Workbox or next-pwa dependency.
// Version bump here triggers activate → cache cleanup.
const SW_VERSION = "v3";
const CACHE_NAME = `privance-${SW_VERSION}`;

// Files that must be cached on install for the offline shell to work.
// Next.js hashes JS chunks, so we only pre-cache stable public assets.
const PRECACHE_URLS = [
  "/",
  "/app/",
  "/unlock/",
  "/auth/login/",
  "/auth/signup/",
  "/auth/recovery/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  // SQLite WASM module — required for the app to function offline post-first-load
  "/sqlite/sqlite3.wasm",
  "/sqlite/index.mjs",
  "/sqlite/sqlite3-opfs-async-proxy.js",
  "/sqlite/privance-worker.mjs",
];

// ─── Message ─────────────────────────────────────────────────────────────────

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// ─── Install ─────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  // No skipWaiting(): a new SW activates only on the next fresh navigation, so
  // asset/version skew cannot land mid-session during an active crypto flow.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

// ─── Activate ────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests; pass through everything else.
  if (request.method !== "GET") return;

  // Cross-origin requests (e.g. the Bun API server on :3000) — network only.
  // Never cache encrypted API responses.
  if (url.origin !== self.location.origin) return;

  // Same-origin /api/* (deployments that put API behind the same host as the
  // web app) — never cache. There's no per-user scoping in the cache, so a
  // session change would leak the previous user's responses.
  if (url.pathname.startsWith("/api/")) return;

  // Static assets: Next.js chunks, SQLite WASM, icons — cache-first.
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigation requests (HTML routes) — network-first, offline fallback to "/".
  if (request.mode === "navigate") {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // All other same-origin GETs — network-first, no offline fallback.
  event.respondWith(networkFirst(request));
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/sqlite/") ||
    pathname === "/icon-192.png" ||
    pathname === "/icon-512.png" ||
    pathname === "/icon-maskable-512.png" ||
    pathname === "/manifest.json"
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Nothing cached and network failed — let the browser show its error.
    return new Response("Network error", { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? new Response("Offline", { status: 503 });
  }
}

async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const fallbackShell = new URL(request.url).pathname.startsWith("/app") ? "/app/" : "/";
    const cached = (await caches.match(request)) ?? (await caches.match(fallbackShell));
    return cached ?? new Response("Offline", { status: 503 });
  }
}
