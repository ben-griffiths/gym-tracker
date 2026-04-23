import { describe, expect, it } from "vitest";
import { getExerciseBySlug, searchExercises } from "../lib/exercises";

describe("exercise library", () => {
  it("has known bench press entry", () => {
    const bench = getExerciseBySlug("bench-press");
    expect(bench).not.toBeNull();
    expect(bench?.name).toBe("Bench Press");
    expect(bench?.iconPath).toBe("/exercises/icons/bench-press.png");
  });

  it("returns ranked matches for bench query", () => {
    const matches = searchExercises("bench", 5);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(5);
    expect(matches.map((m) => m.slug)).toContain("bench-press");
  });

  it("returns an empty array for unknown query", () => {
    const matches = searchExercises("foobarbaz", 5);
    expect(matches).toEqual([]);
  });
});
