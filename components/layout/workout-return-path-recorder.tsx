"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { PRECACHE_NAV_ROUTES } from "@/lib/precache-nav-routes";
import { WORKOUT_RETURN_PATH_KEY } from "@/lib/workout-nav";

/**
 * Tracks the last non-workout pathname before entering `/workout/*` so the
 * header can `router.replace` there offline (instead of risking a stalled
 * `<Link>` RSC hop). While on a workout and online, prefetches shell routes so
 * `router.replace` and `<Link>` navigations replay from cache offline.
 */
export function WorkoutReturnPathRecorder() {
  const pathname = usePathname();
  const router = useRouter();
  const prevPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevPathnameRef.current;
    if (
      pathname?.startsWith("/workout") &&
      prev &&
      !prev.startsWith("/workout")
    ) {
      try {
        sessionStorage.setItem(WORKOUT_RETURN_PATH_KEY, prev);
      } catch {
        /* ignore quota / privacy mode */
      }
    }
    prevPathnameRef.current = pathname ?? null;
  }, [pathname]);

  useEffect(() => {
    if (!pathname?.startsWith("/workout")) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    for (const route of PRECACHE_NAV_ROUTES) {
      router.prefetch(route);
    }
  }, [pathname, router]);

  return null;
}
