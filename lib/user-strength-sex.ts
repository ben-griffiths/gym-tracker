/**
 * Which StrengthLevel **standard column** (male vs female tiers) feeds catalog
 * 1RM inference and tier/score thresholds. Stored client-side only.
 */
export type UserStrengthSex = "male" | "female";

export const USER_STRENGTH_SEX_STORAGE_KEY = "liftlog-strength-sex";

export const DEFAULT_USER_STRENGTH_SEX: UserStrengthSex = "male";

export function isUserStrengthSex(value: unknown): value is UserStrengthSex {
  return value === "male" || value === "female";
}

export function parseUserStrengthSex(
  raw: string | null | undefined,
): UserStrengthSex {
  return isUserStrengthSex(raw) ? raw : DEFAULT_USER_STRENGTH_SEX;
}

export function readUserStrengthSexFromStorage(): UserStrengthSex {
  if (typeof window === "undefined") return DEFAULT_USER_STRENGTH_SEX;
  try {
    return parseUserStrengthSex(localStorage.getItem(USER_STRENGTH_SEX_STORAGE_KEY));
  } catch {
    return DEFAULT_USER_STRENGTH_SEX;
  }
}
