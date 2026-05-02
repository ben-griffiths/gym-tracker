/**
 * Server-shape rows + sync metadata. Field names mirror Postgres columns
 * (snake_case) so the same row object can round-trip between Dexie, the
 * /api/sync/* endpoints, and Supabase without translation.
 */

export type SyncMeta = {
  /** ISO timestamp of the last server-confirmed mutation, or null if never synced. */
  server_updated_at: string | null;
  /** ISO timestamp written when the row was last touched on this device. */
  local_updated_at: string;
  /** 1 = has unsynced local changes; 0 = in sync with the server. */
  dirty: 0 | 1;
};

export type Tombstone = {
  /** Set when the row is soft-deleted; UI filters on `deleted_at == null`. */
  deleted_at: string | null;
};

export type WorkoutGroupRow = SyncMeta &
  Tombstone & {
    id: string;
    user_id: string;
    slug: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
    client_updated_at: string | null;
  };

export type WorkoutSessionStatus = "ACTIVE" | "COMPLETED" | "PAUSED";

export type WorkoutSessionRow = SyncMeta &
  Tombstone & {
    id: string;
    user_id: string;
    workout_group_id: string | null;
    name: string;
    notes: string | null;
    started_at: string;
    ended_at: string | null;
    status: WorkoutSessionStatus;
    chat_transcript: unknown;
    created_at: string;
    updated_at: string;
    client_updated_at: string | null;
  };

export type ExerciseRow = SyncMeta &
  Tombstone & {
    id: string;
    user_id: string;
    name: string;
    aliases: string[];
    created_at: string;
    updated_at: string;
    client_updated_at: string | null;
  };

export type SessionExerciseRow = SyncMeta &
  Tombstone & {
    id: string;
    user_id: string;
    session_id: string;
    exercise_id: string | null;
    custom_exercise_name: string | null;
    order_index: number;
    created_at: string;
    updated_at: string;
    client_updated_at: string | null;
  };

export type SetEntryRow = SyncMeta &
  Tombstone & {
    id: string;
    user_id: string;
    session_exercise_id: string;
    set_number: number;
    reps: number | null;
    weight: number | null;
    weight_unit: "kg" | "lb";
    rpe: number | null;
    rir: number | null;
    feel: "easy" | "medium" | "hard" | null;
    is_warmup: boolean;
    notes: string | null;
    logged_at: string;
    source: "manual" | "camera" | "chat";
    created_at: string;
    updated_at: string;
    client_updated_at: string | null;
  };

export type SyncTable =
  | "workout_groups"
  | "workout_sessions"
  | "exercises"
  | "session_exercises"
  | "set_entries";

export type SyncRow =
  | WorkoutGroupRow
  | WorkoutSessionRow
  | ExerciseRow
  | SessionExerciseRow
  | SetEntryRow;

export type ServerRow = Omit<SyncRow, keyof SyncMeta>;

export type OutboxOp = "upsert" | "delete";

export type OutboxEntry = {
  /** Auto-incrementing local id. */
  id?: number;
  table: SyncTable;
  op: OutboxOp;
  row_id: string;
  /**
   * The full server-shape row payload (no SyncMeta) at the moment of queuing.
   * For deletes we still send the full row so the server can apply the LWW
   * guard against the existing record.
   */
  payload: Record<string, unknown>;
  client_updated_at: string;
  attempts: number;
  queued_at: string;
};

export type SyncCursorRow = {
  /** Always "default" — single-user device. */
  id: "default";
  cursor: string | null;
  last_pull_at: string | null;
};
