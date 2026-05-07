/**
 * Base URL sent to Supabase as `redirectTo` / `emailRedirectTo` (OAuth + signup links).
 *
 * Must match an entry under **Supabase Dashboard → Authentication → URL configuration →
 * Redirect URLs**. If local URLs are omitted there, Auth falls back to **Site URL** (often
 * production), so Google sign-in on localhost appears to jump to prod.
 *
 * Optionally set **`NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN`** (no trailing slash) when your
 * dev URL must exactly match allow list (for example only `localhost` vs `127.0.0.1` is registered).
 */

export function getBrowserAuthRedirectOrigin(): string {
  const explicitRaw = process.env.NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN;
  const explicit =
    typeof explicitRaw === "string" ? explicitRaw.trim().replace(/\/+$/, "") : "";
  if (explicit.length > 0) return explicit;
  if (typeof window === "undefined") return "";
  return window.location.origin;
}
