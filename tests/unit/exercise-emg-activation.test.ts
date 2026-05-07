import { describe, expect, it } from "vitest";

import { EXERCISES } from "../../lib/exercises";
import {
  EXERCISE_EMG_ACTIVATION,
  getExerciseEmgActivation,
  MUSCLE_GROUPS,
} from "../../lib/exercise-emg-activation";

describe("exercise-emg-activation", () => {
  it("returns activation objects for known catalog slugs", () => {
    for (const slug of ["bench-press", "squat", "deadlift"]) {
      const row = getExerciseEmgActivation(slug);
      expect(row).not.toBeNull();
      expect(row!.relativeEmg).toBeDefined();
      for (const m of MUSCLE_GROUPS) {
        expect(typeof row!.relativeEmg[m]).toBe("number");
        expect(row!.relativeEmg[m]).toBeGreaterThanOrEqual(0);
        expect(row!.relativeEmg[m]).toBeLessThanOrEqual(100);
      }
    }
  });

  it("returns null for unknown slugs", () => {
    expect(getExerciseEmgActivation("not-a-real-exercise-slug-xyz")).toBeNull();
  });

  it("maps every catalog exercise slug", () => {
    expect(Object.keys(EXERCISE_EMG_ACTIVATION)).toHaveLength(EXERCISES.length);
  });

  it("routes every exercise away from the generic fallback bucket", () => {
    for (const [slug, row] of Object.entries(EXERCISE_EMG_ACTIVATION)) {
      expect(row.notes ?? "", slug).not.toContain("Fallback composite");
    }
  });
});
