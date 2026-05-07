import { describe, expect, it } from "vitest";
import type { ExerciseRecord } from "@/lib/exercises";
import { percentageOfOneRm } from "@/lib/rep-percentages";
import {
  applyGhostAtCaret,
  applyWorkoutChatSuggestionAtCaret,
  ensureSpaceBeforeInsertIfNeeded,
  extractLoadSnippetsFromTexts,
  ghostSuffixIgnoreCase,
  lineMatchesCanonicalCatalogExercise,
  rankExercisesForWorkoutChatSuggest,
  workoutChatSuggest,
} from "@/lib/workout-chat/suggest";

const miniCatalog: Pick<ExerciseRecord, "slug" | "name" | "category">[] = [
  { slug: "bench-press", name: "Bench Press", category: "barbell" },
  { slug: "squat", name: "Squat", category: "barbell" },
];

const shoulderCatalog: Pick<ExerciseRecord, "slug" | "name" | "category">[] = [
  { slug: "military-press", name: "Military Press", category: "barbell" },
  { slug: "shoulder-press", name: "Shoulder Press", category: "barbell" },
  { slug: "arnold-press", name: "Arnold Press", category: "barbell" },
  { slug: "dumbbell-shoulder-press", name: "Dumbbell Shoulder Press", category: "dumbbell" },
  { slug: "squat", name: "Squat", category: "barbell" },
];

describe("workoutChatSuggest", () => {
  it("returns empty suggestions when IME skipSuggestions is set", () => {
    expect(
      workoutChatSuggest({
        value: "bench",
        caret: 5,
        recentExerciseNames: [],
        catalogExercises: miniCatalog,
        skipSuggestions: true,
      }).suggestions,
    ).toEqual([]);
  });

  it("prefers Bench Press completion in top chips over Squat for bench prefix (catalog ranking)", () => {
    const r = workoutChatSuggest({
      value: "bench",
      caret: 5,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
    });
    expect(r.phase).toBe("exercise");
    expect(r.suggestions[0]?.insertText?.toLowerCase()).toContain("bench");
  });

  it("matches hyphenated query against slug tokens via ranked exercises", () => {
    const r = workoutChatSuggest({
      value: "bench-pre",
      caret: 9,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
    });
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(ghostSuffixIgnoreCase("bench-pre", "Bench Press")).toBeNull();
  });

  it("uses recent custom exercise names when they prefix-match", () => {
    const r = workoutChatSuggest({
      value: "zebra",
      caret: 5,
      recentExerciseNames: ["Zebra Curl"],
      catalogExercises: miniCatalog,
    });
    const hit = r.suggestions.find((s) => s.insertText.startsWith("Zebra Curl"));
    expect(hit?.kind).toBe("exercise");
  });

  it("routes shoulder press query toward Military Press and returns several exercise chips", () => {
    const r = workoutChatSuggest({
      value: "shoulder press",
      caret: "shoulder press".length,
      recentExerciseNames: [],
      catalogExercises: shoulderCatalog,
    });
    expect(r.phase).toBe("exercise");
    expect(r.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(r.suggestions.length).toBeLessThanOrEqual(6);
    const labels = r.suggestions.map((s) => s.label.toLowerCase()).join(" ");
    expect(labels).toContain("military");
    expect(r.suggestions.some((s) => s.kind === "exercise")).toBe(true);
  });

  it("fills generic kg ladders when load history is empty without inventing chat snippets (5×5 tail)", () => {
    const r = workoutChatSuggest({
      value: "bench press 5×5 ",
      caret: "bench press 5×5 ".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentUserTexts: [],
      recentLoadSnippets: [],
      currentExerciseLoadSnippets: [],
      unitHint: "kg",
    });
    expect(r.phase).toBe("load");
    expect(r.suggestions.every((s) => s.kind === "load")).toBe(true);
    expect(r.suggestions.map((s) => s.insertText)).toEqual([
      " @ 20kg",
      " @ 40kg",
      " @ 60kg",
      " @ 80kg",
      " @ 100kg",
    ]);
  });

  it("prioritizes eight-rep %1RM chips for … N sets NL tail when estimatedOneRmKgBySlug is set", () => {
    expect(percentageOfOneRm(8)).toBe(0.81);
    const r = workoutChatSuggest({
      value: "Bench Press 5 reps 3 sets",
      caret: "Bench Press 5 reps 3 sets".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentUserTexts: [],
      recentLoadSnippets: [],
      currentExerciseLoadSnippets: [],
      unitHint: "kg",
      estimatedOneRmKgBySlug: { "bench-press": 100 },
    });
    expect(r.phase).toBe("load");
    expect(r.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(r.suggestions.every((s) => s.kind === "load")).toBe(true);
    const main = r.suggestions[0];
    expect(main?.label.toLowerCase()).toContain("8rm");
    expect(main?.insertText).toBe(" @ 80kg");
    expect(
      Number.parseFloat(main!.insertText.match(/[\d.]+/)![0]!) / 100,
    ).toBeCloseTo(percentageOfOneRm(8), 1);
  });

  it("accepts estimatedOneRmKg when resolved slug matches currentExerciseSlug", () => {
    const r = workoutChatSuggest({
      value: "squat 5×5",
      caret: "squat 5×5".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentUserTexts: [],
      recentLoadSnippets: [],
      currentExerciseLoadSnippets: [],
      unitHint: "kg",
      currentExerciseSlug: "squat",
      estimatedOneRmKg: 100,
    });
    expect(r.phase).toBe("load");
    expect(r.suggestions[0]?.label.toLowerCase()).toContain("8rm");
    expect(r.suggestions[0]?.insertText).toBe(" @ 80kg");
  });

  it("pads with generic ladders after ranked history loads (≤6 chips)", () => {
    const r = workoutChatSuggest({
      value: "Bench Press 5x5",
      caret: "Bench Press 5x5".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentUserTexts: [],
      recentLoadSnippets: [" @ 50kg", " @ 72.5kg"],
      currentExerciseLoadSnippets: [],
      unitHint: "kg",
    });
    expect(r.phase).toBe("load");
    expect(r.suggestions.length).toBe(6);
    expect(r.suggestions[0]?.insertText).toBe(" @ 50kg");
    expect(r.suggestions[1]?.insertText).toBe(" @ 72.5kg");
    expect(r.suggestions[2]?.insertText).toBe(" @ 20kg");
    expect(r.suggestions[5]?.insertText).toBe(" @ 80kg");
  });

  it("lowercase exercise with 5×5 and trailing space yields non-empty load chips", () => {
    const line = "bench press 5×5 ";
    const r = workoutChatSuggest({
      value: line,
      caret: line.length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentUserTexts: [],
      recentLoadSnippets: [],
      currentExerciseLoadSnippets: [],
      unitHint: "kg",
    });
    expect(r.phase).toBe("load");
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.every((s) => s.kind === "load")).toBe(true);
  });

  it("fills generic lb ladders when unitHint is lb (empty load history)", () => {
    const r = workoutChatSuggest({
      value: "squat 3×10 ",
      caret: "squat 3×10 ".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentUserTexts: [],
      recentLoadSnippets: [],
      currentExerciseLoadSnippets: [],
      unitHint: "lb",
    });
    expect(r.phase).toBe("load");
    expect(r.suggestions.map((s) => s.insertText)).toEqual([
      " @ 45lb",
      " @ 95lb",
      " @ 135lb",
      " @ 185lb",
      " @ 225lb",
    ]);
  });

  it("uses BW placeholders instead of fabricated kg chips for catalog bodyweight + slug match", () => {
    const bwCatalog: Pick<ExerciseRecord, "slug" | "name" | "category">[] = [
      { slug: "pull-ups", name: "Pull Ups", category: "Bodyweight" },
    ];
    const r = workoutChatSuggest({
      value: "pull ups 5x5 ",
      caret: "pull ups 5x5 ".length,
      recentExerciseNames: [],
      catalogExercises: bwCatalog,
      currentExerciseSlug: "pull-ups",
      recentUserTexts: [],
      recentLoadSnippets: [],
      currentExerciseLoadSnippets: [],
      unitHint: "kg",
    });
    expect(r.phase).toBe("load");
    expect(r.suggestions.map((s) => s.insertText)).toEqual([" @ BW", " @ bodyweight"]);
    expect(r.suggestions.some((s) => /\bkg\b/i.test(s.insertText))).toBe(false);
  });

  it("proposes load chip after sets×reps tail", () => {
    const r = workoutChatSuggest({
      value: "squat 3x10",
      caret: "squat 3x10".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentLoadSnippets: [" @ 100kg", " @ 90kg"],
    });
    expect(r.phase).toBe("load");
    expect(r.suggestions[0]?.insertText).toBe(" @ 100kg");
  });

  it("after `reps` at EOL shows set / × pivot (even when load history exists)", () => {
    const r = workoutChatSuggest({
      value: "squat 10 reps",
      caret: "squat 10 reps".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentLoadSnippets: [" @ 120kg"],
    });
    expect(r.phase).toBe("volume");
    expect(
      r.suggestions.some((s) => /sets/i.test(s.label) || s.label.includes("×")),
    ).toBe(true);
  });

  it("proposes load chip after full sets×reps tail following reps phrase", () => {
    const r = workoutChatSuggest({
      value: "squat 10 reps 5x5",
      caret: "squat 10 reps 5x5".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentLoadSnippets: [" @ 120kg"],
    });
    expect(r.phase).toBe("load");
    expect(r.suggestions[0]?.insertText).toBe(" @ 120kg");
  });

  it("prefers currentExerciseLoadSnippets over recent chat snippets", () => {
    const r = workoutChatSuggest({
      value: "bench 5x5",
      caret: "bench 5x5".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentLoadSnippets: [" @ 50kg"],
      currentExerciseLoadSnippets: [" @ 60kg"],
    });
    expect(r.suggestions[0]?.insertText).toBe(" @ 60kg");
  });

  it('appends minimal unit template after "@72.5" volume context', () => {
    const kg = workoutChatSuggest({
      value: "bench 3x10 @ 72.5",
      caret: "bench 3x10 @ 72.5".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      unitHint: "kg",
    });
    expect(kg.suggestions[0]?.insertText).toBe("kg");

    const lb = workoutChatSuggest({
      value: "bench 3x10 @ 135",
      caret: "bench 3x10 @ 135".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      unitHint: "lb",
    });
    expect(lb.suggestions[0]?.insertText).toBe(" lb");
  });

  it("uses volume phase after resolved exercise name and trailing space", () => {
    const r = workoutChatSuggest({
      value: "bench press ",
      caret: "bench press ".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentUserTexts: ["did 5x5 @ 60kg yesterday", "3x8 @ 40kg"],
    });
    expect(r.phase).toBe("volume");
    expect(
      r.suggestions.some(
        (s) => s.label.includes("×") || /\breps\b/i.test(s.label),
      ),
    ).toBe(true);
  });

  it('after `N reps` at EOL, pivots to set / × volume chips (not another reps strip)', () => {
    const r = workoutChatSuggest({
      value: "Bench Press 8 reps",
      caret: "Bench Press 8 reps".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentUserTexts: ["3x8 @ 40kg"],
      recentLoadSnippets: [],
      currentExerciseLoadSnippets: [],
      unitHint: "kg",
    });
    expect(r.phase).toBe("volume");
    const labels = r.suggestions.map((s) => s.label).join(" ");
    expect(labels.toLowerCase()).toMatch(/sets|[×]/);
    expect(r.suggestions.every((s) => /\breps\b/i.test(s.label))).toBe(false);
  });

  it("digits-only predictive volume chips use descriptive reps labels", () => {
    const r = workoutChatSuggest({
      value: "Bench Press ",
      caret: "Bench Press ".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentUserTexts: [],
      unitHint: "kg",
    });
    expect(r.phase).toBe("volume");
    const repsInsertBacked = r.suggestions.filter((s) => /\breps\b/i.test(s.insertText));
    expect(repsInsertBacked.length).toBeGreaterThan(0);
    for (const s of repsInsertBacked) {
      expect(s.label.toLowerCase()).toContain("reps");
      expect(s.insertText).toMatch(/^\d+\s+reps\s+$/);
    }
  });

  it("snapshots descriptive labels on fallback numeric volume chips when history empty", () => {
    const r = workoutChatSuggest({
      value: "bench press ",
      caret: "bench press ".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentUserTexts: [],
    });
    expect(r.suggestions.map((s) => s.label)).toMatchInlineSnapshot(`
      [
        "1 reps",
        "5 reps",
        "8 reps",
        "10 reps",
        "5×5",
        "3×8",
      ]
    `);
  });

  it("detects exercise phase while shoulder phrase has no trailing space (synonym chips stay)", () => {
    const r = workoutChatSuggest({
      value: "shoulder press",
      caret: "shoulder press".length,
      recentExerciseNames: [],
      catalogExercises: shoulderCatalog,
      recentUserTexts: ["5x5 @ 60kg"],
    });
    expect(r.phase).toBe("exercise");
    expect(
      r.suggestions.some((s) => s.insertText.toLowerCase().includes("military")),
    ).toBe(true);
  });

  it("Bench Press at EOL with no trailing space yields non-empty volume chips when history is empty", () => {
    const r = workoutChatSuggest({
      value: "Bench Press",
      caret: "Bench Press".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentUserTexts: [],
    });
    expect(r.phase).toBe("volume");
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.every((s) => s.kind === "volume")).toBe(true);
  });

  it("trimmed exact match on catalog name is case-insensitive (volume phase)", () => {
    const r = workoutChatSuggest({
      value: "bEnCh PrEsS",
      caret: "bEnCh PrEsS".length,
      recentExerciseNames: [],
      catalogExercises: miniCatalog,
      recentUserTexts: [],
    });
    expect(r.phase).toBe("volume");
    expect(r.suggestions.length).toBeGreaterThan(0);
  });
});

describe("lineMatchesCanonicalCatalogExercise", () => {
  it("matches catalog display name and slug-as-spaces", () => {
    expect(lineMatchesCanonicalCatalogExercise("Bench Press", miniCatalog)).toBe(true);
    expect(lineMatchesCanonicalCatalogExercise("bench press", miniCatalog)).toBe(true);
    expect(lineMatchesCanonicalCatalogExercise("bench\u00a0press", miniCatalog)).toBe(true);
    expect(lineMatchesCanonicalCatalogExercise("Squat", miniCatalog)).toBe(true);
    expect(lineMatchesCanonicalCatalogExercise("bench", miniCatalog)).toBe(false);
  });
});

describe("rankExercisesForWorkoutChatSuggest", () => {
  it("lifts synonym slugs for shoulder press into ranked results (exact name may outrank)", () => {
    const ranked = rankExercisesForWorkoutChatSuggest(
      "shoulder press",
      shoulderCatalog,
    );
    const slugs = ranked.slice(0, 5).map((r) => r.exercise.slug);
    expect(slugs).toContain("military-press");
    expect(slugs).toContain("shoulder-press");
  });
});

describe("applyWorkoutChatSuggestionAtCaret", () => {
  it("replaces line prefix for exercise chips", () => {
    const line = "shoulder pr";
    const { nextValue, nextCaret } = applyWorkoutChatSuggestionAtCaret(
      line,
      line.length,
      {
        label: "Military Press",
        insertText: "Military Press ",
        kind: "exercise",
      },
    );
    expect(nextValue).toBe("Military Press ");
    expect(nextCaret).toBe("Military Press ".length);
  });

  it("exercise chip replaces line through caret (e.g. dips EOL → Bench press), not concatenated", () => {
    const line = "dips";
    const { nextValue, nextCaret } = applyWorkoutChatSuggestionAtCaret(
      line,
      line.length,
      {
        label: "Bench press",
        insertText: "Bench press ",
        kind: "exercise",
      },
    );
    expect(nextValue).toBe("Bench press ");
    expect(nextCaret).toBe("Bench press ".length);
  });

  it("appends load snippets at caret", () => {
    const v = "bench 5x5";
    const { nextValue, nextCaret } = applyWorkoutChatSuggestionAtCaret(
      v,
      v.length,
      { label: "@ 60kg", insertText: " @ 60kg", kind: "load" },
    );
    expect(nextValue).toBe("bench 5x5 @ 60kg");
    expect(nextCaret).toBe(nextValue.length);
  });

  it("appends full reps insert for volume chips (label vs insertText)", () => {
    const line = "Bench Press ";
    const { nextValue, nextCaret } = applyWorkoutChatSuggestionAtCaret(
      line,
      line.length,
      { label: "8 reps", insertText: "8 reps ", kind: "volume" },
    );
    expect(nextValue).toBe("Bench Press 8 reps ");
    expect(nextCaret).toBe(nextValue.length);
  });

  it.each<{
    name: string;
    value: string;
    caret: number;
    item: Parameters<typeof applyWorkoutChatSuggestionAtCaret>[2];
    expected: string;
  }>([
    {
      name: "after word at EOL, insert without leading space gets one gap before @",
      value: "dips",
      caret: 4,
      item: { label: "@", insertText: "@ 20kg ", kind: "load" },
      expected: "dips @ 20kg ",
    },
    {
      name: "after word plus trailing space, same insert — no double space",
      value: "dips ",
      caret: 5,
      item: { label: "@", insertText: "@ 20kg ", kind: "load" },
      expected: "dips @ 20kg ",
    },
    {
      name: "after dips plus trailing space, volume append — no double space",
      value: "dips ",
      caret: 5,
      item: { label: "8 reps", insertText: "8 reps ", kind: "volume" },
      expected: "dips 8 reps ",
    },
    {
      name: "mid-line after word, one space before load insert",
      value: "foo dips",
      caret: "foo dips".length,
      item: { label: "@", insertText: "@ 20kg ", kind: "load" },
      expected: "foo dips @ 20kg ",
    },
    {
      name: "insert already starts with whitespace — no duplicate gap",
      value: "dips",
      caret: 4,
      item: { label: "@", insertText: " @ 20kg", kind: "load" },
      expected: "dips @ 20kg",
    },
    {
      name: "tab immediately before caret counts as whitespace",
      value: "dips\t",
      caret: 5,
      item: { label: "@", insertText: "@ BW", kind: "load" },
      expected: "dips\t@ BW",
    },
    {
      name: "caret at buffer start — append load without leading separator",
      value: "",
      caret: 0,
      item: { label: "@", insertText: "@ 20kg", kind: "load" },
      expected: "@ 20kg",
    },
    {
      name: "resolved exercise without trailing space — one gap before volume insert",
      value: "Bench Press",
      caret: "Bench Press".length,
      item: { label: "8 reps", insertText: "8 reps ", kind: "volume" },
      expected: "Bench Press 8 reps ",
    },
  ])("$name", ({ value, caret, item, expected }) => {
    const { nextValue, nextCaret } = applyWorkoutChatSuggestionAtCaret(
      value,
      caret,
      item,
    );
    expect(nextValue).toBe(expected);
    expect(nextCaret).toBe(expected.length);
  });
});

describe("ensureSpaceBeforeInsertIfNeeded", () => {
  it("prepends one space when the character before caret is non-whitespace", () => {
    expect(ensureSpaceBeforeInsertIfNeeded("dips", 4, "@ 20kg ")).toBe(" @ 20kg ");
  });

  it("does not prepend when there is already whitespace before caret", () => {
    expect(ensureSpaceBeforeInsertIfNeeded("dips ", 5, "8 reps ")).toBe("8 reps ");
  });

  it("does not prepend at buffer start (start of first line)", () => {
    expect(ensureSpaceBeforeInsertIfNeeded("", 0, "@ 20kg")).toBe("@ 20kg");
  });

  it("does not prepend when insertText already starts with whitespace", () => {
    expect(ensureSpaceBeforeInsertIfNeeded("dips", 4, " @ 20kg")).toBe(" @ 20kg");
  });

  it("treats newline before caret as whitespace (start of line after NL)", () => {
    expect(ensureSpaceBeforeInsertIfNeeded("a\n", 2, "b")).toBe("b");
  });
});

describe("applyGhostAtCaret", () => {
  it("inserts ghost at caret preserving trailing text", () => {
    const prefix = "before squ";
    const value = `${prefix} after`;
    const caret = prefix.length;
    const { nextValue, nextCaret } = applyGhostAtCaret(value, caret, "at");
    expect(nextValue).toBe("before squat after");
    expect(nextCaret).toBe(`${prefix}at`.length);
  });
});

describe("extractLoadSnippetsFromTexts", () => {
  it("extracts explicit loads only", () => {
    expect(extractLoadSnippetsFromTexts(["did 3x5 @ 80kg nice"])).toEqual([
      " @ 80kg",
    ]);
  });
});
