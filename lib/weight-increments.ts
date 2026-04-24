import { percentageOfOneRm } from "./rep-percentages";

const KG_PER_LB = 0.45359237;

/** RPE-8 rep × weight row targets in the workout UI. */
const RPE_SUGGEST_REPS: readonly number[] = [1, 3, 5, 8, 10];
const RPE_RIR = 2;

/** Below this 1RM (kg), use 10 kg steps; up to 140 kg, 20 kg; then 40 kg when above. */
const TIER_KG_20 = 100;
const TIER_KG_40 = 140;

/**
 * Sub-100 kg band edges: same ratios as the old 50 / 90 / 140 (50 & 90 scaled by 100/140).
 * ~35.7, ~64.3, 100 → use rounded break points for stable labels and comparisons.
 */
const TIER_KG_2_5 = (50 * TIER_KG_20) / 140; // 250/7 ≈ 35.71
const TIER_KG_5 = (90 * TIER_KG_20) / 140; // 450/7 ≈ 64.29

/**
 * Bar jump in **lb** that matches each kg step (gym-style plates, ~2.2 lb/kg).
 */
function kgStepToLbDisplayStep(stepKg: number): number {
  if (stepKg <= 2.5) return 5;
  if (stepKg <= 5) return 10;
  if (stepKg <= 10) return 25;
  if (stepKg <= 20) return 45;
  return 90; // 40 kg ≈ 88 lb, two 45s
}

/**
 * Suggested load step in the same unit as the reference (1RM in kg or lb).
 * Tier logic is **only in kg**: convert 1RM to kg, pick 2.5 / 5 / 10 for
 * 0…100 (scaled bands), 20 kg for 100…140, 40 kg for &gt; 140, then if lb map to plates.
 */
export function weightLoadIncrement(
  referenceLoadInUnit: number,
  unit: "kg" | "lb",
): number {
  const w = referenceLoadInUnit;
  if (!Number.isFinite(w) || w < 0) {
    return unit === "kg" ? 2.5 : 5;
  }
  const wKg = unit === "kg" ? w : w * KG_PER_LB;
  const stepKg =
    wKg < TIER_KG_2_5
      ? 2.5
      : wKg < TIER_KG_5
        ? 5
        : wKg < TIER_KG_20
          ? 10
          : wKg <= TIER_KG_40
            ? 20
            : 40;
  if (unit === "kg") return stepKg;
  return kgStepToLbDisplayStep(stepKg);
}

/**
 * 50% of a nominal bar step, snapped to the nearest practical plate in that unit
 * (not a raw /2, so 45 lb → 20, not 22.5).
 */
export function halveLoadIncrement(inc: number, unit: "kg" | "lb"): number {
  if (unit === "kg") {
    if (inc >= 40) return 20;
    if (inc >= 20) return 10;
    if (inc >= 10) return 5;
    if (inc >= 5) return 2.5;
    return 1.25;
  }
  if (inc >= 90) return 45;
  if (inc >= 45) return 20;
  if (inc >= 25) return 10;
  if (inc >= 20) return 10;
  if (inc >= 10) return 5;
  return 2.5;
}

/**
 * Rounding step for RPE chips: if a **full** `fullIncrement` would round a
 * suggested line above estimated 1RM, use half (repeatedly up to 3x) so weights stay plausible.
 */
export function rpeChipsRoundIncrement(
  oneRmInUnit: number,
  unit: "kg" | "lb",
  fullIncrement: number,
): number {
  if (!Number.isFinite(oneRmInUnit) || oneRmInUnit <= 0) {
    return fullIncrement;
  }
  let inc = fullIncrement;
  for (let i = 0; i < 3; i++) {
    if (inc <= 0) break;
    let exceeds = false;
    for (const targetReps of RPE_SUGGEST_REPS) {
      const pct = percentageOfOneRm(targetReps + RPE_RIR);
      const raw = oneRmInUnit * pct;
      const rounded = Math.round(raw / inc) * inc;
      if (rounded > oneRmInUnit + 1e-4) {
        exceeds = true;
        break;
      }
    }
    if (!exceeds) return inc;
    const next = halveLoadIncrement(inc, unit);
    if (next >= inc) break;
    inc = next;
  }
  return inc;
}

/**
 * **Up**-step for quick `+` only: the smaller of (1) RPE-style rounding
 * (`rpeChipsRoundIncrement`) and (2) a half step if a full **+** would exceed
 * 1RM. **Down** (minus) should always use `fullIncrement` from
 * `weightLoadIncrement` so negative jumps are unchanged.
 */
export function quickAddIncrement(
  oneRmInUnit: number | null,
  lastSetWeight: number,
  unit: "kg" | "lb",
  fullIncrement: number,
): number {
  const forRpe = rpeChipsRoundIncrement(
    oneRmInUnit ?? 0,
    unit,
    fullIncrement,
  );
  let forPlus = fullIncrement;
  if (
    oneRmInUnit != null &&
    Number.isFinite(oneRmInUnit) &&
    oneRmInUnit > 0 &&
    lastSetWeight + fullIncrement > oneRmInUnit + 1e-4
  ) {
    forPlus = halveLoadIncrement(fullIncrement, unit);
  }
  if (oneRmInUnit == null) return forRpe;
  return forRpe <= forPlus ? forRpe : forPlus;
}

export function formatLoadIncrement(inc: number): string {
  if (Number.isInteger(inc)) return String(inc);
  if (Number.isInteger(inc * 2)) return (Math.round(inc * 2) / 2).toString();
  return String(inc);
}

/** Convert kg 1RM to the session's display unit (kg or lb). */
export function oneRmKgToDisplayUnit(
  oneRmKg: number,
  displayUnit: "kg" | "lb",
): number {
  if (!Number.isFinite(oneRmKg) || oneRmKg <= 0) {
    return displayUnit === "kg" ? 0 : 0;
  }
  return displayUnit === "lb" ? oneRmKg / KG_PER_LB : oneRmKg;
}
