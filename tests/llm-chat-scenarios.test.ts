import { describe, expect, it } from "vitest";
import { assembleSuggestion } from "../lib/chat-agent";
import { planChatTurn, type ChatAction } from "../lib/chat-flow";
import { getExerciseBySlug, searchExercises } from "../lib/exercises";
import { parseFallbackSuggestion } from "../lib/workout-parser";
import type { ChatSetSuggestion } from "../lib/types/workout";

const emptyFallback = parseFallbackSuggestion("");

function suggestionFromTools(
  message: string,
  toolCalls: { name: string; arguments: string }[],
  fallback: ChatSetSuggestion = emptyFallback,
) {
  return assembleSuggestion({ message, context: undefined, toolCalls, fallback });
}

describe("catalog search (local parser + LLM slug resolution)", () => {
  it('ranks "bench" to bench-press first', () => {
    expect(searchExercises("bench", 1)[0]?.slug).toBe("bench-press");
  });
});

describe("parseFallbackSuggestion (no WebLLM)", () => {
  it('resolves "bench 5 sets of 5" to bench-press, not bench-dips', () => {
    const s = parseFallbackSuggestion("bench 5 sets of 5");
    expect(s.autoResolvedExercise?.slug).toBe("bench-press");
    expect(s.sets).toHaveLength(5);
  });

  it('parses "bench 5x5 100kg" to bench-press with filled sets', () => {
    const s = parseFallbackSuggestion("bench 5x5 100kg");
    expect(s.autoResolvedExercise?.slug).toBe("bench-press");
    expect(s.sets).toHaveLength(5);
    expect(s.sets[0]).toMatchObject({ reps: 5, weight: 100, weightUnit: "kg" });
  });
});

/**
 * These mirror what WebLLM should emit via `log_sets` / other tools. They
 * guard client assembly when the model returns structured tool calls.
 */
describe("assembleSuggestion from simulated LLM tool calls", () => {
  it("coerces log_sets bench-dips to bench-press when the user only said bench", () => {
    const s = suggestionFromTools("bench 5 sets of 5", [
      {
        name: "log_sets",
        arguments: JSON.stringify({
          exerciseSlug: "bench-dips",
          sets: Array.from({ length: 5 }, () => ({
            reps: null,
            weight: null,
            weightUnit: "kg",
          })),
        }),
      },
    ]);
    expect(s.autoResolvedExercise?.slug).toBe("bench-press");
    expect(s.sets).toHaveLength(5);
  });

  it("leaves bench-dips when the user explicitly said dips", () => {
    const s = suggestionFromTools("bench dips 3x8", [
      {
        name: "log_sets",
        arguments: JSON.stringify({
          exerciseSlug: "bench-dips",
          sets: Array.from({ length: 3 }, () => ({
            reps: 8,
            weight: null,
            weightUnit: "kg",
          })),
        }),
      },
    ]);
    expect(s.autoResolvedExercise?.slug).toBe("bench-dips");
  });

  it("accepts a correct bench-press slug from the model", () => {
    const s = suggestionFromTools("bench press 3x5 at 100kg", [
      {
        name: "log_sets",
        arguments: JSON.stringify({
          exerciseSlug: "bench-press",
          sets: Array.from({ length: 3 }, () => ({
            reps: 5,
            weight: 100,
            weightUnit: "kg",
          })),
        }),
      },
    ]);
    expect(s.autoResolvedExercise?.slug).toBe("bench-press");
    expect(s.sets[0]).toMatchObject({ reps: 5, weight: 100 });
  });

  it("logs squat and deadlift in one turn (two log_sets calls)", () => {
    const s = suggestionFromTools("squat 3x5 140, deadlift 1x5 200", [
      {
        name: "log_sets",
        arguments: JSON.stringify({
          exerciseSlug: "squat",
          sets: Array.from({ length: 3 }, () => ({
            reps: 5,
            weight: 140,
            weightUnit: "kg",
          })),
        }),
      },
      {
        name: "log_sets",
        arguments: JSON.stringify({
          exerciseSlug: "deadlift",
          sets: [
            { reps: 5, weight: 200, weightUnit: "kg" },
          ],
        }),
      },
    ]);
    expect(s.autoResolvedExercise?.slug).toBe("squat");
    expect(s.sets).toHaveLength(3);
    expect(s.additionalExercises?.[0]?.exercise.slug).toBe("deadlift");
  });

  it("returns conversational reply from the reply tool", () => {
    const s = suggestionFromTools("how much rest between sets?", [
      {
        name: "reply",
        arguments: JSON.stringify({
          text: "Rest 2–3 minutes for heavy compound sets.",
        }),
      },
    ]);
    expect(s.reply).toBe("Rest 2–3 minutes for heavy compound sets.");
    expect(s.sets).toHaveLength(0);
  });

  it("parses show_exercise_help for squat instructions", () => {
    const s = suggestionFromTools("how do I squat", [
      {
        name: "show_exercise_help",
        arguments: JSON.stringify({
          exerciseSlug: "squat",
          mode: "instructions",
        }),
      },
    ]);
    expect(s.exerciseHelp).toEqual({
      exerciseSlug: "squat",
      mode: "instructions",
    });
    expect(s.reply).toBeNull();
  });
});

describe("planChatTurn with LLM-shaped suggestions", () => {
  function makeBase(overrides: Partial<ChatSetSuggestion>): ChatSetSuggestion {
    return {
      exerciseOptions: [],
      autoResolvedExercise: null,
      sets: [],
      updates: [],
      blockOperations: [],
      suggestedCommonReps: [5, 8, 10],
      suggestedCommonWeights: [20, 40, 60],
      userMessage: "",
      ...overrides,
    };
  }

  it("auto-picks bench-press for buffered sets when options list leads with bench-press", () => {
    const bench = getExerciseBySlug("bench-press");
    if (!bench) throw new Error("catalog missing bench-press");
    const options = searchExercises("bench", 5);
    expect(options[0]?.slug).toBe("bench-press");

    const actions = planChatTurn({
      suggestion: makeBase({
        userMessage: "bench 5 sets of 5",
        exerciseOptions: options,
        sets: Array.from({ length: 5 }, (_v, i) => ({
          setNumber: i + 1,
          reps: null,
          weight: null,
          weightUnit: "kg" as const,
        })),
      }),
      hasActiveBlock: false,
      bufferedSets: [],
    });
    const ensure = actions.find(
      (a): a is Extract<ChatAction, { type: "ensureBlockAndAppend" }> =>
        a.type === "ensureBlockAndAppend",
    );
    expect(ensure?.exercise.slug).toBe("bench-press");
  });

  it("uses neutral nudge copy when there is no reply and no workout (no error phrasing)", () => {
    const actions = planChatTurn({
      suggestion: makeBase({ userMessage: "???", reply: null }),
      hasActiveBlock: false,
      bufferedSets: [],
    });
    const reply = actions.find(
      (a): a is Extract<ChatAction, { type: "reply" }> => a.type === "reply",
    );
    expect(reply?.text).toBeDefined();
    expect(reply?.text).not.toMatch(/could not match/i);
  });
});
