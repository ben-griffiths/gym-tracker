import type { ChatSetSuggestion } from "@/lib/types/workout";

const COMMON_REPS = [5, 8, 10, 12];
const COMMON_WEIGHTS = [20, 30, 40, 50];

/** Neutral chat suggestion used when XML/deterministic paths cannot produce a plan. */
export function emptyChatSuggestion(
  message: string,
  reply: string | null,
): ChatSetSuggestion {
  return {
    exerciseOptions: [],
    autoResolvedExercise: null,
    sets: [],
    additionalExercises: [],
    updates: [],
    blockOperations: [],
    resetActiveBlockSets: false,
    scaleActiveBlockReps: null,
    scaleActiveBlockWeights: null,
    suggestedCommonReps: COMMON_REPS,
    suggestedCommonWeights: COMMON_WEIGHTS,
    userMessage: message,
    reply,
    exerciseHelp: null,
  };
}
