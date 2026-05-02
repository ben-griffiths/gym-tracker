/**
 * Zod schemas shared between the client outbox and the /api/sync/* server
 * endpoints. Keeping these in one module guarantees the wire format never
 * drifts between sender and receiver.
 */

import { z } from "zod";
import type { SyncTable } from "./types";

const isoDate = z.string().min(1);
const uuid = z.string().uuid();
const nullable = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

export const workoutGroupSchema = z.object({
  id: uuid,
  user_id: uuid,
  slug: z.string().min(1),
  name: z.string().min(1),
  description: nullable(z.string()),
  created_at: isoDate,
  updated_at: isoDate,
  client_updated_at: nullable(isoDate),
  deleted_at: nullable(isoDate),
});

export const workoutSessionSchema = z.object({
  id: uuid,
  user_id: uuid,
  workout_group_id: nullable(uuid),
  name: z.string().min(1),
  notes: nullable(z.string()),
  started_at: isoDate,
  ended_at: nullable(isoDate),
  status: z.enum(["ACTIVE", "COMPLETED", "PAUSED"]),
  chat_transcript: z.unknown().optional(),
  created_at: isoDate,
  updated_at: isoDate,
  client_updated_at: nullable(isoDate),
  deleted_at: nullable(isoDate),
});

export const exerciseSchema = z.object({
  id: uuid,
  user_id: uuid,
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  created_at: isoDate,
  updated_at: isoDate,
  client_updated_at: nullable(isoDate),
  deleted_at: nullable(isoDate),
});

export const sessionExerciseSchema = z.object({
  id: uuid,
  user_id: uuid,
  session_id: uuid,
  exercise_id: nullable(uuid),
  custom_exercise_name: nullable(z.string()),
  order_index: z.number().int(),
  created_at: isoDate,
  updated_at: isoDate,
  client_updated_at: nullable(isoDate),
  deleted_at: nullable(isoDate),
});

export const setEntrySchema = z.object({
  id: uuid,
  user_id: uuid,
  session_exercise_id: uuid,
  set_number: z.number().int(),
  reps: nullable(z.number()),
  weight: nullable(z.number()),
  weight_unit: z.enum(["kg", "lb"]),
  rpe: nullable(z.number()),
  rir: nullable(z.number()),
  feel: nullable(z.enum(["easy", "medium", "hard"])),
  is_warmup: z.boolean(),
  notes: nullable(z.string()),
  logged_at: isoDate,
  source: z.enum(["manual", "camera", "chat"]),
  created_at: isoDate,
  updated_at: isoDate,
  client_updated_at: nullable(isoDate),
  deleted_at: nullable(isoDate),
});

export const tableNameSchema: z.ZodType<SyncTable> = z.enum([
  "workout_groups",
  "workout_sessions",
  "exercises",
  "session_exercises",
  "set_entries",
]);

export const pushMutationSchema = z.object({
  table: tableNameSchema,
  op: z.enum(["upsert", "delete"]),
  row_id: z.string().uuid(),
  client_updated_at: isoDate,
  payload: z.record(z.string(), z.unknown()),
});

export const pushRequestSchema = z.object({
  mutations: z.array(pushMutationSchema).max(500),
});

export const pushResponseSchema = z.object({
  results: z.array(
    z.object({
      row_id: z.string().uuid(),
      table: tableNameSchema,
      accepted: z.boolean(),
      server_row: z.record(z.string(), z.unknown()),
    }),
  ),
});

export const pullResponseSchema = z.object({
  rows: z.object({
    workout_groups: z.array(workoutGroupSchema),
    workout_sessions: z.array(workoutSessionSchema),
    exercises: z.array(exerciseSchema),
    session_exercises: z.array(sessionExerciseSchema),
    set_entries: z.array(setEntrySchema),
  }),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});

export const ROW_SCHEMAS = {
  workout_groups: workoutGroupSchema,
  workout_sessions: workoutSessionSchema,
  exercises: exerciseSchema,
  session_exercises: sessionExerciseSchema,
  set_entries: setEntrySchema,
} as const;

export type PushMutation = z.infer<typeof pushMutationSchema>;
export type PushResponse = z.infer<typeof pushResponseSchema>;
export type PullResponse = z.infer<typeof pullResponseSchema>;
