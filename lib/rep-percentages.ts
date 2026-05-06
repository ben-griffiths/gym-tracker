import repPercentagesJson from "../public/exercises/rep-percentages.json";

/**
 * Scraped rep → percentage-of-1RM lookup table from
 * https://strengthlevel.com/one-rep-max-calculator
 *
 * Run `node scripts/scrape-rep-percentages.mjs` to refresh the underlying JSON.
 */
const RAW_PERCENTAGES: Record<string, number> = repPercentagesJson.percentages;

const SORTED_REPS: number[] = Object.keys(RAW_PERCENTAGES)
  .map((key) => Number.parseInt(key, 10))
  .filter((value) => Number.isFinite(value))
  .sort((a, b) => a - b);

const MIN_REPS = SORTED_REPS[0] ?? 1;
const MAX_REPS = SORTED_REPS[SORTED_REPS.length - 1] ?? 1;

export const REP_PERCENTAGE_SOURCE: string = repPercentagesJson.source;

export type PrefillSetInput = {
  reps: number | null;
  weight: number | null;
  weightUnit: "kg" | "lb";
};

export type WeightSequenceInput = {
  reps: number | null;
};

/**
 * Gym-coach style warmup reps **before** fixed working reps (NxM): lighter early
 * warmups use **more** reps; the last warmup uses **fewer** reps so you don't grind
 * before working sets (similar to common ChatGPT-style prescriptions).
 */
export function suggestWarmupRepsBeforeWorking(
  workingReps: number,
  warmupCount: number,
): number[] {
  const w = Math.max(1, Math.min(30, Math.round(workingReps)));
  if (warmupCount <= 0) return [];

  const approachReps = Math.max(
    2,
    Math.min(Math.max(2, w - 1), Math.round(w * 0.78)),
  );
  const highReps = Math.min(
    15,
    Math.max(w + 3, Math.round(w * 1.55)),
  );

  if (warmupCount === 1) {
    const mid = Math.round((highReps + approachReps) / 2);
    return [Math.max(2, Math.min(30, mid))];
  }

  const out: number[] = [];
  for (let i = 0; i < warmupCount; i += 1) {
    const t = i / (warmupCount - 1);
    const r = Math.round(highReps + (approachReps - highReps) * t);
    out.push(Math.max(2, Math.min(30, r)));
  }
  return out;
}

/**
 * Percentage of 1RM a lifter is expected to produce for the given rep count.
 * Clamps to the bounds of the scraped table (1..30 reps); repetitions outside
 * that range return the nearest boundary percentage rather than extrapolating.
 */
export function percentageOfOneRm(reps: number): number {
  if (!Number.isFinite(reps)) return 1;
  const clamped = Math.max(MIN_REPS, Math.min(MAX_REPS, Math.round(reps)));
  const pct = RAW_PERCENTAGES[String(clamped)];
  return typeof pct === "number" && pct > 0 ? pct : 1;
}

/**
 * Estimate the 1RM implied by a single set.
 *
 * Divides the lifted weight by the scraped rep percentage rather than using
 * Epley (or similar) closed-form estimators, so the numbers match StrengthLevel's
 * official calculator.
 */
export function estimateOneRm(weight: number, reps: number): number {
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  const effectiveReps = Number.isFinite(reps) && reps > 0 ? reps : 1;
  const pct = percentageOfOneRm(effectiveReps);
  if (pct <= 0) return weight;
  return weight / pct;
}

/**
 * Recommend a working weight for a given rep target at a target RPE —
 * exactly the math that powers the "RPE-8" suggestion chips:
 * weight = oneRm × percentageOfOneRm(reps + (10 - targetRpe)).
 *
 * The reserve term ensures the suggestion leaves enough gas in the tank
 * to hit the requested RPE (RPE 8 = 2 RIR ⇒ pick the weight you could
 * grind out for `reps + 2` to failure).
 *
 * Returns null when the inputs aren't valid so callers can decide how
 * to handle ambiguity.
 */
export function weightAtRpe(
  reps: number,
  oneRmKg: number,
  targetRpe = 8,
): number | null {
  if (!Number.isFinite(reps) || reps < 1) return null;
  if (!Number.isFinite(oneRmKg) || oneRmKg <= 0) return null;
  if (!Number.isFinite(targetRpe) || targetRpe < 1 || targetRpe > 10) {
    return null;
  }
  const reserve = 10 - targetRpe;
  const failurePoint = Math.max(1, Math.round(reps + reserve));
  const pct = percentageOfOneRm(failurePoint);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return oneRmKg * pct;
}

/**
 * Suggest a full weight sequence for a block of sets.
 *
 * Default behavior: each set gets its own RPE-based target from its rep count.
 * Warmup-aware behavior: when `warmupSets > 0`, the first N rows get loads that
 * ramp from a floor (~`warmupStartPct * 1RM`) toward (but below) the **working-set**
 * target, using fractions of that working weight so loads stay sensible even when
 * warmup reps are higher than working reps. Working rows keep `weightAtRpe` targets.
 */
export function suggestWeightsForSetSequence(
  sets: WeightSequenceInput[],
  oneRmKg: number,
  options?: {
    targetRpe?: number;
    defaultReps?: number;
    warmupSets?: number;
    warmupStartPct?: number;
  },
): Array<number | null> {
  if (!Number.isFinite(oneRmKg) || oneRmKg <= 0 || sets.length === 0) {
    return sets.map(() => null);
  }

  const targetRpe = options?.targetRpe ?? 8;
  const defaultReps = Math.max(1, Math.round(options?.defaultReps ?? 5));
  const warmupSetsRaw = Math.max(0, Math.floor(options?.warmupSets ?? 0));
  const warmupSets = Math.min(warmupSetsRaw, sets.length - 1);
  const warmupStartPct = Math.max(
    0.3,
    Math.min(0.85, options?.warmupStartPct ?? 0.3),
  );

  const baseTargets = sets.map((set) => {
    const reps =
      typeof set.reps === "number" && Number.isFinite(set.reps) && set.reps > 0
        ? Math.round(set.reps)
        : defaultReps;
    return weightAtRpe(reps, oneRmKg, targetRpe);
  });

  if (warmupSets <= 0) return baseTargets;

  const workingTarget =
    baseTargets[warmupSets] ??
    baseTargets.find((value): value is number => value !== null) ??
    oneRmKg * 0.75;

  const warmupStartFloor = oneRmKg * warmupStartPct;
  const next = [...baseTargets];

  // Ramp loads as fractions of the **working** target so warmups stay light even
  // when row reps are higher than working reps (pure weightAtRpe on high reps would
  // overshoot). Early slots → lower fraction; last warmup → approaches working.
  const fracLo = Math.max(
    0.42,
    Math.min(0.62, warmupStartFloor / workingTarget),
  );
  const fracHi = 0.88;

  let prevKg = warmupStartFloor * 0.9;
  const minStepKg = Math.max(2.5, oneRmKg * 0.012);

  for (let i = 0; i < warmupSets; i += 1) {
    const t = warmupSets === 1 ? 1 : i / (warmupSets - 1);
    let kg = workingTarget * (fracLo + (fracHi - fracLo) * t);
    kg = Math.max(kg, warmupStartFloor, prevKg + minStepKg);
    kg = Math.min(kg, workingTarget * 0.93);
    prevKg = kg;
    next[i] = kg;
  }

  return next;
}

/**
 * Fill missing reps/weight fields from an estimated 1RM using the same
 * table-based logic as suggestion chips:
 * - missing reps + known weight -> repsAtRpe(weight, 1RM, targetRpe)
 * - missing weight + known reps -> weightAtRpe(reps, 1RM, targetRpe)
 * - missing both -> defaultReps + weightAtRpe(defaultReps, 1RM, targetRpe)
 *
 * Existing explicit values are preserved.
 */
export function prefillSetsFromEstimatedOneRm<T extends PrefillSetInput>(
  sets: T[],
  oneRmKg: number,
  options?: {
    targetRpe?: number;
    defaultReps?: number;
    incrementKg?: number;
    incrementLb?: number;
  },
): T[] {
  if (!Number.isFinite(oneRmKg) || oneRmKg <= 0 || sets.length === 0) {
    return sets;
  }

  const targetRpe = options?.targetRpe ?? 8;
  const defaultReps = Math.max(1, Math.round(options?.defaultReps ?? 5));
  const incrementKg = options?.incrementKg ?? 5;
  const incrementLb = options?.incrementLb ?? 5;
  const kgPerLb = 0.45359237;

  const toKg = (weight: number, unit: "kg" | "lb") =>
    unit === "lb" ? weight * kgPerLb : weight;

  return sets.map((set) => {
    const hasReps =
      typeof set.reps === "number" && Number.isFinite(set.reps) && set.reps > 0;
    const hasWeight =
      typeof set.weight === "number" &&
      Number.isFinite(set.weight) &&
      set.weight > 0;

    let nextReps = hasReps ? Math.round(set.reps as number) : null;
    let nextWeight = hasWeight ? (set.weight as number) : null;

    if (!hasReps && hasWeight) {
      const inferred = repsAtRpe(toKg(set.weight as number, set.weightUnit), oneRmKg, targetRpe);
      nextReps = inferred ?? defaultReps;
    }

    if (nextReps === null) {
      nextReps = defaultReps;
    }

    if (!hasWeight && nextReps !== null) {
      const recommendedKg = weightAtRpe(nextReps, oneRmKg, targetRpe);
      if (recommendedKg !== null && recommendedKg > 0) {
        const inUnit =
          set.weightUnit === "lb" ? recommendedKg / kgPerLb : recommendedKg;
        const increment = set.weightUnit === "lb" ? incrementLb : incrementKg;
        const rounded = Math.round(inUnit / increment) * increment;
        if (rounded > 0) nextWeight = rounded;
      }
    }

    return {
      ...set,
      reps: nextReps,
      weight: nextWeight,
    } as T;
  });
}

/**
 * Recommend a rep target for a given weight at a target RPE — i.e. the same
 * algorithm that powers the "RPE-8" suggestion chips, but inverted: instead
 * of asking "what weight should I use for N reps at RPE 8?", we ask
 * "given THIS weight, how many reps should I aim for at RPE X?".
 *
 * Strategy:
 *  1. Compute weight / oneRm to get the percentage of 1RM the lift represents.
 *  2. Find the rep count R whose scraped percentage best matches that ratio
 *     (so a lifter could grind out R reps to failure on this weight).
 *  3. Subtract (10 - targetRpe) reps in reserve so we leave the right
 *     amount of gas in the tank. RPE 10 = to failure, RPE 8 = 2 RIR, etc.
 *  4. Clamp to [1, 30] so we always return a usable rep target.
 *
 * Returns null when the inputs aren't valid (non-positive weight or
 * unknown 1RM) so callers can decide how to handle ambiguity.
 */
export function repsAtRpe(
  weightKg: number,
  oneRmKg: number,
  targetRpe = 8,
): number | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isFinite(oneRmKg) || oneRmKg <= 0) return null;
  if (!Number.isFinite(targetRpe) || targetRpe < 1 || targetRpe > 10) {
    return null;
  }

  const ratio = weightKg / oneRmKg;
  // Weight is at/above 1RM — only one rep is realistic regardless of RPE.
  if (ratio >= percentageOfOneRm(1)) return 1;

  // Find the largest rep count R such that percentageOfOneRm(R) >= ratio
  // — i.e. the most reps a lifter could still grind out at this weight.
  // We walk from heaviest (1 rep) to lightest and stop as soon as the
  // table dips below the supplied ratio.
  let failureReps = MIN_REPS;
  for (const reps of SORTED_REPS) {
    const pct = percentageOfOneRm(reps);
    if (pct >= ratio) {
      failureReps = reps;
    } else {
      break;
    }
  }

  const reserve = 10 - targetRpe;
  const target = failureReps - reserve;
  if (target < 1) return 1;
  if (target > MAX_REPS) return MAX_REPS;
  return target;
}

/**
 * Rep targets for a load ladder when the **heaviest loaded set** defines capacity:
 * infer 1RM from that set using the **same failure-point percentage as `weightAtRpe`**
 * (`percentageOfOneRm(anchorReps + (10 − targetRpe))`), not `estimateOneRm`, so the
 * anchor row lands exactly at `anchorReps` when inverted with `repsAtRpe`. Each loaded
 * row then gets `repsAtRpe(load, oneRm, targetRpe)` (Strength Level table + RIR).
 * Rows with no added load (bodyweight-only) get more reps than the lightest loaded step.
 */
export function suggestRepsAnchoredLoadLadderAtRpe(
  rowLoadsKgAdded: Array<number | null>,
  options: {
    anchorIndex?: number;
    anchorReps: number;
    targetRpe?: number;
  },
): number[] {
  const targetRpe = options.targetRpe ?? 8;
  const n = rowLoadsKgAdded.length;

  let anchorIdx = options.anchorIndex ?? n - 1;
  while (
    anchorIdx >= 0 &&
    (rowLoadsKgAdded[anchorIdx] === null ||
      !Number.isFinite(rowLoadsKgAdded[anchorIdx] as number) ||
      (rowLoadsKgAdded[anchorIdx] as number) <= 0)
  ) {
    anchorIdx -= 1;
  }
  if (anchorIdx < 0) {
    const fallback = Math.max(1, Math.round(options.anchorReps));
    return Array.from({ length: n }, () => Math.min(MAX_REPS, fallback));
  }

  const anchorKg = rowLoadsKgAdded[anchorIdx] as number;
  const anchorReps = Math.max(1, Math.round(options.anchorReps));
  // Match `weightAtRpe` / chip semantics: working reps at RPE X imply failure at
  // reps + (10 − targetRpe). Using `estimateOneRm(weight, reps)` instead skews the
  // inferred 1RM and collapses heavier ladder rows toward single reps.
  const reserve = 10 - targetRpe;
  const failurePoint = Math.max(1, Math.round(anchorReps + reserve));
  const pctAtFailure = percentageOfOneRm(failurePoint);
  const oneRmKg =
    pctAtFailure > 0 ? anchorKg / pctAtFailure : estimateOneRm(anchorKg, anchorReps);
  if (!Number.isFinite(oneRmKg) || oneRmKg <= 0) {
    return Array.from({ length: n }, () => Math.min(MAX_REPS, anchorReps));
  }

  const perLoadedRep: Array<number | null> = rowLoadsKgAdded.map((loadKg) => {
    if (loadKg === null || !Number.isFinite(loadKg) || loadKg <= 0) {
      return null;
    }
    const r = repsAtRpe(loadKg, oneRmKg, targetRpe);
    if (r === null) return anchorReps;
    return Math.min(MAX_REPS, Math.max(1, r));
  });

  let firstLoadedReps = anchorReps;
  for (let i = 0; i < n; i += 1) {
    const r = perLoadedRep[i];
    if (r !== null) {
      firstLoadedReps = r;
      break;
    }
  }

  return rowLoadsKgAdded.map((loadKg, i) => {
    const loadedRep = perLoadedRep[i];
    if (loadedRep !== null) return loadedRep;
    const bumped = Math.ceil(firstLoadedReps * 1.2) + 2;
    return Math.min(
      MAX_REPS,
      Math.max(firstLoadedReps + 1, bumped),
    );
  });
}
