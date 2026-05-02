import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiftLogLocalDB, nowIso } from "@/lib/sync/db";
import { selectHistoryGroups } from "@/lib/sync/workouts-live";
import type {
  ExerciseRow,
  SessionExerciseRow,
  SetEntryRow,
  WorkoutGroupRow,
  WorkoutSessionRow,
} from "@/lib/sync/types";

const USER = "11111111-1111-1111-1111-111111111111";

const meta = (over: Partial<{ dirty: 0 | 1; deleted: string | null }> = {}) => ({
  server_updated_at: nowIso(),
  local_updated_at: nowIso(),
  dirty: (over.dirty ?? 0) as 0 | 1,
  deleted_at: over.deleted ?? null,
  client_updated_at: nowIso(),
});

const group = (id: string, over: Partial<WorkoutGroupRow> = {}): WorkoutGroupRow => ({
  ...meta(),
  id,
  user_id: USER,
  slug: id,
  name: id,
  description: null,
  created_at: nowIso(),
  updated_at: nowIso(),
  ...over,
});

const session = (
  id: string,
  groupId: string,
  over: Partial<WorkoutSessionRow> = {},
): WorkoutSessionRow => ({
  ...meta(),
  id,
  user_id: USER,
  workout_group_id: groupId,
  name: id,
  notes: null,
  started_at: nowIso(),
  ended_at: null,
  status: "ACTIVE",
  chat_transcript: null,
  created_at: nowIso(),
  updated_at: nowIso(),
  ...over,
});

const sessionExercise = (
  id: string,
  sessionId: string,
  exerciseId: string | null,
  orderIndex = 0,
  over: Partial<SessionExerciseRow> = {},
): SessionExerciseRow => ({
  ...meta(),
  id,
  user_id: USER,
  session_id: sessionId,
  exercise_id: exerciseId,
  custom_exercise_name: null,
  order_index: orderIndex,
  created_at: nowIso(),
  updated_at: nowIso(),
  ...over,
});

const exercise = (id: string, name: string, over: Partial<ExerciseRow> = {}): ExerciseRow => ({
  ...meta(),
  id,
  user_id: USER,
  name,
  aliases: [],
  created_at: nowIso(),
  updated_at: nowIso(),
  ...over,
});

const setEntry = (
  id: string,
  seId: string,
  setNumber: number,
  over: Partial<SetEntryRow> = {},
): SetEntryRow => ({
  ...meta(),
  id,
  user_id: USER,
  session_exercise_id: seId,
  set_number: setNumber,
  reps: 5,
  weight: 100,
  weight_unit: "kg",
  rpe: null,
  rir: null,
  feel: null,
  is_warmup: false,
  notes: null,
  logged_at: nowIso(),
  source: "manual",
  created_at: nowIso(),
  updated_at: nowIso(),
  ...over,
});

let db: LiftLogLocalDB;

beforeEach(() => {
  db = new LiftLogLocalDB(`liftlog-test-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await db.delete();
});

describe("selectHistoryGroups", () => {
  it("returns an empty list when there are no groups", async () => {
    const result = await selectHistoryGroups(db, USER);
    expect(result).toEqual([]);
  });

  it("excludes soft-deleted groups, sessions, and sets", async () => {
    await db.workout_groups.bulkPut([group("a"), group("b", { deleted_at: nowIso() })]);
    await db.workout_sessions.bulkPut([
      session("s1", "a"),
      session("s2", "a", { deleted_at: nowIso() }),
    ]);
    await db.session_exercises.bulkPut([sessionExercise("se1", "s1", "e1", 0)]);
    await db.exercises.put(exercise("e1", "Bench"));
    await db.set_entries.bulkPut([
      setEntry("set1", "se1", 1),
      setEntry("set2", "se1", 2, { deleted_at: nowIso() }),
    ]);

    const result = await selectHistoryGroups(db, USER);
    expect(result.map((g) => g.id)).toEqual(["a"]);
    const sessions = result[0]?.sessions ?? [];
    expect(sessions.map((s) => s.id)).toEqual(["s1"]);
    const exerciseBlocks = (sessions[0]?.exercises ?? []) as Array<{
      sets: Array<{ id: string }>;
    }>;
    expect(exerciseBlocks[0]?.sets.map((s) => s.id)).toEqual(["set1"]);
  });

  it("orders sessions by started_at desc and sets by set_number asc", async () => {
    await db.workout_groups.put(group("g"));
    await db.workout_sessions.bulkPut([
      session("old", "g", { started_at: "2026-01-01T00:00:00.000Z" }),
      session("new", "g", { started_at: "2026-05-01T00:00:00.000Z" }),
    ]);
    await db.session_exercises.bulkPut([sessionExercise("se", "new", "e", 0)]);
    await db.exercises.put(exercise("e", "Squat"));
    await db.set_entries.bulkPut([
      setEntry("s3", "se", 3),
      setEntry("s1", "se", 1),
      setEntry("s2", "se", 2),
    ]);

    const [gOut] = await selectHistoryGroups(db, USER);
    expect(gOut.sessions.map((s) => s.id)).toEqual(["new", "old"]);
    const blocks = gOut.sessions[0].exercises as Array<{ sets: Array<{ setNumber: number }> }>;
    expect(blocks[0].sets.map((s) => s.setNumber)).toEqual([1, 2, 3]);
  });

  it("caps the result at 8 most-recently-updated groups", async () => {
    const groups = Array.from({ length: 12 }, (_, i) =>
      group(`g${i}`, { updated_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }),
    );
    await db.workout_groups.bulkPut(groups);
    const result = await selectHistoryGroups(db, USER);
    expect(result.length).toBe(8);
    expect(result[0].id).toBe("g11");
  });

  it("resolves exercise references and tolerates missing/deleted ones", async () => {
    await db.workout_groups.put(group("g"));
    await db.workout_sessions.put(session("s", "g"));
    await db.session_exercises.bulkPut([
      sessionExercise("se1", "s", "e1", 0),
      sessionExercise("se2", "s", null, 1),
    ]);
    await db.exercises.put(exercise("e1", "Deadlift"));

    const [gOut] = await selectHistoryGroups(db, USER);
    const blocks = gOut.sessions[0].exercises as Array<{
      exercise: { name: string } | null;
    }>;
    expect(blocks[0].exercise?.name).toBe("Deadlift");
    expect(blocks[1].exercise).toBeNull();
  });
});
