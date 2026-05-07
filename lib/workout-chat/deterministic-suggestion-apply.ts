import { rankExercisesForQuery } from "@/lib/exercises";
import type { ChatSetSuggestion, WeightUnit } from "@/lib/types/workout";
import {
  applyWorkoutEditXml,
  sanitizeEditXml,
} from "@/lib/workout-chat/workout-edit-xml";
import type { DeterministicTurnResult } from "@/lib/workout-chat/intent-rules";
import {
  sanitizeWorkoutXml,
  workoutXmlToSuggestion,
} from "@/lib/workout-chat/workout-xml";

/** Merge a sanitized `<edit>` into previous workout XML; returns merged `<workout>` or null. */
export function mergeSanitizedEditIntoWorkout(
  params: {
    previousXml: string;
    editXml: string;
    allowedExerciseSlugs: string[];
    currentExerciseSlug: string;
  }
): string | null {
  const sanitized = sanitizeEditXml(params.editXml, {
    allowedExerciseSlugs: params.allowedExerciseSlugs,
  });
  if (!sanitized) return null;
  const merged = applyWorkoutEditXml({
    previousXml: params.previousXml,
    editXml: sanitized,
    allowedExerciseSlugs: params.allowedExerciseSlugs,
  });
  if (!merged) return null;
  const sanitizedMerged = sanitizeWorkoutXml(merged, {
    allowedExerciseSlugs: params.allowedExerciseSlugs,
    previousXml: params.previousXml,
    preferredExerciseSlug: params.currentExerciseSlug || undefined,
  });
  if (!sanitizedMerged || !/<s\b/i.test(sanitizedMerged)) return null;
  return sanitizedMerged;
}

export function chatSuggestionFromDeterministicTurn(params: {
  result: DeterministicTurnResult;
  message: string;
  previousXml: string;
  allowedExerciseSlugs: string[];
  currentExerciseSlug: string;
  ranks: ReturnType<typeof rankExercisesForQuery>;
  defaultUnit: WeightUnit;
}): ChatSetSuggestion | null {
  if (params.result.kind === "workout") {
    return workoutXmlToSuggestion({
      rawModelOutput: params.result.workoutXml,
      userMessage: params.message,
      ranks: params.ranks,
      defaultUnit: params.defaultUnit,
      fullRepair: true,
    });
  }
  const sanitized = mergeSanitizedEditIntoWorkout({
    previousXml: params.previousXml,
    editXml: params.result.editXml,
    allowedExerciseSlugs: params.allowedExerciseSlugs,
    currentExerciseSlug: params.currentExerciseSlug,
  });
  if (!sanitized) return null;
  return workoutXmlToSuggestion({
    rawModelOutput: sanitized,
    userMessage: params.message,
    ranks: params.ranks,
    defaultUnit: params.defaultUnit,
    fullRepair: true,
  });
}
