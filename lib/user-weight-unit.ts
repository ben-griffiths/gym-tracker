import type { WeightUnitPreference } from "@/lib/weight-units";

export type UserWeightUnit = WeightUnitPreference;

export const USER_WEIGHT_UNIT_STORAGE_KEY = "liftlog-weight-unit";

export const DEFAULT_USER_WEIGHT_UNIT: UserWeightUnit = "kg";

export function isUserWeightUnit(value: unknown): value is UserWeightUnit {
  return value === "kg" || value === "lb";
}

export function parseUserWeightUnit(
  raw: string | null | undefined,
): UserWeightUnit {
  return isUserWeightUnit(raw) ? raw : DEFAULT_USER_WEIGHT_UNIT;
}

export function readUserWeightUnitFromStorage(): UserWeightUnit {
  if (typeof window === "undefined") return DEFAULT_USER_WEIGHT_UNIT;
  try {
    return parseUserWeightUnit(localStorage.getItem(USER_WEIGHT_UNIT_STORAGE_KEY));
  } catch {
    return DEFAULT_USER_WEIGHT_UNIT;
  }
}
