import { rankExercisesForQuery } from "@/lib/exercises";
import type {
  ChatContextSnapshot,
  ChatSetSuggestion,
  WorkoutChatLocalParse,
} from "@/lib/types/workout";
import { emptyChatSuggestion } from "@/lib/workout-chat/empty-suggestion";
import { chatSuggestionFromDeterministicTurn } from "@/lib/workout-chat/deterministic-suggestion-apply";
import { tryDeterministicChatTurn } from "@/lib/workout-chat/intent-rules";
import {
  buildAllowedExerciseSlugs,
  buildCleanPreviousWorkoutXml,
  buildOrderedExerciseSlugHints,
  extractCurrentExerciseSlug,
  extractExerciseQueryFromMessage,
  isGreetingOrChatOnly,
  pickLikelyExerciseSlug,
  previousWorkoutXmlHasSets,
} from "@/lib/workout-chat/workout-xml";
import { logChatTurnTelemetry } from "@/lib/workout-chat/turn-telemetry";

function attachLocalParse(
  suggestion: ChatSetSuggestion,
  meta: Omit<WorkoutChatLocalParse, "skippedLlm">,
): ChatSetSuggestion {
  const localParse: WorkoutChatLocalParse = {
    skippedLlm: true,
    ...meta,
  };
  return { ...suggestion, localParse };
}

/**
 * Browser workout chat path that needs no on-device LLM: greetings,
 * deterministic regex rules in {@link tryDeterministicChatTurn}, or
 * unambiguous log-new XML. Returns null when the WebLLM decomposer is required.
 */
export function tryWorkoutChatLocalFastPath(input: {
  message: string;
  context: ChatContextSnapshot | undefined;
  /** True when the draft was built using only suggestion-chip inserts this turn (no manual typing). */
  usedSuggestions?: boolean;
  defaultWeightUnit?: "kg" | "lb";
}): ChatSetSuggestion | null {
  const { message, context } = input;
  const usedSuggestions = input.usedSuggestions === true;
  const defaultUnit = input.defaultWeightUnit ?? "kg";

  if (isGreetingOrChatOnly(message)) {
    const s = emptyChatSuggestion(message, null);
    const reply =
      message.trim().length > 0
        ? "Say a lift and prescription when you're ready—for example bench 5x5 100kg."
        : s.reply;
    logChatTurnTelemetry("deterministic-hit", {
      ruleId: "greeting-or-chat-only",
      kind: "fallback",
    });
    return { ...s, reply };
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

  const det = tryDeterministicChatTurn({
    message,
    previousXml,
    hasActiveBlock: hasExistingSets,
    currentExerciseSlug,
    defaultUnit,
  });

  if (!det) {
    logChatTurnTelemetry("deterministic-miss", { reason: "no rule matched" });
    return null;
  }

  const suggestion = chatSuggestionFromDeterministicTurn({
    result: det,
    message,
    previousXml,
    allowedExerciseSlugs,
    currentExerciseSlug,
    ranks,
    defaultUnit,
  });

  if (!suggestion) {
    logChatTurnTelemetry("deterministic-miss", {
      ruleId: det.ruleId,
      reason: "post-apply rejected; need LLM path",
    });
    return null;
  }

  logChatTurnTelemetry("deterministic-hit", {
    ruleId: det.ruleId,
    kind: det.kind,
  });

  const kind = usedSuggestions ? "suggest" : "regex";
  return attachLocalParse(suggestion, {
    kind,
    matchedPattern: det.ruleId,
    usedSuggestions: usedSuggestions || undefined,
  });
}
