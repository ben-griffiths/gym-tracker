import { getExerciseByName } from "@/lib/exercises";

export type HistorySet = {
  id: string;
  exercise?: string;
  reps: number | null;
  weight: number | string | null;
  weightUnit?: string;
  setNumber?: number;
  rpe?: number | string | null;
  rir?: number | null;
  feel?: string | null;
  loggedAt?: string;
};

export type HistorySession = {
  id: string;
  name: string;
  startedAt?: string;
  /** Serialized workout chat for `/workout?edit=` rehydration; absent on older rows. */
  chatTranscript?: unknown | null;
  sets?: HistorySet[];
  exercises?: Array<{
    orderIndex?: number;
    exercise?: { name: string } | null;
    customExerciseName?: string | null;
    sets: HistorySet[];
  }>;
};

export type HistoryGroup = {
  id: string;
  name: string;
  sessions: HistorySession[];
};

export type HistoryResponse = {
  groups: HistoryGroup[];
  storageMode?: "database";
};

export type FlattenedSet = HistorySet & { exerciseName: string };

export type ExerciseGroupSummary = {
  exerciseName: string;
  sets: FlattenedSet[];
  summary: string;
};

export function formatDate(iso?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatWorkoutTitle(iso?: string, fallback = "Workout"): string {
  if (!iso) return fallback;
  try {
    const date = new Date(iso);
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
    const day = new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
    return `${time} · ${day}`;
  } catch {
    return fallback;
  }
}

export function flattenSets(session: HistorySession): FlattenedSet[] {
  if (session.sets && session.sets.length > 0) {
    return session.sets.map((entry) => ({
      ...entry,
      exerciseName: entry.exercise ?? "Exercise",
    }));
  }

  if (session.exercises && session.exercises.length > 0) {
    return session.exercises.flatMap((exerciseGroup) =>
      exerciseGroup.sets.map((entry) => ({
        ...entry,
        exerciseName:
          exerciseGroup.exercise?.name ??
          exerciseGroup.customExerciseName ??
          "Exercise",
      })),
    );
  }

  return [];
}

export function groupByExercise(
  sets: FlattenedSet[],
): ExerciseGroupSummary[] {
  const order: string[] = [];
  const byName = new Map<string, FlattenedSet[]>();
  for (const set of sets) {
    if (!byName.has(set.exerciseName)) {
      order.push(set.exerciseName);
      byName.set(set.exerciseName, []);
    }
    byName.get(set.exerciseName)!.push(set);
  }

  return order.map((name) => {
    const group = byName.get(name)!;
    return {
      exerciseName: name,
      sets: group,
      summary: summarizeSets(group),
    };
  });
}

/**
 * Build exercise groups in `session_exercises` order, including catalog exercises
 * with **no sets** (so they still appear on `/workout?edit=`). Falls back to
 * set-only order when the API did not return `exercises` (e.g. legacy clients).
 */
export function rehydrationExerciseGroupsInOrder(
  session: HistorySession,
): ExerciseGroupSummary[] {
  const fromSetsOnly = groupByExercise(flattenSets(session));
  const setByName = new Map(
    fromSetsOnly.map((g) => [g.exerciseName, g.sets] as const),
  );

  if (!session.exercises?.length) {
    return fromSetsOnly;
  }

  const ordered = [...session.exercises].sort(
    (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
  );
  const result: ExerciseGroupSummary[] = [];
  const seenSlugs = new Set<string>();

  for (const se of ordered) {
    const name =
      se.exercise?.name?.trim() ||
      se.customExerciseName?.trim() ||
      "Exercise";
    const record = getExerciseByName(name);
    if (!record) continue;
    if (seenSlugs.has(record.slug)) continue;
    seenSlugs.add(record.slug);
    const sets = setByName.get(name) ?? [];
    result.push({
      exerciseName: name,
      sets,
      summary: summarizeSets(sets),
    });
  }

  return result;
}

export function computeVolume(sets: HistorySet[]): {
  volume: number;
  unit: string;
} {
  let total = 0;
  let unit = "kg";
  for (const set of sets) {
    const reps = set.reps ?? 0;
    const weight =
      set.weight === null || set.weight === undefined
        ? 0
        : Number(set.weight);
    if (set.weightUnit) unit = set.weightUnit;
    total += reps * weight;
  }
  return { volume: Math.round(total), unit };
}

// Beyond this many varied sets, the per-set list gets long and wraps in the
// history card. Collapse to a compact min-max range instead.
const RANGE_THRESHOLD = 3;

function formatRange(
  values: Array<number | null | undefined>,
): { min: number; max: number } | null {
  const nums = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (nums.length === 0) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function formatRangeLabel(
  range: { min: number; max: number } | null,
  suffix: string,
): string | null {
  if (!range) return null;
  if (range.min === range.max) return `${range.min}${suffix}`;
  return `${range.min}–${range.max}${suffix}`;
}

export function summarizeSets(sets: HistorySet[]): string {
  if (sets.length === 0) return "";

  const unit = sets.find((set) => set.weightUnit)?.weightUnit ?? "kg";
  const repsValues = sets.map((set) => set.reps);
  const weightValues = sets.map((set) =>
    set.weight === null || set.weight === undefined
      ? null
      : Number(set.weight),
  );

  const allRepsEqual = repsValues.every((value) => value === repsValues[0]);
  const allWeightEqual = weightValues.every(
    (value) => value === weightValues[0],
  );

  if (allRepsEqual && allWeightEqual) {
    const reps = repsValues[0];
    const weight = weightValues[0];
    if (reps !== null && reps !== undefined && weight !== null) {
      return `${sets.length} × ${reps} × ${weight}${unit}`;
    }
    if (reps !== null && reps !== undefined) {
      return `${sets.length} × ${reps} reps`;
    }
    if (weight !== null) {
      return `${sets.length} × ${weight}${unit}`;
    }
    return `${sets.length} sets`;
  }

  if (sets.length > RANGE_THRESHOLD) {
    const repsRange = formatRangeLabel(formatRange(repsValues), " reps");
    const weightRange = formatRangeLabel(formatRange(weightValues), unit);
    const parts = [`${sets.length} sets`];
    if (repsRange) parts.push(repsRange);
    if (weightRange) parts.push(weightRange);
    return parts.join(" · ");
  }

  return sets
    .map((set) => {
      const reps = set.reps ?? "-";
      const weight =
        set.weight === null || set.weight === undefined ? "-" : set.weight;
      return `${reps}×${weight}${set.weightUnit ?? unit}`;
    })
    .join(", ");
}
