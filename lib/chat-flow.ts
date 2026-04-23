import type {
  BlockOperation,
  ChatSetSuggestion,
  ExerciseRecord,
  SetDetail,
  SetUpdate,
} from "@/lib/types/workout";

/**
 * Pure decision engine for one chat turn. Keeps the page-level async code
 * thin and makes the branching testable.
 *
 * The core invariant we care about: any sets the user has already typed must
 * end up attached to an exercise block. If the current message does not
 * supply one, the sets get BUFFERED and will be applied as soon as a block
 * is created (auto-resolve, picker auto-pick, or a later turn).
 */

export type ChatFlowInput = {
  suggestion: ChatSetSuggestion;
  hasActiveBlock: boolean;
  /** Sets accumulated from previous turns that had no block/exercise yet. */
  bufferedSets: SetDetail[];
};

export type ChatAction =
  | { type: "applyBlockOps"; operations: BlockOperation[] }
  | { type: "applyUpdates"; updates: SetUpdate[] }
  | {
      type: "ensureBlockAndAppend";
      exercise: ExerciseRecord;
      sets: SetDetail[];
      /** When present, emit a "not right? switch to:" picker after logging. */
      switchAlternates?: ExerciseRecord[];
      /**
       * Wipe any existing sets on this block before appending. Set when
       * the user signalled a clean restart (e.g. "okay i'm gonna start
       * at 60kg…") and the block already has sets logged.
       */
      resetSetsBeforeAppend?: boolean;
    }
  | { type: "appendToActiveBlock"; sets: SetDetail[]; resetSetsBeforeAppend?: boolean }
  | { type: "resetActiveBlockSets" }
  | { type: "scaleActiveBlockReps"; targetRpe: number }
  | {
      type: "scaleActiveBlockWeights";
      targetRpe: number;
      warmupSets?: number;
      warmupStartPct?: number;
      /**
       * Which exercise blocks to scale. When omitted, the active block
       * is scaled. When provided (multi-exercise turns like "bench, dips,
       * shoulder press, 2 warmups + 3 working sets"), every named block
       * is scaled so warmup ramps apply uniformly across the turn.
       */
      exerciseSlugs?: string[];
    }
  | {
      type: "showPicker";
      options: ExerciseRecord[];
      pendingSets: SetDetail[];
    }
  | { type: "bufferSets"; sets: SetDetail[] }
  | { type: "reply"; text: string }
  | {
      type: "showExerciseHelp";
      exerciseSlug: string;
      mode: "instructions" | "description";
    };

const MAX_PICKER_OPTIONS = 5;

export function planChatTurn(input: ChatFlowInput): ChatAction[] {
  const { suggestion, hasActiveBlock, bufferedSets } = input;
  const hasSets = suggestion.sets.length > 0;
  const hasUpdates = suggestion.updates.length > 0;
  const hasBlockOps = suggestion.blockOperations.length > 0;
  const hasBuffered = bufferedSets.length > 0;
  const autoExercise = suggestion.autoResolvedExercise;

  const actions: ChatAction[] = [];

  // Exercise help takes priority — it's a conversational side-channel from
  // the AI and should never be combined with logging actions in the same
  // turn.
  if (suggestion.exerciseHelp) {
    actions.push({
      type: "showExerciseHelp",
      exerciseSlug: suggestion.exerciseHelp.exerciseSlug,
      mode: suggestion.exerciseHelp.mode,
    });
    return actions;
  }

  // "Scale the reps for me" — the agent should auto-fill rep counts on
  // every weighted set in the active block using the suggestion-chip
  // algorithm. Only fires when there's actually an active block to
  // operate on; otherwise it falls through to normal handling.
  if (suggestion.scaleActiveBlockReps && hasActiveBlock) {
    actions.push({
      type: "scaleActiveBlockReps",
      targetRpe: suggestion.scaleActiveBlockReps.targetRpe,
    });
    return actions;
  }

  // Same idea, weight axis. Unlike scale-reps this can coexist with
  // sets being created in the same turn (e.g. "bench 5x5 you choose
  // the weight"), so we emit it AFTER any append/ensureBlock actions
  // further down rather than short-circuiting here. We capture it now
  // so each return path knows to tack the scale-weights action on.
  const scaleWeightsHint = suggestion.scaleActiveBlockWeights ?? null;
  const tailScaleWeights = (targetSlugs?: string[]): ChatAction[] => {
    if (!scaleWeightsHint) return [];
    return [
      {
        type: "scaleActiveBlockWeights",
        targetRpe: scaleWeightsHint.targetRpe ?? 8,
        ...(scaleWeightsHint.warmupSets !== undefined
          ? { warmupSets: scaleWeightsHint.warmupSets }
          : {}),
        ...(scaleWeightsHint.warmupStartPct !== undefined
          ? { warmupStartPct: scaleWeightsHint.warmupStartPct }
          : {}),
        ...(targetSlugs && targetSlugs.length > 0
          ? { exerciseSlugs: targetSlugs }
          : {}),
      },
    ];
  };

  if (hasBlockOps) {
    actions.push({
      type: "applyBlockOps",
      operations: suggestion.blockOperations,
    });
    if (!hasSets && !hasUpdates) return actions;
  }

  if (hasUpdates) {
    actions.push({ type: "applyUpdates", updates: suggestion.updates });
  }

  // Additional exercises from a multi-exercise message — each lands in its
  // own block after any primary / auto-resolved logging is emitted below.
  const extraExercises = suggestion.additionalExercises ?? [];

  const wantsReset = Boolean(suggestion.resetActiveBlockSets) && hasSets;

  // Confident exercise match: create/reuse block and log (plus drain any
  // buffered sets from earlier turns).
  if (autoExercise) {
    const sets = [...bufferedSets, ...suggestion.sets];
    actions.push({
      type: "ensureBlockAndAppend",
      exercise: autoExercise,
      sets,
      ...(wantsReset ? { resetSetsBeforeAppend: true } : {}),
    });
    for (const extra of extraExercises) {
      actions.push({
        type: "ensureBlockAndAppend",
        exercise: extra.exercise,
        sets: extra.sets,
      });
    }
    const targetSlugs = [
      autoExercise.slug,
      ...extraExercises.map((e) => e.exercise.slug),
    ];
    actions.push(...tailScaleWeights(targetSlugs));
    return actions;
  }

  // Ambiguous exercise: AI returned candidate options.
  if (suggestion.exerciseOptions.length > 0) {
    const options = suggestion.exerciseOptions.slice(0, MAX_PICKER_OPTIONS);

    // If the user has already supplied set data (now or earlier), don't gate
    // logging behind a click. Auto-pick the top candidate and log immediately,
    // then show a "not right? switch to:" secondary picker.
    if (hasSets || hasUpdates || hasBuffered) {
      const chosen = options[0];
      const sets = [...bufferedSets, ...suggestion.sets];
      const alternates = options.filter((option) => option.slug !== chosen.slug);
      actions.push({
        type: "ensureBlockAndAppend",
        exercise: chosen,
        sets,
        switchAlternates: alternates.length > 0 ? alternates : undefined,
        ...(wantsReset ? { resetSetsBeforeAppend: true } : {}),
      });
      for (const extra of extraExercises) {
        actions.push({
          type: "ensureBlockAndAppend",
          exercise: extra.exercise,
          sets: extra.sets,
        });
      }
      const targetSlugs = [
        chosen.slug,
        ...extraExercises.map((e) => e.exercise.slug),
      ];
      actions.push(...tailScaleWeights(targetSlugs));
      return actions;
    }

    actions.push({ type: "showPicker", options, pendingSets: [] });
    return actions;
  }

  // No primary exercise signal, but the LLM still flagged additional
  // exercises. Log each of them in the order they came in.
  if (extraExercises.length > 0) {
    for (const extra of extraExercises) {
      actions.push({
        type: "ensureBlockAndAppend",
        exercise: extra.exercise,
        sets: extra.sets,
      });
    }
    return actions;
  }

  // Just sets and/or updates — no exercise signal this turn.
  if (hasSets) {
    if (hasActiveBlock) {
      // Drain any buffered sets first (shouldn't normally happen, but stay
      // consistent), then append the new ones.
      const sets = [...bufferedSets, ...suggestion.sets];
      if (wantsReset) {
        actions.push({ type: "resetActiveBlockSets" });
      }
      actions.push({ type: "appendToActiveBlock", sets });
      actions.push(...tailScaleWeights());
      return actions;
    }

    // No active block, no exercise signal — hold onto these sets until the
    // user names an exercise in a later turn.
    actions.push({ type: "bufferSets", sets: suggestion.sets });
    actions.push({
      type: "reply",
      text: "Which exercise is this for? Send the name and I'll start a new block.",
    });
    return actions;
  }

  // Standalone "suggest the weights" against an existing active block.
  if (
    !hasUpdates &&
    !hasBlockOps &&
    scaleWeightsHint !== null &&
    hasActiveBlock
  ) {
    actions.push(...tailScaleWeights());
    return actions;
  }

  // Only updates (or nothing). If updates succeeded the page emits a message
  // of its own; otherwise we fall through to either the AI's conversational
  // reply (for off-topic / question messages) or a generic clarification.
  if (!hasUpdates && !hasBlockOps) {
    const aiReply = suggestion.reply?.trim();
    actions.push({
      type: "reply",
      text:
        aiReply && aiReply.length > 0
          ? aiReply
          : "I could not match any exercise or parse any sets. Try something like `bench press` or `5 reps 100kg`.",
    });
  }

  return actions;
}
