import { describe, expect, it } from "vitest";
import { getExerciseBySlug } from "@/lib/exercises";
import type { ExerciseRank } from "@/lib/exercises";
import {
  buildOrderedExerciseSlugHints,
  coerceModelWorkoutXmlFragment,
  extractCurrentExerciseSlug,
  extractWorkoutXml,
  mightChangeExercise,
  sanitizeWorkoutXml,
  workoutXmlToSuggestion,
} from "@/lib/workout-chat/workout-xml";

describe("extractWorkoutXml", () => {
  it("strips markdown fences and surrounding prose", () => {
    const raw = `Here you go:\n\`\`\`xml\n<workout exercise=""><s kind="working" r="5"/></workout>\n\`\`\``;
    const out = extractWorkoutXml(raw);
    expect(out).toContain("<workout");
    expect(out).toContain("</workout>");
    expect(out).toContain('kind="working"');
  });

  it("returns the first complete workout root", () => {
    const raw = `ignore <workout exercise="a"><s kind="working" r="1"/></workout> tail <workout exercise="b"><s kind="working" r="2"/></workout>`;
    const out = extractWorkoutXml(raw);
    expect(out).toMatch(/exercise="a"/);
    expect(out).not.toMatch(/exercise="b"/);
  });

  it("returns null when no workout root", () => {
    expect(extractWorkoutXml("<s kind='working'/>")).toBeNull();
  });
});

describe("buildOrderedExerciseSlugHints", () => {
  const benchXml = `<workout exercise="bench-press">
  <s kind="working" r="5"/>
</workout>`;

  it("puts current exercise first on edit turns even when ranked query is unrelated", () => {
    const current = extractCurrentExerciseSlug(benchXml);
    expect(current).toBe("bench-press");

    const hints = buildOrderedExerciseSlugHints(
      current,
      ["hip-adduction"],
      true,
      "add 2 warmups",
    );
    expect(hints[0]).toBe("bench-press");
    expect(hints).toEqual(["bench-press"]);
  });

  it("includes ranks on empty log (new prescription)", () => {
    const hints = buildOrderedExerciseSlugHints(
      "",
      ["bench-press", "squat"],
      false,
      "bench 5x5",
    );
    expect(hints[0]).toBe("bench-press");
  });
});

describe("mightChangeExercise", () => {
  it("is true for switch phrasing", () => {
    expect(mightChangeExercise("make it incline bench instead")).toBe(true);
  });

  it("is false for pure edit phrasing", () => {
    expect(mightChangeExercise("add 2 warmups")).toBe(false);
  });
});

describe("coerceModelWorkoutXmlFragment", () => {
  it("closes truncated root for sanitization", () => {
    const raw = `Here is the updated workout XML:

<workout exercise="bench-press">
  <s kind="working" r="5"/>`;
    const coerced = coerceModelWorkoutXmlFragment(raw);
    expect(coerced).not.toBeNull();
    expect(coerced).toContain("</workout>");
    const sanitized = sanitizeWorkoutXml(raw, {
      allowedExerciseSlugs: ["bench-press"],
      previousXml: `<workout exercise="bench-press"><s kind="working" r="5"/></workout>`,
    });
    expect(sanitized).not.toBeNull();
    expect(sanitized).toContain("</workout>");
  });
});

describe("sanitizeWorkoutXml", () => {
  const allowed = ["bench-press", "squat"];

  it("keeps only exercise on root and validates slug", () => {
    const raw = `<workout exercise="bench-press" junk="1" other="x"><s kind="working" r="5"/></workout>`;
    const out = sanitizeWorkoutXml(raw, { allowedExerciseSlugs: allowed });
    expect(out).toContain('exercise="bench-press"');
    expect(out).not.toContain("junk");
  });

  it("clears invalid exercise slug", () => {
    const raw = `<workout exercise="not-a-real-slug"><s kind="working" r="5"/></workout>`;
    const out = sanitizeWorkoutXml(raw, { allowedExerciseSlugs: allowed });
    expect(out).toContain('exercise=""');
  });

  it("drops unknown set attributes and invalid units", () => {
    const raw = `<workout exercise=""><s kind="working" r="5" u="stone" note="hi" x="1"/></workout>`;
    const out = sanitizeWorkoutXml(raw, { allowedExerciseSlugs: allowed });
    expect(out).toContain('r="5"');
    expect(out).not.toContain("note");
    expect(out).not.toContain("u=");
  });

  it("drops invalid reps and weights", () => {
    const raw = `<workout exercise=""><s kind="working" r="0"/><s kind="working" r="8" w="100" u="kg"/></workout>`;
    const out = sanitizeWorkoutXml(raw, { allowedExerciseSlugs: allowed });
    expect(out).not.toContain("r=\"0\"");
    expect(out).toContain('r="8"');
    expect(out).toContain('w="100"');
  });

  it("allows decimal weights including 0.5", () => {
    const raw = `<workout exercise=""><s kind="working" r="5" w="0.5" u="kg"/></workout>`;
    const out = sanitizeWorkoutXml(raw, { allowedExerciseSlugs: allowed });
    expect(out).toContain('w="0.5"');
  });

  it("rejects zero weight", () => {
    const raw = `<workout exercise=""><s kind="working" r="5" w="0" u="kg"/></workout>`;
    const out = sanitizeWorkoutXml(raw, { allowedExerciseSlugs: allowed });
    expect(out).not.toContain("w=");
  });

  it("keeps partial warmup row", () => {
    const raw = `<workout exercise=""><s kind="warmup"/></workout>`;
    const out = sanitizeWorkoutXml(raw, { allowedExerciseSlugs: allowed });
    expect(out).toContain('<s kind="warmup"/>');
  });

  it("drops rows with missing or invalid kind", () => {
    const raw = `<workout exercise=""><s r="5"/><s kind="working" r="3"/></workout>`;
    const out = sanitizeWorkoutXml(raw, { allowedExerciseSlugs: allowed });
    expect(out).not.toContain('r="5"');
    expect(out).toContain('r="3"');
  });

  it("ignores non-s child tags and does not throw on malformed output", () => {
    const raw = `<<< <workout exercise=""><p>x</p><s kind="working" r="2"/></workout>`;
    expect(() => sanitizeWorkoutXml(raw, { allowedExerciseSlugs: allowed })).not.toThrow();
    const out = sanitizeWorkoutXml(raw, { allowedExerciseSlugs: allowed });
    expect(out).toContain('r="2"');
    expect(out).not.toContain("<p>");
  });

  it("accepts empty-pair s tags", () => {
    const raw = `<workout exercise=""><s kind="working" r="4" ></s></workout>`;
    const out = sanitizeWorkoutXml(raw, { allowedExerciseSlugs: allowed });
    expect(out).toContain('r="4"');
  });

  it("restores preferred exercise when model clears root on edits", () => {
    const raw = `<workout exercise=""><s kind="working" r="5"/></workout>`;
    const out = sanitizeWorkoutXml(raw, {
      allowedExerciseSlugs: ["bench-press"],
      preferredExerciseSlug: "bench-press",
    });
    expect(out).toContain('exercise="bench-press"');
  });

  it("returns null when row count explodes past safety cap", () => {
    const previous = `<workout exercise="bench-press">${Array.from({ length: 5 }, () => `<s kind="working" r="5"/>`).join("")}</workout>`;
    const many = Array.from({ length: 20 }, () => `<s kind="warmup" r="10" w="90" u="lb"/>`).join(
      "\n",
    );
    const raw = `<workout exercise="bench-press">${many}</workout>`;
    const out = sanitizeWorkoutXml(raw, {
      allowedExerciseSlugs: ["bench-press"],
      previousXml: previous,
    });
    expect(out).toBeNull();
  });
});

describe("workoutXmlToSuggestion with sanitize (golden partial path)", () => {
  it("parses five working sets with reps only — no invented weight or unit", () => {
    const bench = getExerciseBySlug("bench-press");
    expect(bench).not.toBeNull();
    const ranks: ExerciseRank[] = [{ exercise: bench!, score: 9000 }];

    const rawLlm = `<workout exercise="bench-press">
  <s kind="working" r="5"/>
  <s kind="working" r="5"/>
  <s kind="working" r="5"/>
  <s kind="working" r="5"/>
  <s kind="working" r="5"/>
</workout>`;
    const sanitized = sanitizeWorkoutXml(rawLlm, {
      allowedExerciseSlugs: ["bench-press"],
    });
    expect(sanitized).not.toBeNull();

    const suggestion = workoutXmlToSuggestion({
      rawModelOutput: sanitized!,
      userMessage: "bench 5x5",
      ranks,
      defaultUnit: "kg",
      fullRepair: false,
    });

    expect(suggestion.sets).toHaveLength(5);
    for (const row of suggestion.sets) {
      expect(row.reps).toBe(5);
      expect(row.weight).toBeNull();
      expect(row.weightUnit).toBeNull();
    }
    expect(suggestion.autoResolvedExercise?.slug).toBe("bench-press");
  });

  it("keeps weight and unit when present in XML", () => {
    const bench = getExerciseBySlug("bench-press")!;
    const ranks: ExerciseRank[] = [{ exercise: bench, score: 9000 }];
    const raw = `<workout exercise="bench-press"><s kind="working" r="5" w="100" u="kg"/></workout>`;
    const sanitized = sanitizeWorkoutXml(raw, { allowedExerciseSlugs: ["bench-press"] });
    const suggestion = workoutXmlToSuggestion({
      rawModelOutput: sanitized!,
      userMessage: "bench 5x5 100kg",
      ranks,
      defaultUnit: "kg",
      fullRepair: false,
    });
    expect(suggestion.sets).toHaveLength(1);
    expect(suggestion.sets[0]?.weight).toBe(100);
    expect(suggestion.sets[0]?.weightUnit).toBe("kg");
  });
});
