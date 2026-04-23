import { describe, expect, it } from "vitest";
import {
  createManySetsSchema,
  createSetSchema,
  visionRecognizeSchema,
} from "../lib/validators/workout";

describe("validators", () => {
  it("accepts a single set payload with variable values", () => {
    const parsed = createSetSchema.parse({
      sessionId: "session_1",
      exercise: "Back Squat",
      reps: 6,
      weight: 100,
      weightUnit: "kg",
      setNumber: 1,
      source: "manual",
    });
    expect(parsed.exercise).toBe("Back Squat");
  });

  it("accepts multi-set payload with changing reps and weights", () => {
    const parsed = createManySetsSchema.parse({
      sessionId: "session_2",
      exercise: "Incline Dumbbell Press",
      source: "chat",
      entries: [
        { reps: 12, weight: 20, weightUnit: "kg" },
        { reps: 10, weight: 22.5, weightUnit: "kg" },
        { reps: 8, weight: 25, weightUnit: "kg" },
      ],
    });
    expect(parsed.entries[1].weight).toBe(22.5);
    expect(parsed.entries[2].reps).toBe(8);
    expect(parsed.startingSetNumber).toBeUndefined();
  });

  it("accepts optional startingSetNumber for bulk append", () => {
    const parsed = createManySetsSchema.parse({
      sessionId: "session_2",
      exercise: "Bench Press",
      source: "chat",
      startingSetNumber: 6,
      entries: [{ reps: 5, weight: 100, weightUnit: "kg" }],
    });
    expect(parsed.startingSetNumber).toBe(6);
  });

  it("requires image payload for recognition", () => {
    expect(() =>
      visionRecognizeSchema.parse({
        imageBase64: "",
      }),
    ).toThrow();
  });
});
