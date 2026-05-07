import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import { rankExercisesForQuery } from "@/lib/exercises";
import type { ChatContextSnapshot, ChatSetSuggestion } from "@/lib/types/workout";
import { emptyChatSuggestion } from "@/lib/workout-chat/empty-suggestion";
import {
  chatSuggestionFromDeterministicTurn,
  mergeSanitizedEditIntoWorkout,
} from "@/lib/workout-chat/deterministic-suggestion-apply";
import {
  tryDeterministicChatTurn,
} from "@/lib/workout-chat/intent-rules";
import { decomposeUserMessage } from "@/lib/workout-chat/decomposer";
import {
  primitivesToXml,
  type Primitive,
} from "@/lib/workout-chat/primitive-builders";
import {
  buildAllowedExerciseSlugs,
  buildCleanPreviousWorkoutXml,
  buildOrderedExerciseSlugHints,
  extractCurrentExerciseSlug,
  extractExerciseQueryFromMessage,
  isGreetingOrChatOnly,
  pickLikelyExerciseSlug,
  previousWorkoutXmlHasSets,
  workoutXmlToSuggestion,
} from "@/lib/workout-chat/workout-xml";
import { logChatTurnTelemetry } from "@/lib/workout-chat/turn-telemetry";

export type WorkoutChatSource = "webllm" | "deterministic" | "fallback";

function applyPrimitives(params: {
  primitives: Primitive[];
  message: string;
  previousXml: string;
  allowedExerciseSlugs: string[];
  currentExerciseSlug: string;
  ranks: ReturnType<typeof rankExercisesForQuery>;
  defaultUnit: "kg" | "lb";
}): ChatSetSuggestion | null {
  const built = primitivesToXml(params.primitives, {
    previousXml: params.previousXml,
    defaultUnit: params.defaultUnit,
  });

  // Apply log_new (full workout) first, then chain edits onto its result.
  let cursorXml = params.previousXml;
  if (built.workoutXml) {
    cursorXml = built.workoutXml;
  }
  if (built.editXml) {
    const merged = mergeSanitizedEditIntoWorkout({
      previousXml: cursorXml,
      editXml: built.editXml,
      allowedExerciseSlugs: params.allowedExerciseSlugs,
      currentExerciseSlug: params.currentExerciseSlug,
    });
    if (!merged) return null;
    cursorXml = merged;
  }

  // No primitive produced any XML (all noops) — preserve previous state.
  if (!built.workoutXml && !built.editXml) return null;

  return workoutXmlToSuggestion({
    rawModelOutput: cursorXml,
    userMessage: params.message,
    ranks: params.ranks,
    defaultUnit: params.defaultUnit,
    fullRepair: true,
  });
}

export async function runXmlWorkoutChat(
  engine: MLCEngineInterface,
  input: {
    message: string;
    context: ChatContextSnapshot | undefined;
    /** Fallback unit when XML / rules omit `u=`; should match user display preference. */
    defaultWeightUnit?: "kg" | "lb";
  },
): Promise<{ suggestion: ChatSetSuggestion; source: WorkoutChatSource }> {
  const { message, context } = input;
  const defaultUnit = input.defaultWeightUnit ?? "kg";

  logChatTurnTelemetry("input", {
    messagePreview: message.slice(0, 120),
    messageLength: message.length,
    hasContext: Boolean(context),
    blockCount: context?.blocks?.length ?? 0,
  });

  if (isGreetingOrChatOnly(message)) {
    const s = emptyChatSuggestion(message, null);
    return {
      suggestion: {
        ...s,
        reply:
          message.trim().length > 0
            ? "Say a lift and prescription when you're ready—for example bench 5x5 100kg."
            : s.reply,
      },
      source: "fallback",
    };
  }

  const previousXml = buildCleanPreviousWorkoutXml(context, defaultUnit);
  const hasExistingSets = previousWorkoutXmlHasSets(previousXml);
  const currentExerciseSlug = extractCurrentExerciseSlug(previousXml);
  const likelyExerciseSlug =
    currentExerciseSlug || pickLikelyExerciseSlug(context);

  const query = extractExerciseQueryFromMessage(message);
  const ranks = rankExercisesForQuery(query, 5);

  const exerciseSlugHints = buildOrderedExerciseSlugHints(
    likelyExerciseSlug,
    ranks,
    hasExistingSets,
    message,
  );
  const allowedExerciseSlugs = buildAllowedExerciseSlugs(exerciseSlugHints);

  // ── Layer 1: deterministic regex ───────────────────────────────────────────
  const det = tryDeterministicChatTurn({
    message,
    previousXml,
    hasActiveBlock: hasExistingSets,
    currentExerciseSlug,
    defaultUnit,
  });
  if (det) {
    const suggestion = chatSuggestionFromDeterministicTurn({
      result: det,
      message,
      previousXml,
      allowedExerciseSlugs,
      currentExerciseSlug,
      ranks,
      defaultUnit,
    });
    if (suggestion) {
      logChatTurnTelemetry("deterministic-hit", {
        ruleId: det.ruleId,
        kind: det.kind,
      });
      return { suggestion, source: "deterministic" };
    }
    logChatTurnTelemetry("deterministic-miss", {
      ruleId: det.ruleId,
      reason: "post-apply rejected; falling through to decomposer",
    });
  } else {
    logChatTurnTelemetry("deterministic-miss", { reason: "no rule matched" });
  }

  // ── Layer 2: LLM decomposer (narrow JSON) ──────────────────────────────────
  logChatTurnTelemetry("llm-request", {
    likelyExerciseSlug,
    allowedSlugCount: allowedExerciseSlugs.length,
  });

  let decomposed: Awaited<ReturnType<typeof decomposeUserMessage>>;
  try {
    decomposed = await decomposeUserMessage({
      engine,
      message,
      previousXml,
      likelyExerciseSlug,
      allowedSlugs: allowedExerciseSlugs,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 200) : String(err);
    logChatTurnTelemetry("llm-error", { reason });
    return {
      suggestion: emptyChatSuggestion(
        message,
        "Something went wrong reading that turn—try again.",
      ),
      source: "webllm",
    };
  }

  if (!decomposed || decomposed.primitives.length === 0) {
    logChatTurnTelemetry("llm-error", {
      reason: "decomposer returned no usable primitives",
    });
    return {
      suggestion: emptyChatSuggestion(
        message,
        "I could not read that one. Try saying the lift, sets and reps directly — e.g. 'bench 5x5 100kg'.",
      ),
      source: "webllm",
    };
  }

  logChatTurnTelemetry("llm-extracted", {
    count: decomposed.primitives.length,
    types: decomposed.primitives.map((p) => p.type).join(","),
  });

  // All-noop primitives: nothing to apply, surface a conversational reply.
  const everyNoop = decomposed.primitives.every((p) => p.type === "noop");
  if (everyNoop) {
    return {
      suggestion: emptyChatSuggestion(
        message,
        "I didn't see a concrete change in that — try giving a number (e.g. '+5kg' or 'one more').",
      ),
      source: "webllm",
    };
  }

  const suggestion = applyPrimitives({
    primitives: decomposed.primitives,
    message,
    previousXml,
    allowedExerciseSlugs,
    currentExerciseSlug,
    ranks,
    defaultUnit,
  });

  if (!suggestion) {
    logChatTurnTelemetry("llm-error", {
      reason: "applyPrimitives produced nothing",
    });
    return {
      suggestion: emptyChatSuggestion(
        message,
        "I parsed your message but couldn't apply it. Try rephrasing.",
      ),
      source: "webllm",
    };
  }

  logChatTurnTelemetry("llm-final-suggestion", {
    hasAuto: Boolean(suggestion.autoResolvedExercise),
    setCount: suggestion.sets.length,
    updateCount: suggestion.updates.length,
  });

  return { suggestion, source: "webllm" };
}

/**
 * Workout chat: deterministic-first dispatcher with LLM-decomposer fallback.
 * Every applied edit comes from a typed primitive, never freeform XML.
 */
export async function runWorkoutChatDraft(
  engine: MLCEngineInterface,
  input: {
    message: string;
    context: ChatContextSnapshot | undefined;
    defaultWeightUnit?: "kg" | "lb";
  },
): Promise<{
  suggestion: ChatSetSuggestion;
  source: WorkoutChatSource;
  detail?: unknown;
}> {
  try {
    const { suggestion, source } = await runXmlWorkoutChat(engine, input);
    return { suggestion, source };
  } catch (error) {
    return {
      suggestion: emptyChatSuggestion(
        input.message,
        "Something went wrong reading that turn—try again.",
      ),
      source: "fallback",
      detail: error,
    };
  }
}
