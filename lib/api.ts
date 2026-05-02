/**
 * Local-first client API. Every mutation:
 *   1. Generates a client UUID (so the row has a stable id online and off).
 *   2. Writes the row + an outbox entry to Dexie in one transaction.
 *   3. Kicks the sync engine, which drains the outbox to /api/sync/push
 *      whenever the device is online. The same engine pulls /api/sync/pull
 *      back into Dexie so other devices' edits show up.
 *
 * Reads still use the legacy GET /api/workouts route handler today; a
 * service worker caches that response so the UI loads offline. (Migrating
 * reads to live Dexie queries is a follow-up — the sync metadata to do so
 * is already populated.)
 *
 * Return shapes here mirror the legacy /api/* responses so existing UI
 * callers (workout/page.tsx, history-sheet.tsx) keep working unchanged.
 */

import type { EffortFeel, VisionRecognitionResponse } from "@/lib/types/workout";
import { getLocalDb, newUuid, nowIso } from "@/lib/sync/db";
import { enqueueMutation, flushOutboxOnce } from "@/lib/sync/engine";
import type {
  ExerciseRow,
  SessionExerciseRow,
  SetEntryRow,
  WorkoutGroupRow,
  WorkoutSessionRow,
} from "@/lib/sync/types";

async function throwIfNotOk(response: Response, fallbackMessage: string) {
  if (response.ok) return;
  let message = fallbackMessage;
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {}
  throw new Error(message);
}

function slugifyGroupName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64) || "workout";
}

async function getCurrentUserId(): Promise<string> {
  const { createClient } = await import("@/lib/supabase/client");
  const client = createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) throw new Error("Please log in to continue.");
  return data.user.id;
}

function serverShape<T extends Record<string, unknown>>(row: T): T {
  // Strip Dexie-only metadata fields before they hit the wire / outbox payload.
  const rest = { ...row } as Record<string, unknown>;
  delete rest.server_updated_at;
  delete rest.local_updated_at;
  delete rest.dirty;
  return rest as T;
}

async function findOrCreateExercise(
  userId: string,
  exerciseName: string,
): Promise<ExerciseRow> {
  const db = getLocalDb();
  const trimmed = exerciseName.trim();
  const lower = trimmed.toLowerCase();

  const all = await db.exercises
    .where("user_id")
    .equals(userId)
    .filter((row) => !row.deleted_at)
    .toArray();
  const existing = all.find(
    (e) =>
      e.name.toLowerCase() === lower || e.aliases.some((a) => a.toLowerCase() === lower),
  );
  if (existing) return existing;

  const ts = nowIso();
  const row: ExerciseRow = {
    id: newUuid(),
    user_id: userId,
    name: trimmed,
    aliases: [lower],
    created_at: ts,
    updated_at: ts,
    client_updated_at: ts,
    deleted_at: null,
    server_updated_at: null,
    local_updated_at: ts,
    dirty: 1,
  };

  await db.transaction("rw", [db.exercises, db.outbox], async () => {
    await db.exercises.put(row);
    await enqueueMutation({
      table: "exercises",
      op: "upsert",
      row_id: row.id,
      client_updated_at: ts,
      payload: serverShape(row),
    });
  });
  return row;
}

async function findOrCreateSessionExercise(
  userId: string,
  sessionId: string,
  exercise: ExerciseRow,
): Promise<SessionExerciseRow> {
  const db = getLocalDb();
  const siblings = await db.session_exercises
    .where("session_id")
    .equals(sessionId)
    .filter((row) => !row.deleted_at)
    .toArray();
  const existing = siblings.find((s) => s.exercise_id === exercise.id);
  if (existing) return existing;

  const ts = nowIso();
  const row: SessionExerciseRow = {
    id: newUuid(),
    user_id: userId,
    session_id: sessionId,
    exercise_id: exercise.id,
    custom_exercise_name: exercise.name,
    order_index: siblings.length,
    created_at: ts,
    updated_at: ts,
    client_updated_at: ts,
    deleted_at: null,
    server_updated_at: null,
    local_updated_at: ts,
    dirty: 1,
  };
  await db.transaction("rw", [db.session_exercises, db.outbox], async () => {
    await db.session_exercises.put(row);
    await enqueueMutation({
      table: "session_exercises",
      op: "upsert",
      row_id: row.id,
      client_updated_at: ts,
      payload: serverShape(row),
    });
  });
  return row;
}

export async function createWorkoutSession(input: {
  groupName: string;
  sessionName: string;
  notes?: string | null;
}) {
  const userId = await getCurrentUserId();
  const db = getLocalDb();
  const slug = slugifyGroupName(input.groupName);
  const ts = nowIso();

  const existingGroup = await db.workout_groups
    .where("[user_id+slug]")
    .equals([userId, slug])
    .first();

  let group: WorkoutGroupRow;
  if (existingGroup && !existingGroup.deleted_at) {
    group = existingGroup;
  } else {
    group = {
      id: newUuid(),
      user_id: userId,
      slug,
      name: input.groupName,
      description: null,
      created_at: ts,
      updated_at: ts,
      client_updated_at: ts,
      deleted_at: null,
      server_updated_at: null,
      local_updated_at: ts,
      dirty: 1,
    };
  }

  const session: WorkoutSessionRow = {
    id: newUuid(),
    user_id: userId,
    workout_group_id: group.id,
    name: input.sessionName,
    notes: input.notes ?? null,
    started_at: ts,
    ended_at: null,
    status: "ACTIVE",
    chat_transcript: null,
    created_at: ts,
    updated_at: ts,
    client_updated_at: ts,
    deleted_at: null,
    server_updated_at: null,
    local_updated_at: ts,
    dirty: 1,
  };

  await db.transaction(
    "rw",
    [db.workout_groups, db.workout_sessions, db.outbox],
    async () => {
      if (group.dirty === 1) {
        await db.workout_groups.put(group);
        await enqueueMutation({
          table: "workout_groups",
          op: "upsert",
          row_id: group.id,
          client_updated_at: ts,
          payload: serverShape(group),
        });
      }
      await db.workout_sessions.put(session);
      await enqueueMutation({
        table: "workout_sessions",
        op: "upsert",
        row_id: session.id,
        client_updated_at: ts,
        payload: serverShape(session),
      });
    },
  );

  await flushOutboxOnce();

  return {
    group: { id: group.id, name: group.name },
    session: {
      id: session.id,
      name: session.name,
      startedAt: session.started_at,
    },
    storageMode: "database" as const,
  };
}

export async function recognizeVision(imageBase64: string, mimeType: string) {
  const response = await fetch("/api/vision/recognize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, mimeType }),
  });
  await throwIfNotOk(response, "Camera recognition failed");
  return response.json() as Promise<VisionRecognitionResponse>;
}

export async function updateSet(
  setId: string,
  patch: {
    reps?: number | null;
    weight?: number | null;
    weightUnit?: "kg" | "lb";
    rpe?: number | null;
    rir?: number | null;
    feel?: EffortFeel | null;
  },
) {
  const db = getLocalDb();
  const existing = await db.set_entries.get(setId);
  if (!existing) throw new Error("Set not found locally");
  const ts = nowIso();
  const updated: SetEntryRow = {
    ...existing,
    reps: patch.reps !== undefined ? patch.reps : existing.reps,
    weight: patch.weight !== undefined ? patch.weight : existing.weight,
    weight_unit: patch.weightUnit ?? existing.weight_unit,
    rpe: patch.rpe !== undefined ? patch.rpe : existing.rpe,
    rir: patch.rir !== undefined ? patch.rir : existing.rir,
    feel: patch.feel !== undefined ? patch.feel : existing.feel,
    updated_at: ts,
    client_updated_at: ts,
    local_updated_at: ts,
    dirty: 1,
  };
  await db.transaction("rw", [db.set_entries, db.outbox], async () => {
    await db.set_entries.put(updated);
    await enqueueMutation({
      table: "set_entries",
      op: "upsert",
      row_id: setId,
      client_updated_at: ts,
      payload: serverShape(updated),
    });
  });
  await flushOutboxOnce();
  return { id: setId };
}

async function softDelete<T extends "set_entries" | "workout_sessions">(
  table: T,
  id: string,
) {
  const db = getLocalDb();
  const store = db.table(table);
  const existing = (await store.get(id)) as
    | (SetEntryRow | WorkoutSessionRow)
    | undefined;
  if (!existing) return null;
  const ts = nowIso();
  const updated = {
    ...existing,
    deleted_at: ts,
    updated_at: ts,
    client_updated_at: ts,
    local_updated_at: ts,
    dirty: 1 as const,
  };
  await db.transaction("rw", [store, db.outbox], async () => {
    await store.put(updated);
    await enqueueMutation({
      table,
      op: "delete",
      row_id: id,
      client_updated_at: ts,
      payload: serverShape(updated as Record<string, unknown>),
    });
  });
  await flushOutboxOnce();
  return { id };
}

export async function deleteSet(setId: string) {
  return softDelete("set_entries", setId);
}

export async function deleteWorkoutSession(sessionId: string) {
  return softDelete("workout_sessions", sessionId);
}

export async function patchWorkoutTranscript(
  sessionId: string,
  chatTranscript: unknown,
) {
  const db = getLocalDb();
  const existing = await db.workout_sessions.get(sessionId);
  if (!existing) throw new Error("Workout session not found locally");
  const ts = nowIso();
  const updated: WorkoutSessionRow = {
    ...existing,
    chat_transcript: chatTranscript,
    updated_at: ts,
    client_updated_at: ts,
    local_updated_at: ts,
    dirty: 1,
  };
  await db.transaction("rw", [db.workout_sessions, db.outbox], async () => {
    await db.workout_sessions.put(updated);
    await enqueueMutation({
      table: "workout_sessions",
      op: "upsert",
      row_id: sessionId,
      client_updated_at: ts,
      payload: serverShape(updated),
    });
  });
  await flushOutboxOnce();
}

export async function registerSessionExercise(
  sessionId: string,
  exerciseName: string,
) {
  const userId = await getCurrentUserId();
  const exercise = await findOrCreateExercise(userId, exerciseName);
  const sessionExercise = await findOrCreateSessionExercise(
    userId,
    sessionId,
    exercise,
  );
  await flushOutboxOnce();
  return {
    sessionExercise: {
      id: sessionExercise.id,
      sessionId: sessionExercise.session_id,
      orderIndex: sessionExercise.order_index,
    },
  };
}

type CreateSetInput = {
  sessionId: string;
  exercise: string;
  reps: number | null;
  weight: number | null;
  weightUnit: "kg" | "lb";
  setNumber: number;
  source: "manual" | "camera" | "chat";
  rpe?: number | null;
  rir?: number | null;
  feel?: EffortFeel | null;
};

async function insertSet(
  userId: string,
  sessionExercise: SessionExerciseRow,
  entry: Omit<CreateSetInput, "sessionId" | "exercise">,
) {
  const db = getLocalDb();
  const ts = nowIso();
  const row: SetEntryRow = {
    id: newUuid(),
    user_id: userId,
    session_exercise_id: sessionExercise.id,
    set_number: entry.setNumber,
    reps: entry.reps,
    weight: entry.weight,
    weight_unit: entry.weightUnit,
    rpe: entry.rpe ?? null,
    rir: entry.rir ?? null,
    feel: entry.feel ?? null,
    is_warmup: false,
    notes: null,
    logged_at: ts,
    source: entry.source,
    created_at: ts,
    updated_at: ts,
    client_updated_at: ts,
    deleted_at: null,
    server_updated_at: null,
    local_updated_at: ts,
    dirty: 1,
  };
  await db.transaction("rw", [db.set_entries, db.outbox], async () => {
    await db.set_entries.put(row);
    await enqueueMutation({
      table: "set_entries",
      op: "upsert",
      row_id: row.id,
      client_updated_at: ts,
      payload: serverShape(row),
    });
  });
  return row;
}

export async function createSet(payload: CreateSetInput) {
  const userId = await getCurrentUserId();
  const exercise = await findOrCreateExercise(userId, payload.exercise);
  const sessionExercise = await findOrCreateSessionExercise(
    userId,
    payload.sessionId,
    exercise,
  );
  const created = await insertSet(userId, sessionExercise, payload);
  await flushOutboxOnce();
  return {
    created: {
      id: created.id,
      setNumber: created.set_number,
      reps: created.reps,
      weight: created.weight,
      weightUnit: created.weight_unit,
      source: created.source,
    },
    session: { id: payload.sessionId },
    storageMode: "database" as const,
  };
}

export async function createManySets(payload: {
  sessionId: string;
  exercise: string;
  source: "manual" | "camera" | "chat";
  startingSetNumber?: number;
  entries: Array<{
    reps: number | null;
    weight: number | null;
    weightUnit: "kg" | "lb";
    rpe?: number | null;
    rir?: number | null;
    feel?: EffortFeel | null;
  }>;
}) {
  const userId = await getCurrentUserId();
  const exercise = await findOrCreateExercise(userId, payload.exercise);
  const sessionExercise = await findOrCreateSessionExercise(
    userId,
    payload.sessionId,
    exercise,
  );
  const startNum =
    payload.startingSetNumber ??
    (await getLocalDb()
      .set_entries.where("session_exercise_id")
      .equals(sessionExercise.id)
      .filter((s) => !s.deleted_at)
      .count()) + 1;

  const created: SetEntryRow[] = [];
  for (let i = 0; i < payload.entries.length; i++) {
    const e = payload.entries[i]!;
    const row = await insertSet(userId, sessionExercise, {
      reps: e.reps,
      weight: e.weight,
      weightUnit: e.weightUnit,
      setNumber: startNum + i,
      source: payload.source,
      rpe: e.rpe ?? null,
      rir: e.rir ?? null,
      feel: e.feel ?? null,
    });
    created.push(row);
  }
  await flushOutboxOnce();
  return {
    created: created.map((c) => ({
      id: c.id,
      setNumber: c.set_number,
      reps: c.reps,
      weight: c.weight,
      weightUnit: c.weight_unit,
      source: c.source,
    })),
    session: { id: payload.sessionId },
    storageMode: "database" as const,
  };
}
