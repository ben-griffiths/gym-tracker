// Hand-rolled service worker — keeps the app shell available offline and
// caches GET /api/* (safe reads) so reads work without network. Mutations are
// NOT intercepted: lib/api.ts writes into Dexie + outbox and the sync engine
// flushes when online.
//
// Versioned cache name lets us bump and clear stale entries on deploy.
const SHELL_CACHE = "liftlog-shell-v9";
const RUNTIME_CACHE = "liftlog-runtime-v9";
const OFFLINE_FALLBACK = "/";

// Precache every top-level navigation. Without this, visiting /strength or
// /rep-maxes for the first time offline falls back to OFFLINE_FALLBACK and
// the user lands on the home page instead of the route they wanted.
//
// `/workout/[sessionId]` URLs are unbounded — we only cache those after an
// online visit (network-first + put). First visit to an unseen session offline
// falls back to `/`.
//
// Exercise detail URLs are unbounded; we precache the library + common slugs
// linked from audits / home so first-open offline covers main catalog paths.
// Keep in sync with `lib/precache-nav-routes.ts`.
const PRECACHE_NAV_ROUTES = [
  "/",
  "/workout",
  "/workout/new",
  "/strength",
  "/rep-maxes",
  "/exercises",
  "/exercises/squat",
  "/exercises/bench-press",
  "/exercises/deadlift",
  "/exercises/overhead-press",
  "/exercises/barbell-row",
  "/auth",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      await Promise.all(
        PRECACHE_NAV_ROUTES.map((url) =>
          cache.add(url).catch(() => undefined),
        ),
      );
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      );
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          // Unsupported or permission — ignore
        }
      }
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon") ||
    url.pathname.startsWith("/manifest.webmanifest") ||
    /\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname)
  );
}

function normalizePathname(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function isAppRouterFlightRequest(request, url) {
  if (request.method !== "GET") return false;
  if (url.searchParams.has("_rsc")) return true;
  const prefetch = url.searchParams.get("prefetch");
  if (prefetch === "1" || prefetch?.toLowerCase() === "rsc") return true;

  const h = request.headers;
  const segmentPrefetch = h.get("next-router-segment-prefetch");
  return (
    h.get("rsc") === "1" ||
    h.get("next-router-prefetch") === "1" ||
    h.has("next-router-state-tree") ||
    (segmentPrefetch != null && segmentPrefetch !== "")
  );
}

function isSafeApiGet(request, url) {
  if (request.method !== "GET") return false;
  if (!url.pathname.startsWith("/api/")) return false;
  // Skip endpoints that would lie about state if cached:
  //   - /api/workouts: reads now come from Dexie (lib/sync/workouts-live).
  //   - /api/sync/*, /api/vision/*, /api/webllm-log, /api/chat: dynamic.
  return !(
    url.pathname.startsWith("/api/workouts") ||
    url.pathname.startsWith("/api/sync/") ||
    url.pathname.startsWith("/api/vision/") ||
    url.pathname.startsWith("/api/webllm-log") ||
    url.pathname.startsWith("/api/chat")
  );
}

/**
 * Offline shell replay: tolerate `?_rsc=` churn and `Vary` on RSC (router
 * state) by widening cache matches, then any ok entry for the pathname, then `/`.
 */
async function matchShellOffline(cache, request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;

  const exact = await cache.match(request);
  if (exact?.ok) return exact;

  const ignoreQs = await cache.match(request, { ignoreSearch: true });
  if (ignoreQs?.ok) return ignoreQs;

  const ignoreQsVary = await cache.match(request, {
    ignoreSearch: true,
    ignoreVary: true,
  });
  if (ignoreQsVary?.ok) return ignoreQsVary;

  const pathNorm = normalizePathname(url.pathname);
  for (const keyReq of await cache.keys()) {
    const ku = new URL(keyReq.url);
    if (ku.origin !== url.origin) continue;
    if (normalizePathname(ku.pathname) !== pathNorm) continue;
    const hit = await cache.match(keyReq, { ignoreVary: true });
    if (hit?.ok) return hit;
  }

  const fallback = await cache.match(OFFLINE_FALLBACK);
  return fallback?.ok ? fallback : null;
}

/** Network-first shell + RSC flights; on failure uses {@link matchShellOffline}. */
async function networkFirstShell(request, event) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    let response = null;
    if (
      request.mode === "navigate" &&
      event &&
      event.preloadResponse != null
    ) {
      const preload = await event.preloadResponse.catch(() => null);
      if (preload && preload.ok) {
        response = preload;
      }
    }
    if (!response) {
      response = await fetch(request);
    }
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const offline = await matchShellOffline(cache, request);
    return offline || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request, event));
    return;
  }

  if (isAppRouterFlightRequest(request, url)) {
    event.respondWith(networkFirstShell(request, event));
    return;
  }

  // Static assets: stale-while-revalidate — instant replay offline, refresh when online.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res.ok) {
              cache.put(request, res.clone());
            }
            return res;
          })
          .catch(() => undefined);
        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }
        const live = await networkPromise;
        if (live) return live;
        return Response.error();
      })(),
    );
    return;
  }

  // Safe API GETs: NETWORK-FIRST. Fall back to last cached response only offline.
  if (isSafeApiGet(request, url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        try {
          const fresh = await fetch(request);
          if (fresh.ok) cache.put(request, fresh.clone());
          return fresh;
        } catch (err) {
          const hit = await cache.match(request);
          if (hit) return hit;
          throw err;
        }
      })(),
    );
  }
});
