import { describe, expect, it } from "vitest";
import {
  planDatabaseReconciliation,
  pruneUserMessageSnapshotMap,
  type SnapshotExerciseBlock,
  type WorkoutStateSnapshot,
} from "../lib/workout-snapshot";
import type { BlockSet } from "../components/workout/exercise-block-card";
import { getExerciseBySlug } from "../lib/exercises";

const ex = getExerciseBySlug("bench-press")!;

function block(
  id: string,
  sets: BlockSet[],
  deleted = false,
): SnapshotExerciseBlock {
  return { id, exercise: ex, sets, deleted };
}

describe("planDatabaseReconciliation", () => {
  it("deletes set rows that disappear from the target", () => {
    const s1: BlockSet = {
      id: "l1",
      dbId: "db-old",
      setNumber: 1,
      reps: 5,
      weight: 100,
      weightUnit: "kg",
      source: "chat",
    };
    const from: Record<string, SnapshotExerciseBlock> = {
      b1: block("b1", [s1]),
    };
    const to: Record<string, SnapshotExerciseBlock> = { b1: block("b1", []) };
    const plan = planDatabaseReconciliation(from, to);
    expect(plan.deleteDbIds).toEqual(["db-old"]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
  });

  it("updates when a shared dbId changes fields", () => {
    const sFrom: BlockSet = {
      id: "l1",
      dbId: "db-1",
      setNumber: 1,
      reps: 5,
      weight: 100,
      weightUnit: "kg",
      source: "chat",
    };
    const sTo: BlockSet = {
      ...sFrom,
      weight: 102,
    };
    const from: Record<string, SnapshotExerciseBlock> = {
      b1: block("b1", [sFrom]),
    };
    const to: Record<string, SnapshotExerciseBlock> = {
      b1: block("b1", [sTo]),
    };
    const plan = planDatabaseReconciliation(from, to);
    expect(plan.deleteDbIds).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.dbId).toBe("db-1");
    expect(plan.updates[0]?.patch).toEqual({ weight: 102 });
    expect(plan.creates).toHaveLength(0);
  });

  it("is a no-op when both sides match on persisted fields", () => {
    const s: BlockSet = {
      id: "l1",
      dbId: "db-1",
      setNumber: 1,
      reps: 5,
      weight: 100,
      weightUnit: "kg",
      source: "chat",
      rpe: 8,
    };
    const from: Record<string, SnapshotExerciseBlock> = {
      b1: block("b1", [s]),
    };
    const to: Record<string, SnapshotExerciseBlock> = {
      b1: block("b1", [{ ...s, id: "other-local" }]),
    };
    const plan = planDatabaseReconciliation(from, to);
    expect(plan.deleteDbIds).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
  });

  it("plans create for a set in target with no dbId on a live block", () => {
    const s: BlockSet = {
      id: "l-nodb",
      setNumber: 1,
      reps: 3,
      weight: 60,
      weightUnit: "kg",
      source: "chat",
    };
    const from: Record<string, SnapshotExerciseBlock> = {};
    const to: Record<string, SnapshotExerciseBlock> = { b1: block("b1", [s]) };
    const plan = planDatabaseReconciliation(from, to);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]?.exerciseName).toBe(ex.name);
    expect(plan.creates[0]?.setLocalId).toBe("l-nodb");
  });

  it("prunes user snapshot keys when message ids are gone from the list", () => {
    const snap: WorkoutStateSnapshot = {
      messages: [],
      blocks: {},
      activeBlockId: null,
      collapsedBlockIds: [],
      bufferedSets: [],
    };
    const map = new Map<string, WorkoutStateSnapshot>([
      ["a", snap],
      ["b", snap],
    ]);
    pruneUserMessageSnapshotMap(map, ["a"]);
    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(false);
  });

  it("ignores create rows on soft-deleted blocks in target", () => {
    const s: BlockSet = {
      id: "l-nodb",
      setNumber: 1,
      reps: 3,
      weight: 60,
      weightUnit: "kg",
      source: "chat",
    };
    const to: Record<string, SnapshotExerciseBlock> = {
      b1: block("b1", [s], true),
    };
    const plan = planDatabaseReconciliation({}, to);
    expect(plan.creates).toHaveLength(0);
  });
});
