import { describe, expect, it } from "vitest";
import type { ChatContext } from "../lib/types/workout";
import {
  inferWeightUnit,
  isPureGreetingMessage,
  mergeScaleSuggestions,
  parseEffort,
  parseFallbackSuggestion,
  parseNumbers,
  parsePerSetFieldUpdates,
  parseSets,
} from "../lib/workout-parser";

describe("workout parser", () => {
  it("treats stand-alone greetings as conversational reply for fallbacks", () => {
    expect(isPureGreetingMessage("hello")).toBe(true);
    expect(isPureGreetingMessage("Hi there!")).toBe(true);
    expect(isPureGreetingMessage("good morning")).toBe(true);
    expect(isPureGreetingMessage("bench 5x5")).toBe(false);
    expect(isPureGreetingMessage("say hi to my friend")).toBe(false);

    const suggestion = parseFallbackSuggestion("hello");
    expect(suggestion.reply).toContain("Hey!");
    expect(suggestion.sets).toHaveLength(0);
  });

  it("parses per-set weight phrases into separate updates", () => {
    const ctx: ChatContext = {
      sets: Array.from({ length: 8 }, (_, i) => ({
        setNumber: i + 1,
        reps: 4,
        weight: 30,
        weightUnit: "kg" as const,
      })),
    };
    const msg =
      "reorder machine row sets so that set 5 is 120kg and set 6 is 100kg and set 7 is 60kg and set 8 is 40kg";
    const updates = parsePerSetFieldUpdates(msg, ctx);
    expect(updates).toHaveLength(4);
    expect(updates[0]).toMatchObject({
      targetSetNumbers: [5],
      weight: 120,
      weightUnit: "kg",
    });
    expect(updates[1]).toMatchObject({
      targetSetNumbers: [6],
      weight: 100,
      weightUnit: "kg",
    });
    expect(updates[2]).toMatchObject({
      targetSetNumbers: [7],
      weight: 60,
      weightUnit: "kg",
    });
    expect(updates[3]).toMatchObject({
      targetSetNumbers: [8],
      weight: 40,
      weightUnit: "kg",
    });
  });

  it("extracts numbers from free text", () => {
    expect(parseNumbers("12/10/8 reps at 20/22.5/25kg")).toEqual([
      12, 10, 8, 20, 22.5, 25,
    ]);
  });

  it("detects pounds keywords", () => {
    expect(inferWeightUnit("lat pulldown 12 reps at 90lbs")).toBe("lb");
  });

  it("creates variable set suggestions", () => {
    const suggestion = parseFallbackSuggestion(
      "incline dumbbell press 12/10/8 reps at 20/22.5/25kg",
    );
    expect(suggestion.exerciseOptions.length).toBeGreaterThan(0);
    expect(
      suggestion.exerciseOptions.map((entry) => entry.slug),
    ).toContain("incline-dumbbell-bench-press");
    expect(suggestion.sets.length).toBe(3);
    expect(suggestion.sets[2]).toMatchObject({
      setNumber: 3,
      reps: 8,
      weight: 25,
      weightUnit: "kg",
    });
  });

  describe("NxM set notation", () => {
    it("treats '10x10' as 10 sets of 10 reps (gym shorthand)", () => {
      const sets = parseSets("10x10");
      expect(sets).toHaveLength(10);
      for (const set of sets) {
        expect(set.reps).toBe(10);
        expect(set.weight).toBeNull();
      }
    });

    it("treats '3x5' as 3 sets of 5 reps", () => {
      const sets = parseSets("3x5");
      expect(sets).toHaveLength(3);
      expect(sets.map((set) => set.reps)).toEqual([5, 5, 5]);
    });

    it("treats '5×8' (unicode times) as 5 sets of 8 reps", () => {
      const sets = parseSets("5×8");
      expect(sets).toHaveLength(5);
      expect(sets.every((set) => set.reps === 8)).toBe(true);
    });

    it("treats '4x8 at 60kg' as 4 sets of 8 reps at 60kg", () => {
      const sets = parseSets("4x8 at 60kg");
      expect(sets).toHaveLength(4);
      for (const set of sets) {
        expect(set.reps).toBe(8);
        expect(set.weight).toBe(60);
        expect(set.weightUnit).toBe("kg");
      }
    });

    it("treats '3x5 100kg' as 3 sets of 5 reps at 100kg", () => {
      const sets = parseSets("3x5 100kg");
      expect(sets).toHaveLength(3);
      expect(sets.map((set) => set.weight)).toEqual([100, 100, 100]);
      expect(sets.map((set) => set.reps)).toEqual([5, 5, 5]);
    });

    it("still supports '5 sets at 20kg' with reps inherited from context", () => {
      const sets = parseSets("5 sets at 20kg", {
        sets: [
          { setNumber: 1, reps: 5, weight: 15, weightUnit: "kg" },
        ],
      });
      expect(sets).toHaveLength(5);
      expect(sets.every((set) => set.weight === 20)).toBe(true);
      expect(sets.every((set) => set.reps === 5)).toBe(true);
    });
  });

  describe("weight progressions", () => {
    it("expands 'start at 60kg and work up 20kg at a time to 115kg' into a ramp ending exactly at 115kg", () => {
      const sets = parseSets(
        "okay im gonna start at 60kg and work up 20kg at a time to 115kg",
      );
      expect(sets.map((set) => set.weight)).toEqual([60, 80, 100, 115]);
      expect(sets.every((set) => set.weightUnit === "kg")).toBe(true);
      expect(sets.every((set) => set.reps === null)).toBe(true);
      expect(sets[sets.length - 1]?.weight).toBe(115);
    });

    it("inherits reps when '5 reps each' is also specified", () => {
      const sets = parseSets(
        "starting at 100kg increasing by 20kg until 200kg, 5 reps each",
      );
      expect(sets.map((set) => set.weight)).toEqual([
        100, 120, 140, 160, 180, 200,
      ]);
      expect(sets.every((set) => set.reps === 5)).toBe(true);
    });

    it("infers the start weight from active block context when omitted", () => {
      const sets = parseSets("multiple sets increasing by 20kg until 115kg", {
        sets: [
          { setNumber: 1, reps: 20, weight: 60, weightUnit: "kg" },
          { setNumber: 2, reps: 20, weight: 60, weightUnit: "kg" },
        ],
      });
      expect(sets.map((set) => set.weight)).toEqual([60, 80, 100, 115]);
      expect(sets.every((set) => set.reps === 20)).toBe(true);
    });

    it("supports descending progressions (work down)", () => {
      const sets = parseSets("from 100kg down to 70kg, 5kg each set");
      expect(sets.map((set) => set.weight)).toEqual([100, 95, 90, 85, 80, 75, 70]);
    });

    it("ignores a single weight without a step (no false positive)", () => {
      const sets = parseSets("squat 100kg 5 reps");
      expect(sets).toHaveLength(1);
      expect(sets[0]).toMatchObject({ weight: 100, reps: 5 });
    });

    it("infers the start from the active block when only the flat context has nothing", () => {
      const sets = parseSets("multiple sets increasing by 20kg until 115kg", {
        blocks: [
          {
            exerciseSlug: "bench-press",
            exerciseName: "Bench Press",
            isActive: true,
            sets: [
              { setNumber: 1, reps: 20, weight: 60, weightUnit: "kg" },
              { setNumber: 2, reps: 20, weight: 60, weightUnit: "kg" },
            ],
          },
        ],
      });
      expect(sets.map((set) => set.weight)).toEqual([60, 80, 100, 115]);
    });
  });

  describe("reset active block sets", () => {
    it("flags reset when the user announces a fresh start over an existing block", () => {
      const suggestion = parseFallbackSuggestion(
        "okay im gonna start at 60kg and work up 20kg at a time to 115kg",
        {
          blocks: [
            {
              exerciseSlug: "bench-press",
              exerciseName: "Bench Press",
              isActive: true,
              sets: [
                { setNumber: 1, reps: 20, weight: 60, weightUnit: "kg" },
                { setNumber: 2, reps: 20, weight: 20, weightUnit: "kg" },
              ],
            },
          ],
        },
      );
      expect(suggestion.resetActiveBlockSets).toBe(true);
      expect(suggestion.sets.map((set) => set.weight)).toEqual([60, 80, 100, 115]);
    });

    it("does NOT flag reset when there are no existing sets to wipe", () => {
      const suggestion = parseFallbackSuggestion(
        "im gonna start at 60kg and work up 20kg at a time to 115kg",
      );
      expect(suggestion.resetActiveBlockSets).toBe(false);
      expect(suggestion.sets.map((set) => set.weight)).toEqual([60, 80, 100, 115]);
    });

    it("treats 'not right' + a fresh progression as a reset on the active block", () => {
      const suggestion = parseFallbackSuggestion(
        "not right multiple sets increasing by 20kg until 115kg",
        {
          blocks: [
            {
              exerciseSlug: "bench-press",
              exerciseName: "Bench Press",
              isActive: true,
              sets: [
                { setNumber: 1, reps: 20, weight: 60, weightUnit: "kg" },
                { setNumber: 2, reps: 20, weight: 20, weightUnit: "kg" },
              ],
            },
          ],
        },
      );
      expect(suggestion.resetActiveBlockSets).toBe(true);
      expect(suggestion.sets.map((set) => set.weight)).toEqual([60, 80, 100, 115]);
    });

    it("does not flag reset for a regular set entry that just mentions 'starting'", () => {
      const suggestion = parseFallbackSuggestion("squat 100kg 5 reps");
      expect(suggestion.resetActiveBlockSets).toBe(false);
    });
  });

  describe("scale active block reps", () => {
    const ACTIVE_BLOCK_CONTEXT = {
      blocks: [
        {
          exerciseSlug: "bench-press",
          exerciseName: "Bench Press",
          isActive: true,
          sets: [
            { setNumber: 1, reps: null, weight: 60, weightUnit: "kg" as const },
            { setNumber: 2, reps: null, weight: 80, weightUnit: "kg" as const },
            { setNumber: 3, reps: null, weight: 100, weightUnit: "kg" as const },
            { setNumber: 4, reps: null, weight: 115, weightUnit: "kg" as const },
          ],
        },
      ],
    };

    it("flags scaleActiveBlockReps with the default RPE 8 for 'scale the reps for me'", () => {
      const suggestion = parseFallbackSuggestion(
        "scale the reps for me",
        ACTIVE_BLOCK_CONTEXT,
      );
      expect(suggestion.scaleActiveBlockReps).toEqual({ targetRpe: 8 });
      expect(suggestion.sets).toEqual([]);
      expect(suggestion.updates).toEqual([]);
    });

    it("uses the RPE the user specified when provided", () => {
      const suggestion = parseFallbackSuggestion(
        "fill in the reps for me at rpe 7",
        ACTIVE_BLOCK_CONTEXT,
      );
      expect(suggestion.scaleActiveBlockReps).toEqual({ targetRpe: 7 });
    });

    it("matches synonymous phrasings ('pick the reps', 'work out the reps')", () => {
      expect(
        parseFallbackSuggestion("pick the reps for each set", ACTIVE_BLOCK_CONTEXT)
          .scaleActiveBlockReps,
      ).toEqual({ targetRpe: 8 });
      expect(
        parseFallbackSuggestion("work out my reps", ACTIVE_BLOCK_CONTEXT)
          .scaleActiveBlockReps,
      ).toEqual({ targetRpe: 8 });
    });

    it("does NOT fire when the active block has no weighted sets", () => {
      const suggestion = parseFallbackSuggestion("scale the reps for me", {
        blocks: [
          {
            exerciseSlug: "bench-press",
            exerciseName: "Bench Press",
            isActive: true,
            sets: [],
          },
        ],
      });
      expect(suggestion.scaleActiveBlockReps).toBeNull();
    });

    it("does NOT fire when the user is logging new sets in the same message", () => {
      const suggestion = parseFallbackSuggestion(
        "scale the reps and add 100kg",
        ACTIVE_BLOCK_CONTEXT,
      );
      // sets are present this turn — explicit input takes precedence over auto-fill.
      expect(suggestion.scaleActiveBlockReps).toBeNull();
    });

    it("does NOT misfire on benign phrasing", () => {
      expect(
        parseFallbackSuggestion("squat 100kg 5 reps", ACTIVE_BLOCK_CONTEXT)
          .scaleActiveBlockReps,
      ).toBeNull();
      expect(
        parseFallbackSuggestion("how many reps should I do?", ACTIVE_BLOCK_CONTEXT)
          .scaleActiveBlockReps,
      ).toBeNull();
    });
  });

  describe("scale active block weights", () => {
    const REPPED_NO_WEIGHT_CONTEXT = {
      blocks: [
        {
          exerciseSlug: "bench-press",
          exerciseName: "Bench Press",
          isActive: true,
          sets: [
            { setNumber: 1, reps: 5, weight: null, weightUnit: "kg" as const },
            { setNumber: 2, reps: 5, weight: null, weightUnit: "kg" as const },
            { setNumber: 3, reps: 5, weight: null, weightUnit: "kg" as const },
            { setNumber: 4, reps: 5, weight: null, weightUnit: "kg" as const },
            { setNumber: 5, reps: 5, weight: null, weightUnit: "kg" as const },
          ],
        },
      ],
    };

    it("flags scaleActiveBlockWeights with default RPE 8 for 'suggest the weights'", () => {
      const suggestion = parseFallbackSuggestion(
        "suggest the weights",
        REPPED_NO_WEIGHT_CONTEXT,
      );
      expect(suggestion.scaleActiveBlockWeights).toEqual({ targetRpe: 8 });
      expect(suggestion.sets).toEqual([]);
    });

    it("picks up 'you choose the weight' / 'pick weights for me'", () => {
      expect(
        parseFallbackSuggestion(
          "you choose the weight",
          REPPED_NO_WEIGHT_CONTEXT,
        ).scaleActiveBlockWeights,
      ).toEqual({ targetRpe: 8 });
      expect(
        parseFallbackSuggestion(
          "pick weights for each set at rpe 7",
          REPPED_NO_WEIGHT_CONTEXT,
        ).scaleActiveBlockWeights,
      ).toEqual({ targetRpe: 7 });
    });

    it("fires alongside new sets when they are repped-but-weightless ('bench 5x5 you choose the weight')", () => {
      const suggestion = parseFallbackSuggestion(
        "bench 5x5 you choose the weight",
      );
      expect(suggestion.sets).toHaveLength(5);
      expect(suggestion.sets.every((set) => set.reps === 5)).toBe(true);
      expect(suggestion.sets.every((set) => set.weight === null)).toBe(true);
      expect(suggestion.scaleActiveBlockWeights).toEqual({ targetRpe: 8 });
    });

    it("handles exact warmup wording: 'two warm up sets with increasing weight to 3 working sets'", () => {
      const suggestion = parseFallbackSuggestion(
        "Bench, shoulder press, dips, lateral cable raises. two warm up sets with increasing weight to 3 working sets. i aiming to do 3 heavy 5 rep sets",
      );
      // Warmup count is now carried on the scale-weights payload so the
      // client doesn't need to re-parse the message.
      expect(suggestion.scaleActiveBlockWeights).toEqual({
        targetRpe: 8,
        warmupSets: 2,
        warmupStartPct: 0.3,
      });
      // The turn carries 5-rep sets with no explicit loads, so weight
      // auto-scaling has concrete sets to fill.
      expect(suggestion.sets.length).toBeGreaterThan(0);
      expect(suggestion.sets.every((set) => set.reps === 5)).toBe(true);
      expect(suggestion.sets.every((set) => set.weight === null)).toBe(true);
    });

    it("parses multi-exercise + warmup/working count into resolvable exercise blocks", () => {
      const suggestion = parseFallbackSuggestion(
        "bench press, dips and shoulder press, i want 3 working sets at 5 reps, 2 warmup sets",
      );
      expect(suggestion.autoResolvedExercise?.slug).toBe("bench-press");
      expect(suggestion.sets).toHaveLength(5);
      expect(suggestion.sets.every((set) => set.reps === 5)).toBe(true);
      expect(
        (suggestion.additionalExercises ?? []).map((entry) => entry.exercise.slug),
      ).toContain("shoulder-press");
      expect(
        (suggestion.additionalExercises ?? []).some((entry) =>
          entry.exercise.slug.includes("dip"),
        ),
      ).toBe(true);
    });

    it("does NOT fire when every set already has a weight", () => {
      const suggestion = parseFallbackSuggestion("suggest the weights", {
        blocks: [
          {
            exerciseSlug: "bench-press",
            exerciseName: "Bench Press",
            isActive: true,
            sets: [
              { setNumber: 1, reps: 5, weight: 60, weightUnit: "kg" as const },
              { setNumber: 2, reps: 5, weight: 60, weightUnit: "kg" as const },
            ],
          },
        ],
      });
      expect(suggestion.scaleActiveBlockWeights).toBeNull();
    });

    it("does NOT misfire on benign phrasing", () => {
      expect(
        parseFallbackSuggestion("how heavy should I go?", REPPED_NO_WEIGHT_CONTEXT)
          .scaleActiveBlockWeights,
      ).toBeNull();
      expect(
        parseFallbackSuggestion("squat 100kg 5 reps", REPPED_NO_WEIGHT_CONTEXT)
          .scaleActiveBlockWeights,
      ).toBeNull();
    });
  });

  describe("mergeScaleSuggestions (LLM vs parser)", () => {
    const REPPED_NO_WEIGHT_CONTEXT = {
      blocks: [
        {
          exerciseSlug: "bench-press",
          exerciseName: "Bench Press",
          isActive: true,
          sets: [
            { setNumber: 1, reps: 5, weight: null, weightUnit: "kg" as const },
            { setNumber: 2, reps: 5, weight: null, weightUnit: "kg" as const },
          ],
        },
      ],
    };

    it("overrides a mistaken LLM scale-reps flag when the user only asked for weights", () => {
      const merged = mergeScaleSuggestions(
        "suggest the weights",
        REPPED_NO_WEIGHT_CONTEXT,
        undefined,
        {
          allowRepsThisTurn: true,
          allowWeightsThisTurn: true,
          llmReps: { targetRpe: 8 },
          llmWeights: null,
          fallbackReps: null,
          fallbackWeights: null,
        },
      );
      expect(merged.scaleActiveBlockReps).toBeNull();
      expect(merged.scaleActiveBlockWeights).toEqual({ targetRpe: 8 });
    });

    it("overrides a mistaken LLM scale-weights flag when the user only asked for reps", () => {
      const weightedContext = {
        blocks: [
          {
            exerciseSlug: "bench-press",
            exerciseName: "Bench Press",
            isActive: true,
            sets: [
              { setNumber: 1, reps: null, weight: 60, weightUnit: "kg" as const },
            ],
          },
        ],
      };
      const merged = mergeScaleSuggestions(
        "scale the reps for me",
        weightedContext,
        undefined,
        {
          allowRepsThisTurn: true,
          allowWeightsThisTurn: true,
          llmReps: null,
          llmWeights: { targetRpe: 8 },
          fallbackReps: null,
          fallbackWeights: null,
        },
      );
      expect(merged.scaleActiveBlockWeights).toBeNull();
      expect(merged.scaleActiveBlockReps).toEqual({ targetRpe: 8 });
    });
  });

  describe("effort ratings", () => {
    it("extracts RPE from inline phrasing", () => {
      expect(parseEffort("bench 100kg 5 reps @rpe 8")).toEqual({ rpe: 8 });
      expect(parseEffort("rpe 8.5")).toEqual({ rpe: 8.5 });
      expect(parseEffort("that was rpe of 9")).toEqual({ rpe: 9 });
    });

    it("extracts RIR from common phrasings", () => {
      expect(parseEffort("2 rir")).toEqual({ rir: 2 });
      expect(parseEffort("rir 1")).toEqual({ rir: 1 });
      expect(parseEffort("3 reps in reserve")).toEqual({ rir: 3 });
    });

    it("maps feel keywords onto the three-way scale", () => {
      expect(parseEffort("felt easy")).toEqual({ feel: "easy" });
      expect(parseEffort("that was hard")).toEqual({ feel: "hard" });
      expect(parseEffort("moderate")).toEqual({ feel: "medium" });
    });

    it("returns an empty object when nothing matches", () => {
      expect(parseEffort("bench press 100kg 5 reps")).toEqual({});
    });

    it("attaches inline RPE to parsed sets", () => {
      const sets = parseSets("5x5 100kg @rpe 8");
      expect(sets).toHaveLength(5);
      for (const set of sets) {
        expect(set.rpe).toBe(8);
        expect(set.weight).toBe(100);
        expect(set.reps).toBe(5);
      }
    });

    it("applies a feel tag to every set in a multi-set message", () => {
      const sets = parseSets("3x8 at 60kg, easy");
      expect(sets).toHaveLength(3);
      expect(sets.every((set) => set.feel === "easy")).toBe(true);
    });

    it("fires a retroactive update when the user tags effort on past sets", () => {
      const suggestion = parseFallbackSuggestion("they were all rpe 9", {
        sets: [
          { setNumber: 1, reps: 5, weight: 100, weightUnit: "kg" },
          { setNumber: 2, reps: 5, weight: 100, weightUnit: "kg" },
          { setNumber: 3, reps: 5, weight: 100, weightUnit: "kg" },
        ],
      });
      expect(suggestion.updates).toHaveLength(1);
      expect(suggestion.updates[0]).toMatchObject({
        targetSetNumbers: [1, 2, 3],
        rpe: 9,
      });
    });
  });
});
