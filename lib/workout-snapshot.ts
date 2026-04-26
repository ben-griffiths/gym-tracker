import type { BlockSet } from "@/components/workout/exercise-block-card";
import type { EffortFeel } from "@/lib/types/workout";
import type { SetDetail } from "@/lib/types/workout";
import type { ExerciseRecord } from "@/lib/exercises";
import type { WorkoutChatMessage } from "@/lib/workout-chat-transcript";

/** Mirrors `ExerciseBlock` in app/workout/page.tsx. */
export type SnapshotExerciseBlock = {
  id: string;
  exercise: ExerciseRecord;
  sets: BlockSet[];
  deleted?: boolean;
};

export type WorkoutStateSnapshot = {
  messages: WorkoutChatMessage[];
  blocks: Record<string, SnapshotExerciseBlock>;
  activeBlockId: string | null;
  collapsedBlockIds: string[];
  bufferedSets: SetDetail[];
};

export function cloneWorkoutStateSnapshot(
  snap: WorkoutStateSnapshot,
): WorkoutStateSnapshot {
  if (typeof structuredClone === "function") {
    return structuredClone(snap) as WorkoutStateSnapshot;
  }
  return JSON.parse(JSON.stringify(snap)) as WorkoutStateSnapshot;
}

function setDbFieldsDiffer(a: BlockSet, b: BlockSet): SetDbPatch {
  const patch: SetDbPatch = {};
  if (a.reps !== b.reps) patch.reps = b.reps;
  if (a.weight !== b.weight) patch.weight = b.weight;
  if (a.weightUnit !== b.weightUnit) patch.weightUnit = b.weightUnit;
  if ((a.rpe ?? null) !== (b.rpe ?? null)) patch.rpe = b.rpe ?? null;
  if ((a.rir ?? null) !== (b.rir ?? null)) patch.rir = b.rir ?? null;
  if ((a.feel ?? null) !== (b.feel ?? null)) patch.feel = b.feel ?? null;
  return patch;
}

function collectDbIdMap(
  blocks: Record<string, SnapshotExerciseBlock>,
): Map<string, { block: SnapshotExerciseBlock; set: BlockSet }> {
  const map = new Map<string, { block: SnapshotExerciseBlock; set: BlockSet }>();
  for (const block of Object.values(blocks)) {
    for (const set of block.sets) {
      if (set.dbId) {
        map.set(set.dbId, { block, set });
      }
    }
  }
  return map;
}

export type SetCreatePlan = {
  blockId: string;
  setLocalId: string;
  exerciseName: string;
  set: BlockSet;
};

export type SetDbPatch = {
  reps?: number | null;
  weight?: number | null;
  weightUnit?: "kg" | "lb";
  rpe?: number | null;
  rir?: number | null;
  feel?: EffortFeel | null;
};

export type SetUpdatePlan = {
  dbId: string;
  patch: SetDbPatch;
  beforeSet: BlockSet;
  targetSet: BlockSet;
};

export type DatabaseReconciliationPlan = {
  /** dbIds present in fromBlocks but not in toBlocks. */
  deleteDbIds: string[];
  updates: SetUpdatePlan[];
  creates: SetCreatePlan[];
};

/**
 * Plan DB work to go from a known persisted state (fromBlocks) to a restore
 * target (toBlocks). Assumes the same `sessionId` and exercise catalog.
 */
export function planDatabaseReconciliation(
  fromBlocks: Record<string, SnapshotExerciseBlock>,
  toBlocks: Record<string, SnapshotExerciseBlock>,
): DatabaseReconciliationPlan {
  const fromByDb = collectDbIdMap(fromBlocks);
  const toByDb = collectDbIdMap(toBlocks);
  const deleteDbIds: string[] = [];
  for (const id of fromByDb.keys()) {
    if (!toByDb.has(id)) {
      deleteDbIds.push(id);
    }
  }
  const updates: SetUpdatePlan[] = [];
  for (const [dbId, toEntry] of toByDb) {
    const fromEntry = fromByDb.get(dbId);
    if (fromEntry) {
      const patch = setDbFieldsDiffer(fromEntry.set, toEntry.set);
      if (Object.keys(patch).length > 0) {
        updates.push({
          dbId,
          patch,
          beforeSet: fromEntry.set,
          targetSet: toEntry.set,
        });
      }
    }
  }
  const creates: SetCreatePlan[] = [];
  for (const [blockId, block] of Object.entries(toBlocks)) {
    if (block.deleted) continue;
    for (const set of block.sets) {
      if (!set.dbId) {
        creates.push({
          blockId,
          setLocalId: set.id,
          exerciseName: block.exercise.name,
          set,
        });
      }
    }
  }
  return { deleteDbIds, updates, creates };
}

/**
 * Remove snapshot entries for user message ids that no longer appear in the
 * transcript (e.g. after undo).
 */
export function pruneUserMessageSnapshotMap(
  map: Map<string, WorkoutStateSnapshot>,
  currentMessageIds: ReadonlyArray<string>,
): void {
  const visible = new Set(currentMessageIds);
  for (const k of map.keys()) {
    if (!visible.has(k)) {
      map.delete(k);
    }
  }
}
