/** Cookie + header used so E2E can skip auth when reusing `npm run dev` (no bypass env on that process). */
export const PW_BYPASS_COOKIE = "gym_playwright_bypass";

export const PW_BYPASS_HEADER = "x-gym-playwright-bypass";

/** Default secret for local dev only — never relied on when `NODE_ENV === "production"`. */
export const PW_BYPASS_DEFAULT_SECRET = "local-playwright-e2e";

export function playwrightDevBypassSecret(): string {
  return process.env.PLAYWRIGHT_E2E_BYPASS_SECRET ?? PW_BYPASS_DEFAULT_SECRET;
}

export function playwrightRequestBypassesAuth(headers: Headers): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const expected = playwrightDevBypassSecret();
  return headers.get(PW_BYPASS_HEADER) === expected;
}

/**
 * True when Dexie/API should use the stable E2E user (browser only for cookie half).
 */
export function clientPlaywrightBypassActive(): boolean {
  if (process.env.NEXT_PUBLIC_PLAYWRIGHT_BYPASS_AUTH === "true") return true;
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) =>
    c.trim().startsWith(`${PW_BYPASS_COOKIE}=`),
  );
}
