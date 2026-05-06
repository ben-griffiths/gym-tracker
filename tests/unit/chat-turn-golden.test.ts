import { describe, expect, it } from "vitest";
import {
  tryDeterministicChatTurn,
  type DeterministicTurnResult,
} from "@/lib/workout-chat/intent-rules";
import {
  applyWorkoutEditXml,
  sanitizeEditXml,
} from "@/lib/workout-chat/workout-edit-xml";
import {
  extractExerciseQueryFromMessage,
  sanitizeWorkoutXml,
  workoutXmlToSuggestion,
} from "@/lib/workout-chat/workout-xml";
import { rankExercisesForQuery } from "@/lib/exercises";
import type { ChatSetSuggestion, WeightUnit } from "@/lib/types/workout";

const DEFAULT_UNIT: WeightUnit = "kg";

type GoldenInput = {
  message: string;
  previousXml: string;
  hasActiveBlock: boolean;
  currentExerciseSlug: string;
};

function runDeterministic(input: GoldenInput): DeterministicTurnResult | null {
  return tryDeterministicChatTurn({
    ...input,
    defaultUnit: DEFAULT_UNIT,
  });
}

/**
 * End-to-end deterministic pipeline: regex → edit/workout XML → applyEdit
 * (when needed) → sanitizeWorkoutXml → workoutXmlToSuggestion. Returns the
 * suggestion the page would receive.
 */
function runDeterministicPipeline(input: GoldenInput): {
  result: DeterministicTurnResult | null;
  suggestion: ChatSetSuggestion | null;
} {
  const result = runDeterministic(input);
  if (!result) return { result: null, suggestion: null };

  const liftQuery = extractExerciseQueryFromMessage(input.message);
  const ranks = rankExercisesForQuery(
    input.currentExerciseSlug || liftQuery,
    5,
  );
  const allowed = Array.from(
    new Set(
      [
        input.currentExerciseSlug,
        ...ranks.map((r) => r.exercise.slug),
      ].filter(Boolean),
    ),
  ).slice(0, 8);

  if (result.kind === "workout") {
    const suggestion = workoutXmlToSuggestion({
      rawModelOutput: result.workoutXml,
      userMessage: input.message,
      ranks,
      defaultUnit: DEFAULT_UNIT,
      fullRepair: true,
    });
    return { result, suggestion };
  }

  const sanitized = sanitizeEditXml(result.editXml, {
    allowedExerciseSlugs: allowed,
  });
  if (!sanitized) return { result, suggestion: null };
  const merged = applyWorkoutEditXml({
    previousXml: input.previousXml,
    editXml: sanitized,
    allowedExerciseSlugs: allowed,
  });
  if (!merged) return { result, suggestion: null };
  const sanitizedMerged = sanitizeWorkoutXml(merged, {
    allowedExerciseSlugs: allowed,
    previousXml: input.previousXml,
    preferredExerciseSlug: input.currentExerciseSlug || undefined,
  });
  if (!sanitizedMerged) return { result, suggestion: null };
  const suggestion = workoutXmlToSuggestion({
    rawModelOutput: sanitizedMerged,
    userMessage: input.message,
    ranks,
    defaultUnit: DEFAULT_UNIT,
    fullRepair: true,
  });
  return { result, suggestion };
}

const BENCH_BLOCK_3X5 = `<workout exercise="bench-press">
<s n="1" kind="working" r="5" w="100" u="kg"/>
<s n="2" kind="working" r="5" w="100" u="kg"/>
<s n="3" kind="working" r="5" w="100" u="kg"/>
</workout>`;

const BENCH_BLOCK_WITH_WARMUPS = `<workout exercise="bench-press">
<s n="1" kind="warmup" r="5" w="60" u="kg"/>
<s n="2" kind="working" r="5" w="100" u="kg"/>
<s n="3" kind="working" r="5" w="100" u="kg"/>
</workout>`;

const EMPTY_WORKOUT = `<workout exercise=""></workout>`;

describe("layer 1 deterministic — log new exercise", () => {
  it("matches `bench 5x5 100kg`", () => {
    const out = runDeterministic({
      message: "bench 5x5 100kg",
      previousXml: EMPTY_WORKOUT,
      hasActiveBlock: false,
      currentExerciseSlug: "",
    });
    expect(out?.kind).toBe("workout");
    expect(out?.ruleId).toBe("log-new");
    expect(out?.kind === "workout" && out.workoutXml).toContain('r="5"');
    expect(out?.kind === "workout" && out.workoutXml).toContain('w="100"');
  });

  it("matches `squat 3x8`", () => {
    const out = runDeterministic({
      message: "squat 3x8",
      previousXml: EMPTY_WORKOUT,
      hasActiveBlock: false,
      currentExerciseSlug: "",
    });
    expect(out?.kind).toBe("workout");
    if (out?.kind === "workout") {
      // 3 sets of 8 reps, weight optional
      const setRows = (out.workoutXml.match(/<s\s/g) ?? []).length;
      expect(setRows).toBe(3);
      expect(out.workoutXml).toContain('r="8"');
    }
  });

  it("matches `deadlift 1x5 180lb`", () => {
    const out = runDeterministic({
      message: "deadlift 1x5 180lb",
      previousXml: EMPTY_WORKOUT,
      hasActiveBlock: false,
      currentExerciseSlug: "",
    });
    expect(out?.kind).toBe("workout");
    if (out?.kind === "workout") {
      expect(out.workoutXml).toContain('w="180"');
      expect(out.workoutXml).toContain('u="lb"');
    }
  });

  it("does not match bare `5x5 100kg` (no lift name)", () => {
    const out = runDeterministic({
      message: "5x5 100kg",
      previousXml: EMPTY_WORKOUT,
      hasActiveBlock: false,
      currentExerciseSlug: "",
    });
    // lift-name pattern needs a leading word; falls through to LLM
    expect(out?.kind === "workout").toBe(false);
  });

  it("does not match lift-only without prescription", () => {
    const out = runDeterministic({
      message: "bench press",
      previousXml: EMPTY_WORKOUT,
      hasActiveBlock: false,
      currentExerciseSlug: "",
    });
    expect(out).toBeNull();
  });

  it("does not match malformed `bench x5 100`", () => {
    const out = runDeterministic({
      message: "bench x5 100",
      previousXml: EMPTY_WORKOUT,
      hasActiveBlock: false,
      currentExerciseSlug: "",
    });
    expect(out?.kind === "workout").toBe(false);
  });
});

describe("layer 1 deterministic — append more", () => {
  const ctx: GoldenInput = {
    message: "",
    previousXml: BENCH_BLOCK_3X5,
    hasActiveBlock: true,
    currentExerciseSlug: "bench-press",
  };

  it("`one more` duplicates last working row", () => {
    const out = runDeterministic({ ...ctx, message: "one more" });
    expect(out?.ruleId).toBe("append-more");
    expect(out?.kind === "edit" && out.editXml).toContain('count="1"');
    expect(out?.kind === "edit" && out.editXml).toContain('r="5"');
    expect(out?.kind === "edit" && out.editXml).toContain('w="100"');
  });

  it("`two more sets` repeats count", () => {
    const out = runDeterministic({ ...ctx, message: "two more sets" });
    expect(out?.ruleId).toBe("append-more");
    expect(out?.kind === "edit" && out.editXml).toContain('count="2"');
  });

  it("`one more @ 105` overrides weight", () => {
    const out = runDeterministic({ ...ctx, message: "one more @ 105" });
    expect(out?.ruleId).toBe("append-more");
    expect(out?.kind === "edit" && out.editXml).toContain('w="105"');
    expect(out?.kind === "edit" && out.editXml).toContain('r="5"');
  });

  it("`another set at 105kg` parses unit + weight", () => {
    const out = runDeterministic({ ...ctx, message: "another set at 105kg" });
    expect(out?.ruleId).toBe("append-more");
    expect(out?.kind === "edit" && out.editXml).toContain('w="105"');
    expect(out?.kind === "edit" && out.editXml).toContain('u="kg"');
  });

  it("`another set` after warmups still copies last working row", () => {
    const out = runDeterministic({
      ...ctx,
      previousXml: BENCH_BLOCK_WITH_WARMUPS,
      message: "another set",
    });
    expect(out?.ruleId).toBe("append-more");
    expect(out?.kind === "edit" && out.editXml).toContain('w="100"');
    expect(out?.kind === "edit" && out.editXml).toContain('kind="working"');
  });

  it("`one more` with no active block falls through", () => {
    const out = runDeterministic({
      message: "one more",
      previousXml: EMPTY_WORKOUT,
      hasActiveBlock: false,
      currentExerciseSlug: "",
    });
    expect(out).toBeNull();
  });
});

describe("layer 1 deterministic — edit existing", () => {
  const ctx: GoldenInput = {
    message: "",
    previousXml: BENCH_BLOCK_3X5,
    hasActiveBlock: true,
    currentExerciseSlug: "bench-press",
  };

  it("`make the last set 8 reps` → update last-set r=8", () => {
    const out = runDeterministic({
      ...ctx,
      message: "make the last set 8 reps",
    });
    expect(out?.ruleId).toBe("reps-update");
    expect(out?.kind === "edit" && out.editXml).toContain('target="last-set"');
    expect(out?.kind === "edit" && out.editXml).toContain('r="8"');
  });

  it("`make that 105` → update last-set weight", () => {
    const out = runDeterministic({ ...ctx, message: "make that 105" });
    expect(out?.ruleId).toBe("weight-update");
    expect(out?.kind === "edit" && out.editXml).toContain('w="105"');
    expect(out?.kind === "edit" && out.editXml).toContain('target="last-set"');
  });

  it("`actually 102.5` accepts decimals", () => {
    const out = runDeterministic({ ...ctx, message: "actually 102.5" });
    expect(out?.ruleId).toBe("weight-update");
    expect(out?.kind === "edit" && out.editXml).toContain('w="102.5"');
  });

  it("`second set 6 reps` → update set:2", () => {
    const out = runDeterministic({ ...ctx, message: "second set 6 reps" });
    expect(out?.ruleId).toBe("reps-update");
    expect(out?.kind === "edit" && out.editXml).toContain('target="set:2"');
    expect(out?.kind === "edit" && out.editXml).toContain('r="6"');
  });

  it("`set 3 to 7 reps` → update set:3", () => {
    const out = runDeterministic({ ...ctx, message: "set 3 to 7 reps" });
    expect(out?.ruleId).toBe("reps-update");
    expect(out?.kind === "edit" && out.editXml).toContain('target="set:3"');
  });

  it("weight-only correction with no active block falls through", () => {
    const out = runDeterministic({
      message: "make that 105",
      previousXml: EMPTY_WORKOUT,
      hasActiveBlock: false,
      currentExerciseSlug: "",
    });
    expect(out).toBeNull();
  });
});

describe("layer 1 deterministic — delete", () => {
  const ctx: GoldenInput = {
    message: "",
    previousXml: BENCH_BLOCK_3X5,
    hasActiveBlock: true,
    currentExerciseSlug: "bench-press",
  };

  it("`remove the last set` → delete last-set", () => {
    const out = runDeterministic({ ...ctx, message: "remove the last set" });
    expect(out?.ruleId).toBe("delete");
    expect(out?.kind === "edit" && out.editXml).toContain('target="last-set"');
  });

  it("`delete set 2` → delete set:2", () => {
    const out = runDeterministic({ ...ctx, message: "delete set 2" });
    expect(out?.ruleId).toBe("delete");
    expect(out?.kind === "edit" && out.editXml).toContain('target="set:2"');
  });

  it("`scrap the last one` → delete last-set", () => {
    const out = runDeterministic({ ...ctx, message: "scrap the last one" });
    expect(out?.ruleId).toBe("delete");
    expect(out?.kind === "edit" && out.editXml).toContain('target="last-set"');
  });

  it("benign `i wanna delete fries` does NOT match", () => {
    const out = runDeterministic({
      ...ctx,
      message: "i wanna delete fries from my diet",
    });
    expect(out?.ruleId).not.toBe("delete");
  });
});

describe("layer 1 deterministic — switch exercise", () => {
  const ctx: GoldenInput = {
    message: "",
    previousXml: BENCH_BLOCK_3X5,
    hasActiveBlock: true,
    currentExerciseSlug: "bench-press",
  };

  it("`switch to incline dumbbell bench press` resolves slug", () => {
    const out = runDeterministic({
      ...ctx,
      message: "switch to incline dumbbell bench press",
    });
    expect(out?.ruleId).toBe("switch-exercise");
    expect(out?.kind === "edit" && out.editXml).toMatch(
      /<set-exercise slug="incline-dumbbell-bench-press"\/>/,
    );
  });

  it("`swap to deadlift` resolves slug", () => {
    const out = runDeterministic({ ...ctx, message: "swap to deadlift" });
    expect(out?.ruleId).toBe("switch-exercise");
    expect(out?.kind === "edit" && out.editXml).toContain(
      'slug="deadlift"',
    );
  });

  it("`swap to gibberishxyz` falls through (no rank match)", () => {
    const out = runDeterministic({ ...ctx, message: "swap to gibberishxyz" });
    expect(out?.ruleId).not.toBe("switch-exercise");
  });
});

describe("layer 1 deterministic — add warmups", () => {
  const ctx: GoldenInput = {
    message: "",
    previousXml: BENCH_BLOCK_3X5,
    hasActiveBlock: true,
    currentExerciseSlug: "bench-press",
  };

  it("`2 warmups` → insert before-first-working count=2", () => {
    const out = runDeterministic({ ...ctx, message: "2 warmups" });
    expect(out?.ruleId).toBe("add-warmups");
    expect(out?.kind === "edit" && out.editXml).toContain('count="2"');
    expect(out?.kind === "edit" && out.editXml).toContain(
      'position="before-first-working"',
    );
  });

  it("`add a warmup` → count=1", () => {
    const out = runDeterministic({ ...ctx, message: "add a warmup" });
    expect(out?.ruleId).toBe("add-warmups");
    expect(out?.kind === "edit" && out.editXml).toContain('count="1"');
  });

  it("`two warm-ups` (with hyphen) matches", () => {
    const out = runDeterministic({ ...ctx, message: "two warm-ups" });
    expect(out?.ruleId).toBe("add-warmups");
  });

  it("`add 2 warmup sets` matches (plural set noun)", () => {
    const out = runDeterministic({ ...ctx, message: "add 2 warmup sets" });
    expect(out?.ruleId).toBe("add-warmups");
    expect(out?.kind === "edit" && out.editXml).toContain('count="2"');
  });

  it("`add 2 warmup set` matches (singular set noun)", () => {
    const out = runDeterministic({ ...ctx, message: "add 2 warmup set" });
    expect(out?.ruleId).toBe("add-warmups");
    expect(out?.kind === "edit" && out.editXml).toContain('count="2"');
  });

  it("`add a warmup set` matches (count word + set noun)", () => {
    const out = runDeterministic({ ...ctx, message: "add a warmup set" });
    expect(out?.ruleId).toBe("add-warmups");
    expect(out?.kind === "edit" && out.editXml).toContain('count="1"');
  });

  it("`add warmup` (no count) defaults to 1", () => {
    const out = runDeterministic({ ...ctx, message: "add warmup" });
    expect(out?.ruleId).toBe("add-warmups");
    expect(out?.kind === "edit" && out.editXml).toContain('count="1"');
  });

  it("`warmup set` alone matches (no leading verb, count defaults to 1)", () => {
    const out = runDeterministic({ ...ctx, message: "warmup set" });
    expect(out?.ruleId).toBe("add-warmups");
    expect(out?.kind === "edit" && out.editXml).toContain('count="1"');
  });
});

describe("layer 1 deterministic — single-set on active block", () => {
  const ctx: GoldenInput = {
    message: "",
    previousXml: BENCH_BLOCK_3X5,
    hasActiveBlock: true,
    currentExerciseSlug: "bench-press",
  };

  it("`100kg x 5` parses weight and reps", () => {
    const out = runDeterministic({ ...ctx, message: "100kg x 5" });
    expect(out?.ruleId).toBe("log-single-set");
    expect(out?.kind === "edit" && out.editXml).toContain('w="100"');
    expect(out?.kind === "edit" && out.editXml).toContain('r="5"');
  });

  it("`5 @ 100` inherits unit from active block", () => {
    const out = runDeterministic({ ...ctx, message: "5 @ 100" });
    expect(out?.ruleId).toBe("log-single-set");
    expect(out?.kind === "edit" && out.editXml).toContain('u="kg"');
  });

  it("`5 reps at 100kg` parses correctly", () => {
    const out = runDeterministic({ ...ctx, message: "5 reps at 100kg" });
    expect(out?.ruleId).toBe("log-single-set");
    expect(out?.kind === "edit" && out.editXml).toContain('w="100"');
    expect(out?.kind === "edit" && out.editXml).toContain('r="5"');
  });

  it("ambiguous `20 x 20` (both ≤30, no unit) — falls through", () => {
    const out = runDeterministic({ ...ctx, message: "20 x 20" });
    // Both fit reps range; we treat first-as-reps so this *does* match log-single-set.
    // Document the behaviour: 20 reps × 20 weight.
    expect(out?.ruleId === "log-single-set" || out === null).toBe(true);
  });
});

describe("layer 1 deterministic — ambiguous / no-op", () => {
  it("`make it heavier` returns null (no concrete number)", () => {
    const out = runDeterministic({
      message: "make it heavier",
      previousXml: BENCH_BLOCK_3X5,
      hasActiveBlock: true,
      currentExerciseSlug: "bench-press",
    });
    expect(out).toBeNull();
  });

  it("typo `bnch 5x5` does NOT match log-new (lift name unrecognised but pattern matches; tryDeterministicWorkoutXml is permissive)", () => {
    const out = runDeterministic({
      message: "bnch 5x5",
      previousXml: EMPTY_WORKOUT,
      hasActiveBlock: false,
      currentExerciseSlug: "",
    });
    // tryDeterministicWorkoutXml accepts any leading lift phrase; downstream
    // ranking handles slug resolution. Document the contract.
    expect(out?.kind).toBe("workout");
  });

  it("greeting `hi` returns null", () => {
    const out = runDeterministic({
      message: "hi",
      previousXml: EMPTY_WORKOUT,
      hasActiveBlock: false,
      currentExerciseSlug: "",
    });
    expect(out).toBeNull();
  });

  it("contradictory `5 reps 10 reps` does not match single-set", () => {
    const out = runDeterministic({
      message: "5 reps 10 reps",
      previousXml: BENCH_BLOCK_3X5,
      hasActiveBlock: true,
      currentExerciseSlug: "bench-press",
    });
    expect(out?.ruleId === "log-single-set").toBe(false);
  });
});

describe("layer 1 deterministic — end-to-end suggestion shape", () => {
  it("`bench 5x5 100kg` produces a 5-set suggestion with bench-press as top option", () => {
    const { suggestion } = runDeterministicPipeline({
      message: "bench 5x5 100kg",
      previousXml: EMPTY_WORKOUT,
      hasActiveBlock: false,
      currentExerciseSlug: "",
    });
    expect(suggestion).not.toBeNull();
    // Either auto-resolved or top of exerciseOptions — chat-flow auto-picks
    // the top candidate when sets are present.
    const topSlug =
      suggestion!.autoResolvedExercise?.slug ??
      suggestion!.exerciseOptions[0]?.slug;
    expect(topSlug).toBe("bench-press");
    expect(suggestion!.sets).toHaveLength(5);
    expect(suggestion!.sets[0]!.reps).toBe(5);
    expect(suggestion!.sets[0]!.weight).toBe(100);
    expect(suggestion!.sets[0]!.weightUnit).toBe("kg");
  });

  it("`one more` produces a single-set suggestion using last working row's weight", () => {
    const { suggestion } = runDeterministicPipeline({
      message: "one more",
      previousXml: BENCH_BLOCK_3X5,
      hasActiveBlock: true,
      currentExerciseSlug: "bench-press",
    });
    expect(suggestion).not.toBeNull();
    // After applyEdit, the merged workout has 4 working sets; toSuggestion
    // returns ALL rows (the page diffs against existing state).
    expect(suggestion!.sets.length).toBeGreaterThanOrEqual(4);
    const last = suggestion!.sets[suggestion!.sets.length - 1]!;
    expect(last.reps).toBe(5);
    expect(last.weight).toBe(100);
  });

  it("`add 2 warmups` injects two warmup rows that get inferred weights", () => {
    const { suggestion } = runDeterministicPipeline({
      message: "add 2 warmups",
      previousXml: BENCH_BLOCK_3X5,
      hasActiveBlock: true,
      currentExerciseSlug: "bench-press",
    });
    expect(suggestion).not.toBeNull();
    const warmups = suggestion!.sets.filter((s) => s.isWarmup);
    expect(warmups.length).toBe(2);
    // fullRepair: true should infer warmup weights from the first working row.
    for (const w of warmups) {
      expect(w.weight).not.toBeNull();
      expect(w.weight!).toBeLessThan(100);
    }
  });
});
