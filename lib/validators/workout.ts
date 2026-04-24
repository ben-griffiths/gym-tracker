import { z } from "zod";
import { chatTranscriptSchema } from "@/lib/workout-chat-transcript";

export const weightUnitSchema = z.enum(["kg", "lb"]);

export const feelSchema = z.enum(["easy", "medium", "hard"]);
export const rpeSchema = z.number().min(1).max(10);
export const rirSchema = z.number().int().min(0).max(20);

export const visionRecognizeSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().default("image/jpeg"),
  sessionExerciseId: z.string().optional(),
});

const contextSetSchema = z.object({
  setNumber: z.number().int().positive(),
  reps: z.number().int().nullable(),
  weight: z.number().nullable(),
  weightUnit: weightUnitSchema,
  rpe: rpeSchema.nullable().optional(),
  rir: rirSchema.nullable().optional(),
  feel: feelSchema.nullable().optional(),
});

export const chatContextSchema = z.object({
  exerciseSlug: z.string().optional(),
  exerciseName: z.string().optional(),
  sets: z.array(contextSetSchema).optional(),
  blocks: z
    .array(
      z.object({
        exerciseSlug: z.string(),
        exerciseName: z.string(),
        sets: z.array(contextSetSchema),
        isActive: z.boolean().optional(),
      }),
    )
    .optional(),
});

export const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  context: chatContextSchema.optional(),
});

export const updateSetSchema = z.object({
  reps: z.number().int().min(1).max(100).nullable().optional(),
  weight: z.number().min(0).max(2000).nullable().optional(),
  weightUnit: weightUnitSchema.optional(),
  rpe: rpeSchema.nullable().optional(),
  rir: rirSchema.nullable().optional(),
  feel: feelSchema.nullable().optional(),
  isWarmup: z.boolean().optional(),
  notes: z.string().max(160).optional(),
});

export const createWorkoutSchema = z.object({
  groupName: z.string().min(2).max(60),
  sessionName: z.string().min(2).max(80),
  notes: z.string().max(200).optional(),
});

export const patchWorkoutTranscriptSchema = z.object({
  chatTranscript: chatTranscriptSchema,
});

export const registerSessionExerciseSchema = z.object({
  sessionId: z.string().uuid(),
  exercise: z.string().min(1).max(120),
});

export const createSetSchema = z.object({
  sessionId: z.string().min(1),
  exercise: z.string().min(1),
  reps: z.number().int().min(1).max(100).nullable().optional(),
  weight: z.number().min(0).max(2000).nullable().optional(),
  weightUnit: weightUnitSchema.default("kg"),
  setNumber: z.number().int().min(1).max(100),
  source: z.enum(["manual", "camera", "chat"]).default("manual"),
  rpe: rpeSchema.nullable().optional(),
  rir: rirSchema.nullable().optional(),
  feel: feelSchema.nullable().optional(),
  isWarmup: z.boolean().optional(),
  notes: z.string().max(160).optional(),
});

export const createManySetsSchema = z.object({
  sessionId: z.string().min(1),
  exercise: z.string().min(1),
  source: z.enum(["manual", "camera", "chat"]).default("manual"),
  /** When appending to an exercise that already has sets, pass `existingCount + 1`. Defaults to 1. */
  startingSetNumber: z.number().int().min(1).max(100).optional(),
  entries: z
    .array(
      z.object({
        reps: z.number().int().min(1).max(100).nullable().optional(),
        weight: z.number().min(0).max(2000).nullable().optional(),
        weightUnit: weightUnitSchema.default("kg"),
        rpe: rpeSchema.nullable().optional(),
        rir: rirSchema.nullable().optional(),
        feel: feelSchema.nullable().optional(),
        isWarmup: z.boolean().optional(),
        notes: z.string().max(160).optional(),
      }),
    )
    .min(1),
});

export type CreateSetInput = z.infer<typeof createSetSchema>;
