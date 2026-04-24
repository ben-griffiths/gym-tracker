import { describe, expect, it } from "vitest";
import {
  rehydrationExerciseGroupsInOrder,
  type HistorySession,
} from "../lib/workout-history";

describe("rehydrationExerciseGroupsInOrder", () => {
  it("includes catalog exercises with no sets in session order", () => {
    const session: HistorySession = {
      id: "s1",
      name: "Test",
      exercises: [
        {
          orderIndex: 0,
          exercise: { name: "Squat" },
          sets: [],
        },
        {
          orderIndex: 1,
          exercise: { name: "Bench Press" },
          sets: [
            {
              id: "set1",
              reps: 5,
              weight: 60,
              weightUnit: "kg",
              setNumber: 1,
            },
          ],
        },
      ],
    };
    const groups = rehydrationExerciseGroupsInOrder(session);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.exerciseName).toBe("Squat");
    expect(groups[0]!.sets).toHaveLength(0);
    expect(groups[1]!.exerciseName).toBe("Bench Press");
    expect(groups[1]!.sets).toHaveLength(1);
  });
});
