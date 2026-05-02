/**
 * Local IndexedDB store mirroring the Supabase schema. This is the
 * source-of-truth for the UI: every read goes through Dexie, every
 * write updates Dexie + appends to the outbox in a single transaction.
 *
 * Stores are scoped to a single user — when the signed-in user changes
 * we drop and recreate the DB (`resetLocalDb`) so RLS-style isolation
 * holds offline.
 */

import Dexie, { type Table } from "dexie";
import type {
  ExerciseRow,
  OutboxEntry,
  SessionExerciseRow,
  SetEntryRow,
  SyncCursorRow,
  WorkoutGroupRow,
  WorkoutSessionRow,
} from "./types";

export class LiftLogLocalDB extends Dexie {
  workout_groups!: Table<WorkoutGroupRow, string>;
  workout_sessions!: Table<WorkoutSessionRow, string>;
  exercises!: Table<ExerciseRow, string>;
  session_exercises!: Table<SessionExerciseRow, string>;
  set_entries!: Table<SetEntryRow, string>;
  outbox!: Table<OutboxEntry, number>;
  sync_meta!: Table<SyncCursorRow, "default">;

  constructor(name = "liftlog-local") {
    super(name);
    this.version(1).stores({
      workout_groups:
        "id, user_id, slug, [user_id+slug], dirty, deleted_at, updated_at",
      workout_sessions:
        "id, user_id, workout_group_id, status, dirty, deleted_at, updated_at",
      exercises:
        "id, user_id, name, [user_id+name], dirty, deleted_at, updated_at",
      session_exercises:
        "id, user_id, session_id, exercise_id, dirty, deleted_at, [session_id+order_index]",
      set_entries:
        "id, user_id, session_exercise_id, dirty, deleted_at, [session_exercise_id+set_number]",
      outbox: "++id, table, row_id, queued_at",
      sync_meta: "id",
    });
  }
}

let dbSingleton: LiftLogLocalDB | null = null;

export function getLocalDb(): LiftLogLocalDB {
  if (typeof indexedDB === "undefined") {
    throw new Error("getLocalDb() called in a non-browser environment");
  }
  if (!dbSingleton) {
    dbSingleton = new LiftLogLocalDB();
  }
  return dbSingleton;
}

export async function resetLocalDb(): Promise<void> {
  if (dbSingleton) {
    await dbSingleton.delete();
    dbSingleton = null;
  } else if (typeof indexedDB !== "undefined") {
    await Dexie.delete("liftlog-local");
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // RFC4122 v4 fallback for ancient runtimes.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
