// Hand-rolled service worker — keeps the app shell available offline and
// caches GET /api/workouts (and other safe GETs) so reads work without
// network. Mutations are NOT intercepted: lib/api.ts writes them straight
// into Dexie + outbox and the sync engine flushes when online.
//
// Versioned cache name lets us bump and clear stale entries on deploy.
const SHELL_CACHE = "liftlog-shell-v2";
const RUNTIME_CACHE = "liftlog-runtime-v2";
const OFFLINE_FALLBACK = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll([OFFLINE_FALLBACK])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon") ||
    url.pathname.startsWith("/manifest.webmanifest") ||
    /\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname)
  );
}

function isSafeApiGet(request, url) {
  if (request.method !== "GET") return false;
  if (!url.pathname.startsWith("/api/")) return false;
  // Sync + vision + webllm-log are dynamic; never cache them.
  return !(
    url.pathname.startsWith("/api/sync/") ||
    url.pathname.startsWith("/api/vision/") ||
    url.pathname.startsWith("/api/webllm-log") ||
    url.pathname.startsWith("/api/chat")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first, fall back to cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request).then((m) => m || caches.match(OFFLINE_FALLBACK)),
        ),
    );
    return;
  }

  // Static assets: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Safe API GETs: NETWORK-FIRST. Stale-while-revalidate would mean the UI
  // sees the pre-mutation snapshot for one paint after every write — React
  // Query's invalidation refetches once and accepts whatever the SW gives
  // it, so a cached response wins. Hit the network when online, fall back
  // to the last cached response only when offline.
  if (isSafeApiGet(request, url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        try {
          const fresh = await fetch(request);
          if (fresh.ok) cache.put(request, fresh.clone());
          return fresh;
        } catch (err) {
          const cached = await cache.match(request);
          if (cached) return cached;
          throw err;
        }
      })(),
    );
  }
});
