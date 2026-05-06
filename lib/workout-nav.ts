/**
 * Offline-safe navigation helpers for `/workout/*`.
 *
 * `<Link href="/">` relies on cached App Router RSC flights; offline replay is
 * fragile when `_rsc` tokens don't match cached entries — `router.replace` to a
 * path we intentionally cached (typically `/`) avoids a hanging navigation when
 * the user came from `/` or `/strength`.
 */

export const WORKOUT_RETURN_PATH_KEY = "liftlog:workout-return-path";

/** Safe in-app targets only — never allow open redirects via sessionStorage. */
export function readWorkoutReturnPath(): string {
  if (typeof sessionStorage === "undefined") return "/";
  try {
    const raw = sessionStorage.getItem(WORKOUT_RETURN_PATH_KEY)?.trim();
    if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  } catch {}
  return "/";
}

export function navigateBackFromWorkoutOffline(router: {
  replace: (href: string) => void;
}): void {
  router.replace(readWorkoutReturnPath());
}
