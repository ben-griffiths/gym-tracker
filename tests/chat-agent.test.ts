import { describe, expect, it } from "vitest";
import {
  assembleSuggestion,
  buildSystemPrompt,
  buildWebLLMToolProtocolPrompt,
  extractToolCalls,
  extractToolCallsFromChatCompletion,
  extractToolCallsFromContent,
  getChatCompletionsTools,
} from "../lib/chat-agent";
import { parseFallbackSuggestion } from "../lib/workout-parser";

const emptyFallback = parseFallbackSuggestion("");

describe("buildSystemPrompt", () => {
  it("instructs the model to classify chit-chat and use reply for greetings", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("chit");
    expect(prompt).toContain("`reply`");
    expect(prompt).toMatch(/greet|Greet|greetings/i);
  });
});

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

describe("getChatCompletionsTools", () => {
  it("maps each tool to Chat Completions function shape", () => {
    const tools = getChatCompletionsTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(typeof t.function.name).toBe("string");
      expect(t.function.name.length).toBeGreaterThan(0);
      expect(typeof t.function.description).toBe("string");
      expect(t.function.parameters).toBeDefined();
    }
  });
});

describe("extractToolCallsFromChatCompletion", () => {
  it("reads tool_calls from choices[0].message", () => {
    const completion = {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "0",
                type: "function",
                function: {
                  name: "log_sets",
                  arguments: '{"exerciseSlug":"bench-press","sets":[]}',
                },
              },
              {
                id: "1",
                type: "function",
                function: {
                  name: "reply",
                  arguments: JSON.stringify({ text: "hi" }),
                },
              },
            ],
          },
        },
      ],
    };

    const calls = extractToolCallsFromChatCompletion(completion);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      name: "log_sets",
      arguments: '{"exerciseSlug":"bench-press","sets":[]}',
    });
    expect(JSON.parse(calls[1]!.arguments)).toEqual({ text: "hi" });
  });

  it("returns [] when tool_calls missing", () => {
    expect(extractToolCallsFromChatCompletion({})).toEqual([]);
    expect(extractToolCallsFromChatCompletion(null)).toEqual([]);
    expect(
      extractToolCallsFromChatCompletion({ choices: [{ message: { content: "x" } }] }),
    ).toEqual([]);
  });
});

describe("extractToolCallsFromContent (manual JSON tool-call protocol)", () => {
  it("parses a bare JSON object with tool_calls (legacy wrapper)", () => {
    const content = JSON.stringify({
      tool_calls: [
        { name: "log_sets", arguments: { exerciseSlug: "bench-press", sets: [] } },
        { name: "reply", arguments: { text: "ok" } },
      ],
    });
    const calls = extractToolCallsFromContent(content);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.name).toBe("log_sets");
    expect(JSON.parse(calls[0]!.arguments)).toEqual({
      exerciseSlug: "bench-press",
      sets: [],
    });
    expect(JSON.parse(calls[1]!.arguments)).toEqual({ text: "ok" });
  });

  it("parses Meta's bare {name,parameters} shape", () => {
    const content = JSON.stringify({
      name: "reply",
      parameters: { text: "hi" },
    });
    const calls = extractToolCallsFromContent(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("reply");
    expect(JSON.parse(calls[0]!.arguments)).toEqual({ text: "hi" });
  });

  it("parses a bare array of {name,parameters} (multi-call extension)", () => {
    const content = JSON.stringify([
      {
        name: "log_sets",
        parameters: { exerciseSlug: "bench-press", sets: [] },
      },
      { name: "autofill_weights", parameters: { targetRpe: 8 } },
    ]);
    const calls = extractToolCallsFromContent(content);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.name)).toEqual(["log_sets", "autofill_weights"]);
    expect(JSON.parse(calls[1]!.arguments)).toEqual({ targetRpe: 8 });
  });

  it("treats `parameters` as an alias for `arguments`", () => {
    const content = JSON.stringify({
      tool_calls: [
        { name: "reply", parameters: { text: "yo" } },
      ],
    });
    const calls = extractToolCallsFromContent(content);
    expect(JSON.parse(calls[0]!.arguments)).toEqual({ text: "yo" });
  });

  it("parses Meta's <function=NAME>{json}</function> tag form", () => {
    const content =
      '<function=remove_block>{"exerciseSlug":"deadlift"}</function>';
    const calls = extractToolCallsFromContent(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("remove_block");
    expect(JSON.parse(calls[0]!.arguments)).toEqual({
      exerciseSlug: "deadlift",
    });
  });

  it("strips ```json fences", () => {
    const content =
      'Sure!\n```json\n{"name":"reply","parameters":{"text":"hi"}}\n```';
    const calls = extractToolCallsFromContent(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("reply");
  });

  it("accepts string-form arguments", () => {
    const content = JSON.stringify({
      tool_calls: [
        { name: "reply", arguments: '{"text":"hi"}' },
      ],
    });
    const calls = extractToolCallsFromContent(content);
    expect(JSON.parse(calls[0]!.arguments)).toEqual({ text: "hi" });
  });

  it("returns [] for non-JSON or empty content", () => {
    expect(extractToolCallsFromContent("")).toEqual([]);
    expect(extractToolCallsFromContent("just prose, no JSON")).toEqual([]);
  });
});

describe("buildWebLLMToolProtocolPrompt", () => {
  it("includes Meta's documented JSON tool-call instruction and inlines the tool catalog", () => {
    const prompt = buildWebLLMToolProtocolPrompt();
    // Meta's literal preamble phrasing.
    expect(prompt).toMatch(/respond with a JSON for a function call/i);
    expect(prompt).toContain('"name"');
    expect(prompt).toContain('"parameters"');
    // Tool catalog inlined as JSON (each declared tool name appears).
    for (const t of getChatCompletionsTools()) {
      expect(prompt).toContain(`"name": "${t.function.name}"`);
    }
    // Documents the multi-call array extension.
    expect(prompt).toMatch(/array/i);
  });
});
