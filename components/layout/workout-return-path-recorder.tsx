"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { WORKOUT_RETURN_PATH_KEY } from "@/lib/workout-nav";

/**
 * Tracks the last non-workout pathname before entering `/workout/*` so the
 * header can `router.replace` there offline (instead of risking a stalled
 * `<Link>` RSC hop). Warm-prefetches `/` while on a workout for better cache hits.
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
    router.prefetch("/");
  }, [pathname, router]);

  return null;
}
