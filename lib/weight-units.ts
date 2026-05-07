/**
 * Mass unit conversion and display helpers.
 *
 * **Canonical semantics:** strength math and `oneRmKg` style values are in **kg**.
 * Persisted sets use `weight` + `weightUnit` (`kg` | `lb`) as stored on the server
 * (no silent migration). User **display preference** only affects UI and default
 * chat hints; always convert stored → kg → display to avoid double conversion.
 */

export const KG_PER_LB = 0.45359237;

export type WeightUnitPreference = "kg" | "lb";

/** Convert a stored bar load to kilograms. */
export function toKg(weight: number, unit?: string | null): number {
  if (unit === "lb") return weight * KG_PER_LB;
  return weight;
}

/** Kilograms → number in the user's display unit (not rounded). */
export function kgToDisplayNumber(
  kg: number,
  displayUnit: WeightUnitPreference,
): number {
  if (!Number.isFinite(kg)) {
    return displayUnit === "kg" ? 0 : 0;
  }
  return displayUnit === "lb" ? kg / KG_PER_LB : kg;
}

/** User-visible number (in {@link displayUnit}) → kilograms. */
export function displayNumberToKg(
  value: number,
  displayUnit: WeightUnitPreference,
): number {
  if (!Number.isFinite(value)) return 0;
  return displayUnit === "lb" ? value * KG_PER_LB : value;
}

/**
 * @deprecated Prefer {@link kgToDisplayNumber}; kept for call sites that name
 * 1RM explicitly — same math as any kg mass.
 */
export function oneRmKgToDisplayUnit(
  oneRmKg: number,
  displayUnit: WeightUnitPreference,
): number {
  if (!Number.isFinite(oneRmKg) || oneRmKg <= 0) {
    return displayUnit === "kg" ? 0 : 0;
  }
  return kgToDisplayNumber(oneRmKg, displayUnit);
}

const stripTrailingZeros = (s: string) =>
  s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.$/, "");

/** Rounded label for table summaries (integers in lb, sensible kg rounding). */
export function formatWeightCompactFromKg(
  kg: number,
  displayUnit: WeightUnitPreference,
): string {
  if (!Number.isFinite(kg)) return "—";
  const v = kgToDisplayNumber(kg, displayUnit);
  if (displayUnit === "lb") return String(Math.round(v));
  const rounded = Math.round(v * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return stripTrailingZeros(rounded.toFixed(1));
}

/** Suffix for subtitles / ARIA (`kg` / `lb`). */
export function weightUnitSuffix(displayUnit: WeightUnitPreference): string {
  return displayUnit === "lb" ? "lb" : "kg";
}

/** Same rounding as {@link formatWeightCompactFromKg}; preferred name at UI boundaries. */
export function formatWeightKgForDisplay(
  weightKg: number,
  unit: WeightUnitPreference,
): string {
  return formatWeightCompactFromKg(weightKg, unit);
}

/** @alias {@link weightUnitSuffix} — short label beside formatted masses. */
export function suffixForUnit(unit: WeightUnitPreference): string {
  return weightUnitSuffix(unit);
}

/**
 * Draft string for a numeric weight field edited in {@link displayUnit}.
 */
export function weightFieldDraftFromStored(
  storedWeight: number | null,
  storedUnit: WeightUnitPreference,
  displayUnit: WeightUnitPreference,
): string {
  if (storedWeight === null) return "";
  const kg = toKg(storedWeight, storedUnit);
  const v = kgToDisplayNumber(kg, displayUnit);
  if (displayUnit === "lb") {
    return Number.isFinite(v) ? String(Math.round(v)) : "";
  }
  const rounded = Math.round(v * 20) / 20;
  if (Number.isInteger(rounded)) return String(rounded);
  if (Number.isInteger(rounded * 2)) return String(rounded);
  return stripTrailingZeros(rounded.toFixed(2));
}

export function parseWeightFieldInputToKg(
  raw: string,
  displayUnit: WeightUnitPreference,
): number | null | "invalid" {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "invalid";
  return displayNumberToKg(n, displayUnit);
}
