/**
 * Top-level routes precached by `public/sw.js` (`PRECACHE_NAV_ROUTES`) and
 * warmed client-side from `/workout/*` so offline navigations hit cached RSC
 * flights. Keep the two lists identical.
 */
export const PRECACHE_NAV_ROUTES = [
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
] as const;
