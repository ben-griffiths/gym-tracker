import {
  EXERCISES,
  type ExerciseRecord,
  getExerciseByName,
  searchExercises,
} from "@/lib/exercises";
import { toKg } from "@/lib/lift-profiles";
import { estimateOneRm } from "@/lib/rep-percentages";
import { flattenSets, type HistorySession } from "@/lib/workout-history";

export type EstimateSource = {
  reps: number;
  weightKg: number;
};

/** Where the Est 1RM number comes from; `null` when the column is empty or shows BW reps only. */
export type RepMaxEstimateKind = "logged" | "catalog";

export type RepMaxRow = {
  slug: string;
  exerciseName: string;
  iconPath: string | null;
  maxes: Record<number, number>;
  bestWeight: number;
  estimatedOneRm: number | null;
  estimateSource: EstimateSource | null;
  estimateKind: RepMaxEstimateKind | null;
  /**
   * Highest rep count achieved for this exercise with zero external load.
   */
  bestBodyweightReps: number | null;
};

type Agg = {
  exerciseName: string;
  iconPath: string | null;
  maxes: Map<number, number>;
  estimatedOneRm: number;
  estimateSource: EstimateSource | null;
  bestBodyweightReps: number;
};

/**
 * “Average” strength for rep-maxes inference = **intermediate** tier from the
 * StrengthLevel-derived catalog (`ExerciseRecord.standards`).
 *
 * **Gender:** the app does not collect sex for this screen. When both `male`
 * and `female` intermediate 1RM values exist, use their **arithmetic mean**
 * (neutral). If only one side is present, use that value. Values are converted
 * to **kg** using {@link toKg} when `standards.unit` is `lb`.
 *
 * Returns `null` when standards are missing or neither side defines
 * intermediate — typical for bodyweight-only entries with no load numbers.
 */
export function catalogIntermediateOneRmKg(
  exercise: ExerciseRecord,
): number | null {
  const std = exercise.standards;
  if (!std) return null;
  const m = std.male?.intermediate;
  const f = std.female?.intermediate;
  const unit = std.unit === "lb" ? "lb" : "kg";
  let valueInStdUnit: number | null = null;
  if (m != null && f != null) valueInStdUnit = (m + f) / 2;
  else if (m != null) valueInStdUnit = m;
  else if (f != null) valueInStdUnit = f;
  else return null;
  return toKg(valueInStdUnit, unit);
}

function entryToRow(slug: string, entry: Agg): RepMaxRow {
  const maxesObject: Record<number, number> = {};
  let bestWeight = 0;
  for (const [reps, weight] of entry.maxes.entries()) {
    maxesObject[reps] = weight;
    if (weight > bestWeight) bestWeight = weight;
  }
  return {
    slug,
    exerciseName: entry.exerciseName,
    iconPath: entry.iconPath,
    maxes: maxesObject,
    bestWeight,
    estimatedOneRm: entry.estimatedOneRm > 0 ? entry.estimatedOneRm : null,
    estimateSource: entry.estimateSource,
    estimateKind: entry.estimatedOneRm > 0 ? "logged" : null,
    bestBodyweightReps:
      entry.bestBodyweightReps > 0 ? entry.bestBodyweightReps : null,
  };
}

/** Sort key matches table “Est 1RM”: higher estimated 1RM (kg) first; tie-break BW reps, then name. */
export function compareRowsWithLoggedDataDesc(a: RepMaxRow, b: RepMaxRow) {
  const aEst = a.estimatedOneRm ?? 0;
  const bEst = b.estimatedOneRm ?? 0;
  if (bEst !== aEst) return bEst - aEst;
  const aReps = a.bestBodyweightReps ?? 0;
  const bReps = b.bestBodyweightReps ?? 0;
  if (bReps !== aReps) return bReps - aReps;
  return a.exerciseName.localeCompare(b.exerciseName, undefined, {
    sensitivity: "base",
  });
}

function compareCatalogNameAsc(a: RepMaxRow, b: RepMaxRow) {
  return a.exerciseName.localeCompare(b.exerciseName, undefined, {
    sensitivity: "base",
  });
}

/**
 * Single ordered list for the rep-maxes table: rows **with** workout history
 * first (descending by the same comparator as before — estimated 1RM in kg,
 * then bodyweight reps, then name), then **catalog** exercises with no logs
 * (A–Z). Unlogged catalog rows get Est 1RM from {@link catalogIntermediateOneRmKg}
 * when standards exist.
 */
export function buildRepMaxRows(sessions: HistorySession[]): RepMaxRow[] {
  const byExercise = new Map<string, Agg>();

  for (const session of sessions) {
    for (const set of flattenSets(session)) {
      const numericWeight = Number(set.weight);
      if (!Number.isFinite(numericWeight) || numericWeight < 0) continue;
      const reps = typeof set.reps === "number" ? set.reps : null;
      if (reps === null || reps < 1) continue;

      const matched =
        getExerciseByName(set.exerciseName) ??
        searchExercises(set.exerciseName, 1)[0];
      const slug = matched?.slug ?? `custom:${set.exerciseName}`;
      const name = matched?.name ?? set.exerciseName;
      const iconPath = matched?.iconPath ?? null;

      const weightKg = toKg(numericWeight, set.weightUnit);

      let entry = byExercise.get(slug);
      if (!entry) {
        entry = {
          exerciseName: name,
          iconPath,
          maxes: new Map(),
          estimatedOneRm: 0,
          estimateSource: null,
          bestBodyweightReps: 0,
        };
        byExercise.set(slug, entry);
      }

      if (reps <= 10) {
        const existing = entry.maxes.get(reps);
        if (existing === undefined || weightKg > existing) {
          entry.maxes.set(reps, weightKg);
        }
      }

      if (weightKg > 0) {
        const oneRm = estimateOneRm(weightKg, reps);
        if (oneRm > entry.estimatedOneRm) {
          entry.estimatedOneRm = oneRm;
          entry.estimateSource = { reps, weightKg };
        }
      } else if (reps > entry.bestBodyweightReps) {
        entry.bestBodyweightReps = reps;
      }
    }
  }

  const loggedRows: RepMaxRow[] = [];
  for (const [slug, entry] of byExercise.entries()) {
    loggedRows.push(entryToRow(slug, entry));
  }
  loggedRows.sort(compareRowsWithLoggedDataDesc);

  const catalogOnly: RepMaxRow[] = [];
  for (const ex of EXERCISES) {
    if (byExercise.has(ex.slug)) continue;
    const inferredKg = catalogIntermediateOneRmKg(ex);
    catalogOnly.push({
      slug: ex.slug,
      exerciseName: ex.name,
      iconPath: ex.iconPath,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: inferredKg,
      estimateSource: null,
      estimateKind: inferredKg !== null ? "catalog" : null,
      bestBodyweightReps: null,
    });
  }
  catalogOnly.sort(compareCatalogNameAsc);

  return [...loggedRows, ...catalogOnly];
}
