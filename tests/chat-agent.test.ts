import { describe, expect, it } from "vitest";
import { assembleSuggestion, extractToolCalls } from "../lib/chat-agent";
import { parseFallbackSuggestion } from "../lib/workout-parser";

const emptyFallback = parseFallbackSuggestion("");

describe("assembleSuggestion", () => {
  it("maps a single log_sets tool call into primary sets", () => {
    const suggestion = assembleSuggestion({
      message: "bench 5x5 100kg",
      context: undefined,
      fallback: emptyFallback,
      toolCalls: [
        {
          name: "log_sets",
          arguments: JSON.stringify({
            exerciseSlug: "bench-press",
            sets: Array.from({ length: 5 }, () => ({
              reps: 5,
              weight: 100,
              weightUnit: "kg",
            })),
          }),
        },
      ],
    });

    expect(suggestion.autoResolvedExercise?.slug).toBe("bench-press");
    expect(suggestion.sets).toHaveLength(5);
    expect(suggestion.sets[0]).toMatchObject({ reps: 5, weight: 100, weightUnit: "kg" });
    expect(suggestion.additionalExercises).toHaveLength(0);
    expect(suggestion.blockOperations).toHaveLength(0);
  });

  it("splits multi-exercise turns into primary + additional", () => {
    const suggestion = assembleSuggestion({
      message: "bench 5x5 100kg, squat 3x5 140kg",
      context: undefined,
      fallback: emptyFallback,
      toolCalls: [
        {
          name: "log_sets",
          arguments: JSON.stringify({
            exerciseSlug: "bench-press",
            sets: [{ reps: 5, weight: 100, weightUnit: "kg" }],
          }),
        },
        {
          name: "log_sets",
          arguments: JSON.stringify({
            exerciseSlug: "squat",
            sets: [{ reps: 5, weight: 140, weightUnit: "kg" }],
          }),
        },
      ],
    });

    expect(suggestion.autoResolvedExercise?.slug).toBe("bench-press");
    expect(
      (suggestion.additionalExercises ?? []).map((a) => a.exercise.slug),
    ).toEqual(["squat"]);
  });

  it("passes warmup params through an autofill_weights tool call", () => {
    const suggestion = assembleSuggestion({
      message: "bench 5x5, 2 warmup sets ramping up to working weight",
      context: undefined,
      fallback: emptyFallback,
      toolCalls: [
        {
          name: "log_sets",
          arguments: JSON.stringify({
            exerciseSlug: "bench-press",
            sets: Array.from({ length: 5 }, () => ({
              reps: 5,
              weight: null,
              weightUnit: "kg",
            })),
          }),
        },
        {
          name: "autofill_weights",
          arguments: JSON.stringify({
            targetRpe: 8,
            warmupSets: 2,
            warmupStartPct: 0.3,
          }),
        },
      ],
    });

    expect(suggestion.scaleActiveBlockWeights).toEqual({
      targetRpe: 8,
      warmupSets: 2,
      warmupStartPct: 0.3,
    });
  });

  it("enriches scale weights with warmup hints the LLM forgot", () => {
    const suggestion = assembleSuggestion({
      message: "bench 5x5, two warmup sets ramping up to working weight",
      context: undefined,
      fallback: emptyFallback,
      toolCalls: [
        {
          name: "log_sets",
          arguments: JSON.stringify({
            exerciseSlug: "bench-press",
            sets: Array.from({ length: 5 }, () => ({
              reps: 5,
              weight: null,
              weightUnit: "kg",
            })),
          }),
        },
        {
          name: "autofill_weights",
          arguments: JSON.stringify({ targetRpe: 8 }),
        },
      ],
    });

    expect(suggestion.scaleActiveBlockWeights).toMatchObject({
      targetRpe: 8,
      warmupSets: 2,
    });
    // warmupStartPct defaults to 0.3 when user didn't specify a pct.
    expect(suggestion.scaleActiveBlockWeights?.warmupStartPct).toBeCloseTo(0.3);
  });

  it("maps update_sets tool calls into updates", () => {
    const suggestion = assembleSuggestion({
      message: "actually all sets were rpe 9",
      context: undefined,
      fallback: emptyFallback,
      toolCalls: [
        {
          name: "update_sets",
          arguments: JSON.stringify({
            targetSetNumbers: [1, 2, 3],
            rpe: 9,
          }),
        },
      ],
    });

    expect(suggestion.updates).toHaveLength(1);
    expect(suggestion.updates[0]).toMatchObject({
      targetSetNumbers: [1, 2, 3],
      rpe: 9,
    });
  });

  it("strips null reps/weight on update_sets so clearing RPE does not wipe load/reps", () => {
    const suggestion = assembleSuggestion({
      message: "remove rpe from set 1",
      context: undefined,
      fallback: emptyFallback,
      toolCalls: [
        {
          name: "update_sets",
          arguments: JSON.stringify({
            targetSetNumbers: [6],
            rpe: null,
            reps: null,
            weight: null,
          }),
        },
      ],
    });
    expect(suggestion.updates[0]).toEqual({
      targetSetNumbers: [6],
      rpe: null,
    });
  });

  it("maps remove_block + replace_block to block operations", () => {
    const suggestion = assembleSuggestion({
      message: "scrap the deadlift, change squat to bench",
      context: undefined,
      fallback: emptyFallback,
      toolCalls: [
        {
          name: "remove_block",
          arguments: JSON.stringify({ exerciseSlug: "deadlift" }),
        },
        {
          name: "replace_block",
          arguments: JSON.stringify({ fromSlug: "squat", toSlug: "bench-press" }),
        },
      ],
    });

    expect(suggestion.blockOperations).toEqual([
      { kind: "remove", exerciseSlug: "deadlift" },
      { kind: "replace", fromSlug: "squat", toSlug: "bench-press" },
    ]);
    // Block ops reset sets / scaling so the client doesn't double-apply.
    expect(suggestion.sets).toHaveLength(0);
    expect(suggestion.scaleActiveBlockWeights).toBeNull();
  });

  it("maps show_exercise_help to exerciseHelp", () => {
    const suggestion = assembleSuggestion({
      message: "how do I do dips?",
      context: undefined,
      fallback: emptyFallback,
      toolCalls: [
        {
          name: "show_exercise_help",
          arguments: JSON.stringify({
            exerciseSlug: "dips",
            mode: "instructions",
          }),
        },
      ],
    });

    expect(suggestion.exerciseHelp).toEqual({
      exerciseSlug: "dips",
      mode: "instructions",
    });
    // exerciseHelp shadows reply so the UI doesn't render both.
    expect(suggestion.reply).toBeNull();
  });

  it("surfaces a reply when the LLM calls `reply`", () => {
    const suggestion = assembleSuggestion({
      message: "how much rest between sets?",
      context: undefined,
      fallback: emptyFallback,
      toolCalls: [
        {
          name: "reply",
          arguments: JSON.stringify({
            text: "Rest 2-3 minutes between heavy sets.",
          }),
        },
      ],
    });

    expect(suggestion.reply).toBe("Rest 2-3 minutes between heavy sets.");
    expect(suggestion.sets).toHaveLength(0);
  });

  it("resetExistingSets carries through when the LLM flags a restart", () => {
    const suggestion = assembleSuggestion({
      message: "okay, let's start over at 60kg",
      context: undefined,
      fallback: emptyFallback,
      toolCalls: [
        {
          name: "log_sets",
          arguments: JSON.stringify({
            exerciseSlug: "bench-press",
            sets: [{ reps: 5, weight: 60, weightUnit: "kg" }],
            resetExistingSets: true,
          }),
        },
      ],
    });

    expect(suggestion.resetActiveBlockSets).toBe(true);
  });

  it("ignores calls for unknown exercise slugs", () => {
    const suggestion = assembleSuggestion({
      message: "log something made up",
      context: undefined,
      fallback: emptyFallback,
      toolCalls: [
        {
          name: "log_sets",
          arguments: JSON.stringify({
            exerciseSlug: "not-a-real-slug",
            sets: [{ reps: 5, weight: 50, weightUnit: "kg" }],
          }),
        },
      ],
    });

    expect(suggestion.autoResolvedExercise).toBeNull();
    expect(suggestion.sets).toHaveLength(0);
  });

  it("skips tool calls whose arguments fail schema validation", () => {
    const suggestion = assembleSuggestion({
      message: "noisy LLM",
      context: undefined,
      fallback: emptyFallback,
      toolCalls: [
        {
          name: "log_sets",
          arguments: "{ not valid json",
        },
        {
          name: "autofill_weights",
          arguments: JSON.stringify({ targetRpe: 99 }),
        },
      ],
    });

    expect(suggestion.sets).toHaveLength(0);
    expect(suggestion.scaleActiveBlockWeights).toBeNull();
  });
});

describe("extractToolCalls", () => {
  it("pulls function_call items out of a Responses API completion", () => {
    const completion = {
      output: [
        { type: "message", content: [{ type: "output_text", text: "ok" }] },
        {
          type: "function_call",
          name: "log_sets",
          arguments: '{"exerciseSlug":"bench-press","sets":[]}',
        },
        {
          type: "function_call",
          name: "reply",
          arguments: { text: "hi" },
        },
      ],
    };

    const calls = extractToolCalls(completion);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      name: "log_sets",
      arguments: '{"exerciseSlug":"bench-press","sets":[]}',
    });
    expect(JSON.parse(calls[1]!.arguments)).toEqual({ text: "hi" });
  });

  it("returns [] for completions without an output array", () => {
    expect(extractToolCalls({})).toEqual([]);
    expect(extractToolCalls(null)).toEqual([]);
    expect(extractToolCalls({ output: "nope" })).toEqual([]);
  });
});
