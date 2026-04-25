/**
 * Chat agent: the thin layer between the user's chat message and the
 * structured `ChatSetSuggestion` the UI consumes.
 *
 * Why it's its own module:
 *  - Keeps the route handler slim and focused on HTTP concerns.
 *  - Uses OpenAI **tool-calling** so the model picks one or more narrow
 *    "sub-agents" (log_sets, autofill_weights, update_sets, …) per
 *    turn, each with its own tiny schema. This is dramatically more
 *    reliable than stuffing every possible field into a single JSON
 *    blob where the model routinely "forgets" a flag.
 *  - Centralises the fallback + LLM → suggestion conversion so every
 *    normalisation pass (scale-axis arbitration, warmup enrichment,
 *    bogus-slug filtering) happens in one place.
 */

import { z, ZodError } from "zod";
import { getOpenAIClient, OPENAI_CHAT_MODEL } from "@/lib/ai";
import {
  EXERCISES,
  getExerciseBySlug,
  searchExercises,
} from "@/lib/exercises";
import {
  mergeScaleSuggestions,
  parseFallbackSuggestion,
  parsePerSetFieldUpdates,
  parseSets,
  type ScaleRepsHint,
  type ScaleWeightsHint,
} from "@/lib/workout-parser";
import { parseWarmupHints } from "@/lib/warmup-hints";
import type {
  BlockOperation,
  ChatContext,
  ChatSetSuggestion,
  EffortFeel,
  ExerciseRecord,
  SetDetail,
  SetUpdate,
} from "@/lib/types/workout";

// --------------------------------------------------------------------
// Tool schemas: each one is small + focused so the model can call the
// right "sub-agent" with a minimum of noise.
// --------------------------------------------------------------------

const weightUnit = z.enum(["kg", "lb"]);

const effortScalarPreprocess = (value: unknown) =>
  value === "" || value === undefined ? undefined : value;

const rpeSchema = z.preprocess(
  effortScalarPreprocess,
  z.number().min(1).max(10).nullable().optional(),
);
const rirSchema = z.preprocess(
  effortScalarPreprocess,
  z.number().int().min(0).max(20).nullable().optional(),
);
const feelSchema = z.preprocess(
  effortScalarPreprocess,
  z.enum(["easy", "medium", "hard"]).nullable().optional(),
);

const setSchema = z.object({
  reps: z.number().int().min(1).max(100).nullable(),
  weight: z.number().min(0).max(2000).nullable(),
  weightUnit,
  rpe: rpeSchema,
  rir: rirSchema,
  feel: feelSchema,
});

const logSetsArgs = z.object({
  exerciseSlug: z.string().min(1),
  sets: z.array(setSchema).default([]),
  /** When true, wipe the existing sets on this exercise before appending. */
  resetExistingSets: z.boolean().optional().default(false),
});

const updateSetsArgs = z.object({
  targetSetNumbers: z.array(z.number().int().positive()).min(1),
  reps: z.preprocess(
    effortScalarPreprocess,
    z.number().int().min(1).max(100).nullable().optional(),
  ),
  weight: z.preprocess(
    effortScalarPreprocess,
    z.number().min(0).max(2000).nullable().optional(),
  ),
  weightUnit: z
    .preprocess(
      (value) =>
        value === "" || value === null || value === undefined ? undefined : value,
      weightUnit.optional(),
    )
    .optional(),
  rpe: rpeSchema,
  rir: rirSchema,
  feel: feelSchema,
});

const removeBlockArgs = z.object({ exerciseSlug: z.string().min(1) });
const replaceBlockArgs = z.object({
  fromSlug: z.string().min(1),
  toSlug: z.string().min(1),
});

const autofillRepsArgs = z.object({
  targetRpe: z.number().min(1).max(10).optional().default(8),
});

const autofillWeightsArgs = z.object({
  targetRpe: z.number().min(1).max(10).optional().default(8),
  warmupSets: z.number().int().min(0).max(10).optional(),
  warmupStartPct: z.number().min(0.1).max(0.9).optional(),
});

const exerciseHelpArgs = z.object({
  exerciseSlug: z.string().min(1),
  mode: z.enum(["instructions", "description"]),
});

const replyArgs = z.object({
  text: z.string().min(1).max(600),
});

const TOOL_HANDLERS = {
  log_sets: logSetsArgs,
  update_sets: updateSetsArgs,
  remove_block: removeBlockArgs,
  replace_block: replaceBlockArgs,
  autofill_reps: autofillRepsArgs,
  autofill_weights: autofillWeightsArgs,
  show_exercise_help: exerciseHelpArgs,
  reply: replyArgs,
} as const;

export type ToolName = keyof typeof TOOL_HANDLERS;

// OpenAI Responses API tool definitions. Each tool is small + strictly
// typed so the model cannot forget a field that belongs to *another*
// tool: each schema is its own unit.
export const CHAT_TOOLS = [
  {
    type: "function" as const,
    name: "log_sets",
    description:
      "Log one or more NEW sets for an exercise from the catalog. Use this for every exercise the user names (call once per exercise when they mention multiple in a single message). `sets` can be empty when the user just names an exercise without set data. Set `resetExistingSets:true` only when the user announces a clean restart on an existing block (e.g. \"okay i'm gonna start at 60kg and work up\") and the block already has sets.",
    parameters: {
      type: "object",
      properties: {
        exerciseSlug: {
          type: "string",
          description: "Catalog slug (e.g. 'bench-press', 'deadlift').",
        },
        sets: {
          type: "array",
          description:
            "The sets to append. Expand NxM shorthand into N entries (e.g. '5x5 100kg' ⇒ 5 entries). If the user lists several exercises with only a weight each and no reps in one message (e.g. '120kg bench, 200kg deadlift'), that is 1 rep per set — set reps:1 for every such set. Otherwise leave reps/weight null when unspecified; leave effort fields out unless the user mentioned them.",
          items: {
            type: "object",
            properties: {
              reps: { type: ["integer", "null"], minimum: 1, maximum: 100 },
              weight: { type: ["number", "null"], minimum: 0, maximum: 2000 },
              weightUnit: { type: "string", enum: ["kg", "lb"] },
              rpe: { type: ["number", "null"], minimum: 1, maximum: 10 },
              rir: { type: ["integer", "null"], minimum: 0, maximum: 20 },
              feel: {
                type: ["string", "null"],
                enum: ["easy", "medium", "hard", null],
              },
            },
            required: ["reps", "weight", "weightUnit"],
            additionalProperties: false,
          },
        },
        resetExistingSets: {
          type: "boolean",
          description:
            "Wipe the active block's existing sets before appending — use for 'start over at 60kg' when there are already sets.",
        },
      },
      required: ["exerciseSlug", "sets"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "update_sets",
    description:
      "Retroactively modify PAST set rows. ONE weight/rep/rpe value applies to EVERY index in `targetSetNumbers` for this call. For different values on different set numbers, call this tool **multiple times** in the same turn (one call per set), each with a single-element `targetSetNumbers` [n]. For '5 sets' COUNT trim, do not use. To clear rpe/rir/feel, set to null; omit reps/weight unless changing them. Examples: (a) 'all rpe 9' → one call, targetSetNumbers [1,2,3,4] rpe 9. (b) 'set 5 is 120, set 6 is 100' → **four** `update_sets` calls (or the app will parse the phrase) each with [5]+weight, [6]+weight, etc.",
    parameters: {
      type: "object",
      properties: {
        targetSetNumbers: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          minItems: 1,
          description:
            "Set numbers in the current exercise. One shared apply if they all get the same new weight/rep/rpe; otherwise use one set number per call and multiple calls.",
        },
        reps: { type: ["integer", "null"], minimum: 1, maximum: 100 },
        weight: { type: ["number", "null"], minimum: 0, maximum: 2000 },
        weightUnit: { type: "string", enum: ["kg", "lb"] },
        rpe: { type: ["number", "null"], minimum: 1, maximum: 10 },
        rir: { type: ["integer", "null"], minimum: 0, maximum: 20 },
        feel: {
          type: ["string", "null"],
          enum: ["easy", "medium", "hard", null],
        },
      },
      required: ["targetSetNumbers"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "remove_block",
    description:
      "Delete an entire exercise block. For 'remove deadlift', 'scrap that', 'cancel the squat'. Use the slug of the block to remove.",
    parameters: {
      type: "object",
      properties: { exerciseSlug: { type: "string" } },
      required: ["exerciseSlug"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "replace_block",
    description:
      "Swap one exercise for another on an existing block. For 'no, I meant bench' / 'change deadlift to squat'.",
    parameters: {
      type: "object",
      properties: {
        fromSlug: { type: "string" },
        toSlug: { type: "string" },
      },
      required: ["fromSlug", "toSlug"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "autofill_reps",
    description:
      "Auto-fill REP counts on every weighted set in the active block using RPE-calibrated math. For 'scale the reps for me', 'pick the reps at rpe 7'. Only call when there's ≥1 weighted set with missing reps.",
    parameters: {
      type: "object",
      properties: {
        targetRpe: {
          type: "number",
          minimum: 1,
          maximum: 10,
          description: "Target RPE (default 8 = 2 reps in reserve).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "autofill_weights",
    description:
      "Auto-fill WORKING WEIGHTS on sets whose reps are known but weight is missing. Call alongside `log_sets` for 'bench 5x5 you choose the weight' OR for pure phrasings like 'two warmup sets ramping up to 3 working sets'. When the user mentioned warmups, pass `warmupSets` (the first N sets are warmup-ramped from ~`warmupStartPct*1RM` up to the working load). Default start pct is 0.3.",
    parameters: {
      type: "object",
      properties: {
        targetRpe: {
          type: "number",
          minimum: 1,
          maximum: 10,
          description: "Target RPE for the WORKING sets (default 8).",
        },
        warmupSets: {
          type: "integer",
          minimum: 0,
          maximum: 10,
          description:
            "Number of warmup sets at the FRONT of the sequence. Only set when the user mentioned warmups.",
        },
        warmupStartPct: {
          type: "number",
          minimum: 0.1,
          maximum: 0.9,
          description: "Fraction (e.g. 0.3) to start warmups at.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "show_exercise_help",
    description:
      "Render an exercise guide card. Use for 'how do I do squats?' ⇒ instructions, or 'what is a dip?' ⇒ description. Only for specific catalog exercises — NOT generic coaching questions like 'how much rest between sets'.",
    parameters: {
      type: "object",
      properties: {
        exerciseSlug: { type: "string" },
        mode: { type: "string", enum: ["instructions", "description"] },
      },
      required: ["exerciseSlug", "mode"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "reply",
    description:
      "Send a short conversational reply. Use ONLY when no other tool fits: general questions, chit-chat, thank-yous, greetings, generic coaching like 'how much rest between sets'. Keep it to 1-3 sentences, plain text, no markdown.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", minLength: 1, maxLength: 600 } },
      required: ["text"],
      additionalProperties: false,
    },
  },
];

// --------------------------------------------------------------------
// System prompt: smaller than before because each tool's description
// carries its own context.
// --------------------------------------------------------------------

export function buildSystemPrompt(): string {
  const catalog = EXERCISES.map((entry) => `${entry.slug}:${entry.name}`).join(
    "\n",
  );
  return [
    "You are Lift, an AI coach inside a mobile-first chat gym tracker.",
    "Parse each user message into tool calls — do NOT write free-form JSON. Call whichever tools fit, in the right order. One call per distinct action.",
    "",
    "Rules:",
    "- Every exercise you reference must come from the catalog below. If the user's word doesn't match a catalog slug, resolve it via the most common abbreviation (bench⇒bench-press, OHP/overhead press⇒shoulder-press, dead/deads⇒deadlift, squat⇒squat).",
    "- NEVER invent an exercise. If you genuinely can't resolve it, DO NOT call log_sets — call `reply` asking which exercise.",
    "- Multi-exercise messages ⇒ call `log_sets` ONCE PER exercise, each with that exercise's own sets.",
    "- A comma- or 'and'-separated list of only weight+exercise and NO rep count in one user message (e.g. '120kg bench, 200kg dead, 160kg squat', '75kg OHP and 200kg deadlift') is a list of single heavy entries: one set per part with `reps: 1` and the given weight+weightUnit. Do not leave reps null for those.",
    "- NxM shorthand is ALWAYS N sets of M reps (10x10 ⇒ 10 sets of 10 reps, never 2 sets).",
    "- '5 sets at 20kg' with a prior 5-rep set in context ⇒ 5 entries with reps=5 (inherited) weight=20.",
    "- '100k' is shorthand for 100kg.",
    "- Weight progressions ('start at A, increase by D until B') ⇒ expand into explicit sets landing EXACTLY on B.",
    "- NEVER guess weights yourself. If the user didn't state a weight for a set, leave `weight: null` in `log_sets` and call `autofill_weights` — the client has the user's real 1RM and RPE math.",
    "- Call `autofill_weights` alongside `log_sets` whenever the user asks you to pick the weight, OR when they describe a warmup ramp ('2 warmup + 3 working sets', 'two warmups building up to working weight'). Pass `warmupSets` explicitly when the user mentioned them (e.g. '2 warmup sets' ⇒ warmupSets: 2). Emit `log_sets` with weight: null for EVERY set in this case (warmups AND working sets) so the client can ramp the sequence.",
    "- Call `autofill_reps` ONLY when the user asks you to choose reps for already-weighted sets ('scale the reps', 'pick reps for me'). NEVER mix it with `log_sets` in the same turn.",
    "- Effort ratings (rpe/rir/feel) only when the user explicitly tagged a set; otherwise omit them.",
    "- For retroactive edits with the SAME new value on many sets ('they were all rpe 9') one `update_sets` can use multiple `targetSetNumbers` with one rpe/weight/reps value.",
    "- If the user gives **different** values per set number ('set 5 is 120kg, set 6 is 100kg' / 'set 2 was 5 reps, set 3 was 3 reps'), you MUST call `update_sets` **once per set** (each call has a single set number in `targetSetNumbers` and that set's new weight/reps) — do NOT use one `update_sets` with one weight and four set numbers; that overwrites all with the same value.",
    "- For a single 'set N is …' phrase you can also use one `update_sets` with one targetSetNumbers entry.",
    "- For 'remove / delete / scrap X' call `remove_block`. For 'no I meant Y' or 'change X to Y' call `replace_block` against the active / named block.",
    "- Use `show_exercise_help` for 'how do I do <exercise>?' (instructions) or 'what is <exercise>?' (description).",
    "- Use `reply` ONLY when nothing else fits (questions, chit-chat, greetings). Keep it to 1-3 sentences.",
    "- You MAY call multiple tools in one turn (e.g. `log_sets` + `autofill_weights`, or several `log_sets` for a multi-exercise turn).",
    "",
    "Catalog (slug:name):",
    catalog,
  ].join("\n");
}

function formatContextSet(set: {
  reps: number | null;
  weight: number | null;
  weightUnit: string;
  rpe?: number | null;
  rir?: number | null;
  feel?: string | null;
}): string {
  const reps = set.reps === null ? "?" : String(set.reps);
  const weight = set.weight === null ? "?" : `${set.weight} ${set.weightUnit}`;
  const effortParts: string[] = [];
  if (set.rpe !== null && set.rpe !== undefined) effortParts.push(`RPE ${set.rpe}`);
  if (set.rir !== null && set.rir !== undefined) effortParts.push(`RIR ${set.rir}`);
  if (set.feel) effortParts.push(`feel=${set.feel}`);
  const effortSuffix = effortParts.length > 0 ? ` · ${effortParts.join(" · ")}` : "";
  return `${reps} reps · ${weight}${effortSuffix}`;
}

export function summariseContext(context: ChatContext | undefined): string {
  if (!context) return "No exercises tracked yet in this chat.";

  const blocks = context.blocks ?? [];
  if (blocks.length === 0 && !context.exerciseName) {
    return "No exercises tracked yet in this chat.";
  }

  const lines: string[] = [];
  if (blocks.length > 0) {
    lines.push("Exercise blocks in this chat (in order):");
    for (const block of blocks) {
      const marker = block.isActive ? " (ACTIVE)" : "";
      lines.push(
        `- ${block.exerciseName} [slug: ${block.exerciseSlug}]${marker}`,
      );
      if (block.sets.length === 0) {
        lines.push("    (no sets)");
      } else {
        for (const set of block.sets) {
          lines.push(`    #${set.setNumber}: ${formatContextSet(set)}`);
        }
      }
    }
  } else if (context.exerciseName) {
    lines.push(
      `Active exercise: ${context.exerciseName}${context.exerciseSlug ? ` (slug: ${context.exerciseSlug})` : ""}`,
    );
    const sets = context.sets ?? [];
    if (sets.length === 0) lines.push("No sets logged yet.");
    for (const set of sets) {
      lines.push(`  #${set.setNumber}: ${formatContextSet(set)}`);
    }
  }

  return lines.join("\n");
}

// --------------------------------------------------------------------
// Tool-call → ChatSetSuggestion mapping.
// --------------------------------------------------------------------

export type ToolCall = { name: string; arguments: string };

export type AssembleInput = {
  message: string;
  context: ChatContext | undefined;
  toolCalls: ToolCall[];
  /** Used whenever the LLM emitted nothing we can act on. */
  fallback: ChatSetSuggestion;
};

type ParsedCalls = {
  logSets: z.infer<typeof logSetsArgs>[];
  updateSets: z.infer<typeof updateSetsArgs>[];
  removeBlock: z.infer<typeof removeBlockArgs>[];
  replaceBlock: z.infer<typeof replaceBlockArgs>[];
  autofillReps: z.infer<typeof autofillRepsArgs> | null;
  autofillWeights: z.infer<typeof autofillWeightsArgs> | null;
  exerciseHelp: z.infer<typeof exerciseHelpArgs> | null;
  reply: z.infer<typeof replyArgs> | null;
};

function parseToolCalls(calls: ToolCall[]): ParsedCalls {
  const parsed: ParsedCalls = {
    logSets: [],
    updateSets: [],
    removeBlock: [],
    replaceBlock: [],
    autofillReps: null,
    autofillWeights: null,
    exerciseHelp: null,
    reply: null,
  };

  for (const call of calls) {
    let args: unknown;
    try {
      args = JSON.parse(call.arguments || "{}");
    } catch {
      continue;
    }
    const handler =
      (TOOL_HANDLERS as Record<string, z.ZodTypeAny>)[call.name] ?? null;
    if (!handler) continue;
    const result = handler.safeParse(args);
    if (!result.success) continue;
    switch (call.name as ToolName) {
      case "log_sets":
        parsed.logSets.push(result.data as z.infer<typeof logSetsArgs>);
        break;
      case "update_sets":
        parsed.updateSets.push(result.data as z.infer<typeof updateSetsArgs>);
        break;
      case "remove_block":
        parsed.removeBlock.push(
          result.data as z.infer<typeof removeBlockArgs>,
        );
        break;
      case "replace_block":
        parsed.replaceBlock.push(
          result.data as z.infer<typeof replaceBlockArgs>,
        );
        break;
      case "autofill_reps":
        parsed.autofillReps = result.data as z.infer<typeof autofillRepsArgs>;
        break;
      case "autofill_weights":
        parsed.autofillWeights = result.data as z.infer<
          typeof autofillWeightsArgs
        >;
        break;
      case "show_exercise_help":
        parsed.exerciseHelp = result.data as z.infer<typeof exerciseHelpArgs>;
        break;
      case "reply":
        parsed.reply = result.data as z.infer<typeof replyArgs>;
        break;
    }
  }
  return parsed;
}

/**
 * When a single turn lists 2+ exercises with only weights and no reps, treat
 * each set as 1 rep (e.g. reference / max numbers the user is quoting).
 */
function defaultRepsForMultiExerciseWeightOnlyRows(
  logSets: z.infer<typeof logSetsArgs>[],
): z.infer<typeof logSetsArgs>[] {
  if (logSets.length < 2) return logSets;
  const everySetHasWeight = logSets.every(
    (call) =>
      call.sets.length > 0 && call.sets.every((s) => s.weight !== null),
  );
  if (!everySetHasWeight) return logSets;
  const everyRepsNull = logSets.every((call) =>
    call.sets.every((s) => s.reps === null),
  );
  if (!everyRepsNull) return logSets;
  return logSets.map((call) => ({
    ...call,
    sets: call.sets.map((s) =>
      s.reps === null && s.weight !== null ? { ...s, reps: 1 } : s,
    ),
  }));
}

function normaliseAppendSets(
  raw: z.infer<typeof setSchema>[],
): SetDetail[] {
  return raw.map((set, index) => ({
    setNumber: index + 1,
    reps: set.reps,
    weight: set.weight,
    weightUnit: set.weightUnit,
    ...(set.rpe !== undefined ? { rpe: set.rpe } : {}),
    ...(set.rir !== undefined ? { rir: set.rir } : {}),
    ...(set.feel !== undefined ? { feel: set.feel as EffortFeel | null } : {}),
  }));
}

function mapUpdate(update: z.infer<typeof updateSetsArgs>): SetUpdate {
  const out: SetUpdate = { targetSetNumbers: update.targetSetNumbers };
  // Models often pass reps/weight: null to mean "unchanged" alongside rpe: null
  // to clear effort — that must NOT wipe the logged reps/weight on the set.
  if (update.reps != null) out.reps = update.reps;
  if (update.weight != null) out.weight = update.weight;
  if (update.weightUnit !== undefined) out.weightUnit = update.weightUnit;
  if (update.rpe !== undefined) out.rpe = update.rpe;
  if (update.rir !== undefined) out.rir = update.rir;
  if (update.feel !== undefined)
    out.feel = update.feel as EffortFeel | null;
  return out;
}

export function assembleSuggestion(input: AssembleInput): ChatSetSuggestion {
  const { message, context, toolCalls, fallback } = input;
  const parsed = parseToolCalls(toolCalls);
  parsed.logSets = defaultRepsForMultiExerciseWeightOnlyRows(parsed.logSets);

  // --- Logging (log_sets calls, one per exercise) --------------------
  type ResolvedLogCall = {
    exercise: ExerciseRecord;
    sets: SetDetail[];
    resetExistingSets: boolean;
  };
  const resolvedLogs: ResolvedLogCall[] = [];
  for (const call of parsed.logSets) {
    const exercise = getExerciseBySlug(call.exerciseSlug);
    if (!exercise) continue;
    resolvedLogs.push({
      exercise,
      sets: normaliseAppendSets(call.sets),
      resetExistingSets: Boolean(call.resetExistingSets),
    });
  }

  const [primary, ...additionalLogs] = resolvedLogs;
  const sets = primary?.sets ?? [];
  const additionalExercises = additionalLogs
    .filter((entry) => entry.exercise.slug !== primary?.exercise.slug)
    .filter((entry) => entry.sets.length > 0)
    .map((entry) => ({ exercise: entry.exercise, sets: entry.sets }));

  // --- Updates -------------------------------------------------------
  let updates: SetUpdate[] = parsed.updateSets.map(mapUpdate);
  if (context) {
    const perSet = parsePerSetFieldUpdates(message, context);
    if (
      perSet.length > 0 &&
      (perSet.length > updates.length ||
        (updates.length <= 1 && perSet.length > 1))
    ) {
      updates = perSet;
    }
  }

  // --- Block operations ---------------------------------------------
  const blockOperations: BlockOperation[] = [];
  for (const op of parsed.removeBlock) {
    const record = getExerciseBySlug(op.exerciseSlug);
    if (record) blockOperations.push({ kind: "remove", exerciseSlug: record.slug });
  }
  for (const op of parsed.replaceBlock) {
    const from = getExerciseBySlug(op.fromSlug);
    const to = getExerciseBySlug(op.toSlug);
    if (from && to) {
      blockOperations.push({ kind: "replace", fromSlug: from.slug, toSlug: to.slug });
    }
  }

  // --- Scale hints: LLM → arbitrated with parser/fallback -----------
  const llmReps: ScaleRepsHint | null = parsed.autofillReps
    ? { targetRpe: parsed.autofillReps.targetRpe ?? 8 }
    : null;

  const llmWeights: ScaleWeightsHint | null = parsed.autofillWeights
    ? {
        targetRpe: parsed.autofillWeights.targetRpe ?? 8,
        ...(parsed.autofillWeights.warmupSets !== undefined
          ? { warmupSets: parsed.autofillWeights.warmupSets }
          : {}),
        ...(parsed.autofillWeights.warmupStartPct !== undefined
          ? { warmupStartPct: parsed.autofillWeights.warmupStartPct }
          : {}),
      }
    : null;

  const hasSets = sets.length > 0 || additionalExercises.length > 0;
  const { scaleActiveBlockReps, scaleActiveBlockWeights } =
    mergeScaleSuggestions(message, context, hasSets ? sets : undefined, {
      allowRepsThisTurn: !hasSets && updates.length === 0 && blockOperations.length === 0,
      allowWeightsThisTurn: updates.length === 0 && blockOperations.length === 0,
      llmReps,
      llmWeights,
      fallbackReps: fallback.scaleActiveBlockReps ?? null,
      fallbackWeights: fallback.scaleActiveBlockWeights ?? null,
    });

  // Belt-and-braces: enrich weight-hint with any warmup counts the
  // user mentioned even if the LLM forgot to populate them.
  const enrichedWeights: ScaleWeightsHint | null = (() => {
    if (!scaleActiveBlockWeights) return null;
    if (
      scaleActiveBlockWeights.warmupSets !== undefined &&
      scaleActiveBlockWeights.warmupStartPct !== undefined
    ) {
      return scaleActiveBlockWeights;
    }
    const hints = parseWarmupHints(message);
    return {
      ...scaleActiveBlockWeights,
      ...(scaleActiveBlockWeights.warmupSets === undefined && hints.warmupSets > 0
        ? { warmupSets: hints.warmupSets }
        : {}),
      ...(scaleActiveBlockWeights.warmupStartPct === undefined && hints.warmupSets > 0
        ? { warmupStartPct: hints.warmupStartPct }
        : {}),
    };
  })();

  // --- Exercise options (picker fallback for ambiguous LLM resolves) -
  // When the LLM called log_sets with a slug that doesn't exist, we
  // fall back to the fallback parser's options so the user still gets
  // a picker rather than a silent no-op.
  const exerciseOptions =
    resolvedLogs.length === 0 && fallback.exerciseOptions.length > 0
      ? fallback.exerciseOptions
      : [];

  const autoResolvedExercise =
    resolvedLogs.length > 0
      ? resolvedLogs[0]!.exercise
      : fallback.autoResolvedExercise;

  // When the LLM logged nothing but the fallback parser found sets,
  // fall through to the fallback (offline parity).
  const useFallbackSets =
    resolvedLogs.length === 0 && updates.length === 0 && fallback.sets.length > 0;

  const finalSets = useFallbackSets ? fallback.sets : sets;
  const finalAdditional = useFallbackSets
    ? fallback.additionalExercises ?? []
    : additionalExercises;

  const resetActiveBlockSets =
    primary?.resetExistingSets === true ||
    (useFallbackSets ? Boolean(fallback.resetActiveBlockSets) : false);

  // Help / reply (help takes precedence if both are set).
  const helpExercise = parsed.exerciseHelp
    ? getExerciseBySlug(parsed.exerciseHelp.exerciseSlug)
    : null;
  const exerciseHelp =
    parsed.exerciseHelp && helpExercise
      ? { exerciseSlug: helpExercise.slug, mode: parsed.exerciseHelp.mode }
      : null;

  const replyText = parsed.reply?.text?.trim() || null;

  return {
    exerciseOptions,
    autoResolvedExercise:
      blockOperations.length > 0 ? null : autoResolvedExercise,
    sets: finalSets,
    additionalExercises: blockOperations.length > 0 ? [] : finalAdditional,
    updates:
      updates.length > 0
        ? updates
        : useFallbackSets
          ? []
          : fallback.updates,
    blockOperations,
    resetActiveBlockSets:
      resetActiveBlockSets && blockOperations.length === 0 && finalSets.length > 0,
    scaleActiveBlockReps: blockOperations.length > 0 ? null : scaleActiveBlockReps,
    scaleActiveBlockWeights:
      blockOperations.length > 0 ? null : enrichedWeights,
    suggestedCommonReps:
      fallback.suggestedCommonReps.length > 0
        ? fallback.suggestedCommonReps
        : [],
    suggestedCommonWeights:
      fallback.suggestedCommonWeights.length > 0
        ? fallback.suggestedCommonWeights
        : [],
    userMessage: message,
    reply: exerciseHelp ? null : replyText,
    exerciseHelp,
  };
}

// --------------------------------------------------------------------
// Top-level entry point used by the /api/chat route.
// --------------------------------------------------------------------

export async function runChatAgent(input: {
  message: string;
  context: ChatContext | undefined;
}): Promise<{
  suggestion: ChatSetSuggestion;
  source: "openai" | "fallback";
  detail?: unknown;
}> {
  const { message, context } = input;
  const fallback = parseFallbackSuggestion(message, context);
  const openai = getOpenAIClient();
  if (!openai) {
    return { suggestion: fallback, source: "fallback" };
  }

  try {
    const completion = await openai.responses.create({
      model: OPENAI_CHAT_MODEL,
      input: [
        { role: "system", content: buildSystemPrompt() },
        { role: "system", content: `Chat context:\n${summariseContext(context)}` },
        { role: "user", content: message },
      ],
      // Cast to the Responses API Tool[] — our schemas are authored for
      // non-strict mode (optional fields), which the SDK types don't
      // expose directly.
      tools: CHAT_TOOLS as unknown as Parameters<
        typeof openai.responses.create
      >[0]["tools"],
      tool_choice: "auto",
    });

    const toolCalls = extractToolCalls(completion);
    // No tool calls and no text? Fall back so the user sees something.
    if (toolCalls.length === 0) {
      const freeform = completion.output_text?.trim();
      if (freeform) {
        return {
          suggestion: { ...fallback, reply: freeform },
          source: "openai",
        };
      }
      return { suggestion: fallback, source: "fallback" };
    }

    const suggestion = assembleSuggestion({
      message,
      context,
      toolCalls,
      fallback,
    });
    return { suggestion, source: "openai" };
  } catch (error) {
    const detail =
      error instanceof ZodError ? error.flatten() : "LLM parse failed, fallback used";
    return { suggestion: fallback, source: "fallback", detail };
  }
}

/**
 * Extract tool calls from a Responses API completion.
 *
 * The Responses API surfaces tool invocations on `output` as items with
 * `type === "function_call"`. We pick those out and convert to a
 * simple `{name, arguments}` shape our assembler can consume.
 */
export function extractToolCalls(completion: unknown): ToolCall[] {
  if (!completion || typeof completion !== "object") return [];
  const output = (completion as { output?: unknown }).output;
  if (!Array.isArray(output)) return [];
  const calls: ToolCall[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const typed = item as {
      type?: string;
      name?: string;
      arguments?: unknown;
    };
    if (typed.type !== "function_call") continue;
    if (typeof typed.name !== "string") continue;
    const args =
      typeof typed.arguments === "string"
        ? typed.arguments
        : JSON.stringify(typed.arguments ?? {});
    calls.push({ name: typed.name, arguments: args });
  }
  return calls;
}

// Re-exports so the route / tests don't have to reach into workout-parser.
export { parseFallbackSuggestion, parsePerSetFieldUpdates, parseSets };
