/**
 * Client-safe row projectors. Mirror the camelCase shapes that
 * `lib/services/workout-service.ts` returns to the legacy GET endpoints,
 * so the Dexie-backed live query produces a payload that's identical to
 * what the UI used to consume from `fetch("/api/workouts")`.
 */

import type {
  ExerciseRow,
  SessionExerciseRow,
  SetEntryRow,
  WorkoutGroupRow,
  WorkoutSessionRow,
} from "@/lib/sync/types";

function asNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function projectGroup(row: WorkoutGroupRow) {
  return {
    id: row.id,
    userId: row.user_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function projectSession(row: WorkoutSessionRow) {
  return {
    id: row.id,
    userId: row.user_id,
    workoutGroupId: row.workout_group_id,
    name: row.name,
    notes: row.notes,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    chatTranscript: row.chat_transcript ?? null,
  };
}

export function projectExercise(row: ExerciseRow) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    aliases: row.aliases ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function projectSessionExercise(row: SessionExerciseRow) {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    exerciseId: row.exercise_id,
    customExerciseName: row.custom_exercise_name,
    orderIndex: row.order_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function projectSetEntry(row: SetEntryRow) {
  return {
    id: row.id,
    userId: row.user_id,
    sessionExerciseId: row.session_exercise_id,
    setNumber: row.set_number,
    reps: row.reps,
    weight: asNumber(row.weight as unknown as number | string | null),
    weightUnit: row.weight_unit,
    rir: row.rir,
    rpe: asNumber(row.rpe as unknown as number | string | null),
    feel: row.feel,
    isWarmup: row.is_warmup,
    notes: row.notes,
    loggedAt: row.logged_at,
    source: row.source,
  };
}
