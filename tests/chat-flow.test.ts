import { describe, expect, it } from "vitest";
import { planChatTurn, type ChatAction } from "../lib/chat-flow";
import type {
  ChatSetSuggestion,
  ExerciseRecord,
  SetDetail,
} from "../lib/types/workout";

const BENCH_PRESS: ExerciseRecord = {
  slug: "bench-press",
  name: "Bench Press",
  category: "Barbell",
  iconPath: "/exercises/icons/bench-press.png",
  pageUrl: "https://example.com/bench-press",
  guide: null,
};

const SHOULDER_PRESS: ExerciseRecord = {
  slug: "shoulder-press",
  name: "Shoulder Press",
  category: "Barbell",
  iconPath: "/exercises/icons/shoulder-press.png",
  pageUrl: "https://example.com/shoulder-press",
  guide: null,
};

const MILITARY_PRESS: ExerciseRecord = {
  slug: "military-press",
  name: "Military Press",
  category: "Barbell",
  iconPath: "/exercises/icons/military-press.png",
  pageUrl: "https://example.com/military-press",
  guide: null,
};

const SQUAT: ExerciseRecord = {
  slug: "squat",
  name: "Squat",
  category: "Barbell",
  iconPath: "/exercises/icons/squat.png",
  pageUrl: "https://example.com/squat",
  guide: null,
};

const DEADLIFT: ExerciseRecord = {
  slug: "deadlift",
  name: "Deadlift",
  category: "Barbell",
  iconPath: "/exercises/icons/deadlift.png",
  pageUrl: "https://example.com/deadlift",
  guide: null,
};

function makeSuggestion(
  overrides: Partial<ChatSetSuggestion> = {},
): ChatSetSuggestion {
  return {
    exerciseOptions: [],
    autoResolvedExercise: null,
    sets: [],
    updates: [],
    blockOperations: [],
    suggestedCommonReps: [],
    suggestedCommonWeights: [],
    userMessage: "",
    ...overrides,
  };
}

function setsOf(count: number, reps = 5, weight = 100): SetDetail[] {
  return Array.from({ length: count }, (_value, index) => ({
    setNumber: index + 1,
    reps,
    weight,
    weightUnit: "kg" as const,
  }));
}

describe("planChatTurn", () => {
  describe("buffering sets without an exercise", () => {
    it("buffers sets and prompts for an exercise when there is no active block", () => {
      // User: "100kg 5 reps 10 sets"
      const actions = planChatTurn({
        suggestion: makeSuggestion({ sets: setsOf(10) }),
        hasActiveBlock: false,
        bufferedSets: [],
      });

      expect(actions).toEqual<ChatAction[]>([
        { type: "bufferSets", sets: setsOf(10) },
        {
          type: "reply",
          text: "Which exercise is this for? Send the name and I'll start a new block.",
        },
      ]);
    });

    it("drains buffered sets when the next turn auto-resolves an exercise", () => {
      // Follow-up turn: user says "bench press" (no new sets).
      // Server auto-resolves Bench Press. The 10 buffered sets MUST land on
      // the new block — that's the bug the user reported.
      const buffered = setsOf(10);
      const actions = planChatTurn({
        suggestion: makeSuggestion({ autoResolvedExercise: BENCH_PRESS }),
        hasActiveBlock: false,
        bufferedSets: buffered,
      });

      expect(actions).toEqual<ChatAction[]>([
        {
          type: "ensureBlockAndAppend",
          exercise: BENCH_PRESS,
          sets: buffered,
        },
      ]);
    });

    it("drains buffered sets via the auto-pick picker path when the exercise is ambiguous", () => {
      // User buffered 3 sets earlier. Now types "overhead press" (ambiguous).
      // Expect auto-pick + log + switch picker.
      const buffered = setsOf(3, 10, 40);
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          exerciseOptions: [SHOULDER_PRESS, MILITARY_PRESS],
        }),
        hasActiveBlock: false,
        bufferedSets: buffered,
      });

      expect(actions).toEqual<ChatAction[]>([
        {
          type: "ensureBlockAndAppend",
          exercise: SHOULDER_PRESS,
          sets: buffered,
          switchAlternates: [MILITARY_PRESS],
        },
      ]);
    });

    it("merges buffered sets with same-turn sets when a block is created", () => {
      // User buffered 2 sets, then types "bench press 60kg 3x8".
      const buffered = setsOf(2, 5, 100);
      const fresh = setsOf(3, 8, 60);
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          autoResolvedExercise: BENCH_PRESS,
          sets: fresh,
        }),
        hasActiveBlock: false,
        bufferedSets: buffered,
      });

      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        type: "ensureBlockAndAppend",
        exercise: BENCH_PRESS,
      });
      const [first] = actions;
      if (first.type !== "ensureBlockAndAppend") throw new Error("wrong type");
      expect(first.sets).toHaveLength(5);
    });
  });

  describe("sets with an active block", () => {
    it("appends sets to the active block without prompting", () => {
      const actions = planChatTurn({
        suggestion: makeSuggestion({ sets: setsOf(3, 8, 60) }),
        hasActiveBlock: true,
        bufferedSets: [],
      });

      expect(actions).toEqual<ChatAction[]>([
        { type: "appendToActiveBlock", sets: setsOf(3, 8, 60) },
      ]);
    });
  });

  describe("exercise-only messages", () => {
    it("shows a plain picker when the exercise is ambiguous and nothing is buffered", () => {
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          exerciseOptions: [SHOULDER_PRESS, MILITARY_PRESS],
        }),
        hasActiveBlock: false,
        bufferedSets: [],
      });

      expect(actions).toEqual<ChatAction[]>([
        {
          type: "showPicker",
          options: [SHOULDER_PRESS, MILITARY_PRESS],
          pendingSets: [],
        },
      ]);
    });

    it("creates a block without sets when the exercise is unambiguous", () => {
      const actions = planChatTurn({
        suggestion: makeSuggestion({ autoResolvedExercise: BENCH_PRESS }),
        hasActiveBlock: false,
        bufferedSets: [],
      });

      expect(actions).toEqual<ChatAction[]>([
        { type: "ensureBlockAndAppend", exercise: BENCH_PRESS, sets: [] },
      ]);
    });
  });

  describe("auto-pick flow (sets + ambiguous exercise in one turn)", () => {
    it("auto-picks the top option and emits switch alternates", () => {
      // User: "overhead press 40kg 3x10"
      const sets = setsOf(3, 10, 40);
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          exerciseOptions: [SHOULDER_PRESS, MILITARY_PRESS],
          sets,
        }),
        hasActiveBlock: false,
        bufferedSets: [],
      });

      expect(actions).toEqual<ChatAction[]>([
        {
          type: "ensureBlockAndAppend",
          exercise: SHOULDER_PRESS,
          sets,
          switchAlternates: [MILITARY_PRESS],
        },
      ]);
    });
  });

  describe("multi-exercise turns", () => {
    it("emits a block-append per exercise when the user logs two lifts in one message", () => {
      // User: "squat 160kg 1 rep, deadlift 200kg 1 rep"
      const squatSet: SetDetail[] = [
        { setNumber: 1, reps: 1, weight: 160, weightUnit: "kg" },
      ];
      const deadliftSet: SetDetail[] = [
        { setNumber: 1, reps: 1, weight: 200, weightUnit: "kg" },
      ];
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          autoResolvedExercise: SQUAT,
          sets: squatSet,
          additionalExercises: [{ exercise: DEADLIFT, sets: deadliftSet }],
        }),
        hasActiveBlock: false,
        bufferedSets: [],
      });

      expect(actions).toEqual<ChatAction[]>([
        { type: "ensureBlockAndAppend", exercise: SQUAT, sets: squatSet },
        { type: "ensureBlockAndAppend", exercise: DEADLIFT, sets: deadliftSet },
      ]);
    });

    it("still emits the additional block when the primary exercise was ambiguous and auto-picked", () => {
      const overheadSets = setsOf(3, 10, 40);
      const deadliftSet: SetDetail[] = [
        { setNumber: 1, reps: 5, weight: 200, weightUnit: "kg" },
      ];
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          exerciseOptions: [SHOULDER_PRESS, MILITARY_PRESS],
          sets: overheadSets,
          additionalExercises: [{ exercise: DEADLIFT, sets: deadliftSet }],
        }),
        hasActiveBlock: false,
        bufferedSets: [],
      });

      expect(actions).toEqual<ChatAction[]>([
        {
          type: "ensureBlockAndAppend",
          exercise: SHOULDER_PRESS,
          sets: overheadSets,
          switchAlternates: [MILITARY_PRESS],
        },
        { type: "ensureBlockAndAppend", exercise: DEADLIFT, sets: deadliftSet },
      ]);
    });

    it("logs additional exercises even when the primary exercise signal is missing", () => {
      const deadliftSet: SetDetail[] = [
        { setNumber: 1, reps: 3, weight: 180, weightUnit: "kg" },
      ];
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          additionalExercises: [{ exercise: DEADLIFT, sets: deadliftSet }],
        }),
        hasActiveBlock: false,
        bufferedSets: [],
      });

      expect(actions).toEqual<ChatAction[]>([
        { type: "ensureBlockAndAppend", exercise: DEADLIFT, sets: deadliftSet },
      ]);
    });
  });

  describe("reset active block sets", () => {
    it("flags resetSetsBeforeAppend on ensureBlockAndAppend when the auto-resolved exercise is a fresh start", () => {
      const ramp = setsOf(4, 0, 60).map((set, index) => ({
        ...set,
        weight: [60, 80, 100, 115][index] ?? 60,
        reps: null,
      }));
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          autoResolvedExercise: BENCH_PRESS,
          sets: ramp,
          resetActiveBlockSets: true,
        }),
        hasActiveBlock: true,
        bufferedSets: [],
      });

      expect(actions).toEqual<ChatAction[]>([
        {
          type: "ensureBlockAndAppend",
          exercise: BENCH_PRESS,
          sets: ramp,
          resetSetsBeforeAppend: true,
        },
      ]);
    });

    it("emits a standalone resetActiveBlockSets action when only sets (no exercise) are supplied with the reset flag", () => {
      const ramp = [
        { setNumber: 1, reps: null, weight: 60, weightUnit: "kg" as const },
        { setNumber: 2, reps: null, weight: 80, weightUnit: "kg" as const },
        { setNumber: 3, reps: null, weight: 100, weightUnit: "kg" as const },
        { setNumber: 4, reps: null, weight: 115, weightUnit: "kg" as const },
      ];
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          sets: ramp,
          resetActiveBlockSets: true,
        }),
        hasActiveBlock: true,
        bufferedSets: [],
      });

      expect(actions).toEqual<ChatAction[]>([
        { type: "resetActiveBlockSets" },
        { type: "appendToActiveBlock", sets: ramp },
      ]);
    });

    it("emits scaleActiveBlockReps when the suggestion carries the flag and a block is active", () => {
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          scaleActiveBlockReps: { targetRpe: 8 },
        }),
        hasActiveBlock: true,
        bufferedSets: [],
      });
      expect(actions).toEqual<ChatAction[]>([
        { type: "scaleActiveBlockReps", targetRpe: 8 },
      ]);
    });

    it("ignores scaleActiveBlockReps when there is no active block", () => {
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          scaleActiveBlockReps: { targetRpe: 8 },
        }),
        hasActiveBlock: false,
        bufferedSets: [],
      });
      expect(
        actions.some((action) => action.type === "scaleActiveBlockReps"),
      ).toBe(false);
    });

    it("ignores the reset flag when there is no active block", () => {
      const ramp = setsOf(2, 5, 60);
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          sets: ramp,
          resetActiveBlockSets: true,
        }),
        hasActiveBlock: false,
        bufferedSets: [],
      });

      // Falls through to the bufferSets path — no exercise, no active block.
      expect(actions[0]).toMatchObject({ type: "bufferSets" });
    });

    it("targets the scale-weights action at EVERY block in a multi-exercise turn", () => {
      // Regression for "bench press, dips, shoulder press, 2 warmup sets,
      // 3 working sets at 5 reps" — previously only the active (last)
      // block got warmup-scaled, leaving bench and dips untouched.
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          autoResolvedExercise: BENCH_PRESS,
          sets: setsOf(5, 5, 0),
          additionalExercises: [
            { exercise: SQUAT, sets: setsOf(5, 5, 0) },
            { exercise: DEADLIFT, sets: setsOf(5, 5, 0) },
          ],
          scaleActiveBlockWeights: {
            targetRpe: 8,
            warmupSets: 2,
            warmupStartPct: 0.3,
          },
        }),
        hasActiveBlock: false,
        bufferedSets: [],
      });

      const scale = actions.find(
        (action): action is Extract<ChatAction, { type: "scaleActiveBlockWeights" }> =>
          action.type === "scaleActiveBlockWeights",
      );
      expect(scale).toBeDefined();
      expect(scale?.exerciseSlugs).toEqual([
        "bench-press",
        "squat",
        "deadlift",
      ]);
      expect(scale?.warmupSets).toBe(2);
      expect(scale?.warmupStartPct).toBe(0.3);
    });

    it("omits exerciseSlugs for single-block scale-weights turns (fallback to active block)", () => {
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          scaleActiveBlockWeights: { targetRpe: 8 },
        }),
        hasActiveBlock: true,
        bufferedSets: [],
      });

      expect(actions).toEqual<ChatAction[]>([
        { type: "scaleActiveBlockWeights", targetRpe: 8 },
      ]);
    });
  });

  describe("block operations", () => {
    it("applies block ops and returns early when no sets/updates follow", () => {
      const actions = planChatTurn({
        suggestion: makeSuggestion({
          blockOperations: [{ kind: "remove", exerciseSlug: "bench-press" }],
        }),
        hasActiveBlock: true,
        bufferedSets: [],
      });

      expect(actions).toEqual<ChatAction[]>([
        {
          type: "applyBlockOps",
          operations: [{ kind: "remove", exerciseSlug: "bench-press" }],
        },
      ]);
    });
  });
});
