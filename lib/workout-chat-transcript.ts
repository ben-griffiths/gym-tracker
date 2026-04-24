import { z } from "zod";
import type { ExerciseRecord } from "@/lib/exercises";
import type { ExerciseWeightCandidate, SetDetail } from "@/lib/types/workout";

/**
 * In-memory chat line items for the workout page (mirrors the page's Message union).
 */
export type WorkoutChatMessage =
  | {
      id: string;
      kind: "text";
      role: "user" | "assistant" | "system";
      text: string;
    }
  | { id: string; kind: "camera-image"; role: "user"; imageUrl: string }
  | { id: string; kind: "exercise-block"; role: "assistant"; blockId: string }
  | {
      id: string;
      kind: "exercise-description";
      role: "assistant";
      exercise: ExerciseRecord;
      mode: "instructions" | "description";
    }
  | {
      id: string;
      kind: "exercise-options";
      role: "assistant";
      options: ExerciseRecord[];
      pendingSets: SetDetail[];
      boundBlockId?: string;
      resolved?: boolean;
      resolvedExerciseName?: string;
    }
  | {
      id: string;
      kind: "candidates";
      role: "assistant";
      candidates: ExerciseWeightCandidate[];
      resolved?: boolean;
    };

type BlockForTranscript = { exercise: ExerciseRecord };

const exerciseRecordSchema: z.ZodType<ExerciseRecord> = z
  .object({
    slug: z.string(),
    name: z.string(),
    category: z.string().nullable(),
    iconPath: z.string(),
    pageUrl: z.string(),
    standards: z.unknown().optional().nullable(),
    guide: z.unknown().optional().nullable(),
  })
  .passthrough() as z.ZodType<ExerciseRecord>;

const setDetailSchema: z.ZodType<SetDetail> = z.object({
  setNumber: z.number(),
  reps: z.number().nullable(),
  weight: z.number().nullable(),
  weightUnit: z.enum(["kg", "lb"]),
  rpe: z.number().nullable().optional(),
  rir: z.number().nullable().optional(),
  feel: z.enum(["easy", "medium", "hard"]).nullable().optional(),
}) as z.ZodType<SetDetail>;

const exerciseWeightCandidateSchema: z.ZodType<ExerciseWeightCandidate> = z.object({
  exercise: exerciseRecordSchema,
  weight: z.number().nullable(),
  weightUnit: z.enum(["kg", "lb"]),
  confidence: z.number(),
  reasoning: z.string().optional(),
}) as z.ZodType<ExerciseWeightCandidate>;

const serializedTextSchema = z.object({
  kind: z.literal("text"),
  role: z.enum(["user", "assistant", "system"]),
  text: z.string(),
});

const serializedCameraSchema = z.object({
  kind: z.literal("camera-image"),
  imageUrl: z.string(),
});

const serializedExerciseBlockSchema = z.object({
  kind: z.literal("exercise-block"),
  exerciseSlug: z.string(),
});

const serializedExerciseDescriptionSchema = z.object({
  kind: z.literal("exercise-description"),
  exercise: exerciseRecordSchema,
  mode: z.enum(["instructions", "description"]),
});

const serializedExerciseOptionsSchema = z.object({
  kind: z.literal("exercise-options"),
  options: z.array(exerciseRecordSchema),
  pendingSets: z.array(setDetailSchema),
  boundExerciseSlug: z.string().optional(),
  resolved: z.boolean().optional(),
  resolvedExerciseName: z.string().optional(),
});

const serializedCandidatesSchema = z.object({
  kind: z.literal("candidates"),
  candidates: z.array(exerciseWeightCandidateSchema),
  resolved: z.boolean().optional(),
});

const serializedMessageSchema = z.discriminatedUnion("kind", [
  serializedTextSchema,
  serializedCameraSchema,
  serializedExerciseBlockSchema,
  serializedExerciseDescriptionSchema,
  serializedExerciseOptionsSchema,
  serializedCandidatesSchema,
]);

export const chatTranscriptSchema = z.array(serializedMessageSchema);

export type SerializedChatMessage = z.infer<typeof serializedMessageSchema>;

function serializeOne(
  message: WorkoutChatMessage,
  blocks: Record<string, BlockForTranscript>,
): SerializedChatMessage | null {
  switch (message.kind) {
    case "text":
      return {
        kind: "text",
        role: message.role,
        text: message.text,
      };
    case "camera-image":
      return {
        kind: "camera-image",
        imageUrl: message.imageUrl,
      };
    case "exercise-block": {
      const block = blocks[message.blockId];
      if (!block) return null;
      return {
        kind: "exercise-block",
        exerciseSlug: block.exercise.slug,
      };
    }
    case "exercise-description":
      return {
        kind: "exercise-description",
        exercise: message.exercise,
        mode: message.mode,
      };
    case "exercise-options": {
      const bound =
        message.boundBlockId !== undefined
          ? blocks[message.boundBlockId]?.exercise.slug
          : undefined;
      return {
        kind: "exercise-options",
        options: message.options,
        pendingSets: message.pendingSets,
        boundExerciseSlug: bound,
        resolved: message.resolved,
        resolvedExerciseName: message.resolvedExerciseName,
      };
    }
    case "candidates":
      return {
        kind: "candidates",
        candidates: message.candidates,
        resolved: message.resolved,
      };
    default:
      return null;
  }
}

/**
 * Build JSON-safe payload for `workout_sessions.chat_transcript` (array of serialized messages).
 */
export function serializeWorkoutChatTranscript(
  messages: WorkoutChatMessage[],
  blocks: Record<string, BlockForTranscript>,
): unknown {
  const out: SerializedChatMessage[] = [];
  for (const m of messages) {
    const s = serializeOne(m, blocks);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Returns parsed serialized messages, or `null` if invalid.
 */
export function parseChatTranscriptPayload(raw: unknown): SerializedChatMessage[] | null {
  const parsed = chatTranscriptSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Instantiates client message ids and resolves exercise-block / bound option slugs to block ids.
 * Drops `exercise-block` lines when the slug is unknown. Drops `boundBlockId` when slug unmapped.
 */
export function deserializeWorkoutChatMessages(
  raw: unknown,
  slugToBlockId: Map<string, string>,
  makeId: (prefix: string) => string,
): WorkoutChatMessage[] | null {
  const entries = parseChatTranscriptPayload(raw);
  if (!entries) return null;

  const out: WorkoutChatMessage[] = [];
  for (const entry of entries) {
    const id = makeId("msg");
    switch (entry.kind) {
      case "text":
        out.push({
          id,
          kind: "text",
          role: entry.role,
          text: entry.text,
        });
        break;
      case "camera-image":
        out.push({
          id,
          kind: "camera-image",
          role: "user",
          imageUrl: entry.imageUrl,
        });
        break;
      case "exercise-block": {
        const blockId = slugToBlockId.get(entry.exerciseSlug);
        if (!blockId) break;
        out.push({ id, kind: "exercise-block", role: "assistant", blockId });
        break;
      }
      case "exercise-description":
        out.push({
          id,
          kind: "exercise-description",
          role: "assistant",
          exercise: entry.exercise,
          mode: entry.mode,
        });
        break;
      case "exercise-options": {
        const boundBlockId =
          entry.boundExerciseSlug !== undefined
            ? slugToBlockId.get(entry.boundExerciseSlug)
            : undefined;
        out.push({
          id,
          kind: "exercise-options",
          role: "assistant",
          options: entry.options,
          pendingSets: entry.pendingSets,
          ...(boundBlockId !== undefined ? { boundBlockId } : {}),
          resolved: entry.resolved,
          resolvedExerciseName: entry.resolvedExerciseName,
        });
        break;
      }
      case "candidates":
        out.push({
          id,
          kind: "candidates",
          role: "assistant",
          candidates: entry.candidates,
          resolved: entry.resolved,
        });
        break;
      default:
        break;
    }
  }
  return out;
}

export function computeSlugToBlockId(
  blocks: Record<string, BlockForTranscript & { id?: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [blockId, block] of Object.entries(blocks)) {
    map.set(block.exercise.slug, blockId);
  }
  return map;
}
