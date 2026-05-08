import { describe, expect, it } from "vitest";
import { tryWorkoutChatLocalFastPath } from "@/lib/workout-chat/local-fast-chat";
import type { ChatContextSnapshot } from "@/lib/types/workout";

const emptyContext: ChatContextSnapshot | undefined = { blocks: [] };

describe("tryWorkoutChatLocalFastPath", () => {
  it("parses word-order log-new with weight", () => {
    const r = tryWorkoutChatLocalFastPath({
      message: "bench press 5 reps 3 sets @ 72.5kg",
      context: emptyContext,
    });
    expect(r).not.toBeNull();
    expect(r!.sets).toHaveLength(3);
    expect(r!.sets[0]?.reps).toBe(5);
    expect(r!.sets[0]?.weight).toBe(72.5);
    expect(r!.localParse?.skippedLlm).toBe(true);
    expect(r!.localParse?.kind).toBe("regex");
    expect(r!.localParse?.matchedPattern).toBe("log-new");
  });

  it("parses classic shorthand 5×5", () => {
    const r = tryWorkoutChatLocalFastPath({
      message: "bench 5x5 100kg",
      context: emptyContext,
    });
    expect(r).not.toBeNull();
    expect(r!.sets).toHaveLength(5);
    expect(r!.localParse?.matchedPattern).toBe("log-new");
  });

  it("parses N sets of M (natural phrasing)", () => {
    const r = tryWorkoutChatLocalFastPath({
      message: "Bench Press 5 sets of 5",
      context: emptyContext,
    });
    expect(r).not.toBeNull();
    expect(r!.sets).toHaveLength(5);
    expect(r!.sets.every((s) => s.reps === 5)).toBe(true);
    expect(r!.autoResolvedExercise?.slug).toBe("bench-press");
    expect(r!.localParse?.matchedPattern).toBe("log-new");
  });

  it("parses N sets of M with optional weight", () => {
    const r = tryWorkoutChatLocalFastPath({
      message: "bench 3 sets of 12 @ 80 kg",
      context: emptyContext,
    });
    expect(r).not.toBeNull();
    expect(r!.sets).toHaveLength(3);
    expect(r!.sets.every((s) => s.reps === 12 && s.weight === 80)).toBe(true);
  });

  it("returns null when digits appear but no rule matches (incomplete prescription)", () => {
    const r = tryWorkoutChatLocalFastPath({
      message: "bench 5 reps 3 sets",
      context: emptyContext,
    });
    expect(r).toBeNull();
  });

  it("uses kind suggest when only chips built the draft", () => {
    const r = tryWorkoutChatLocalFastPath({
      message: "bench 3x5 80kg",
      context: emptyContext,
      usedSuggestions: true,
    });
    expect(r?.localParse?.kind).toBe("suggest");
    expect(r?.localParse?.usedSuggestions).toBe(true);
  });

  it("parses NxM @ weight (log-new) with correct load", () => {
    const r = tryWorkoutChatLocalFastPath({
      message: "military press 1x1 @ 75kg",
      context: emptyContext,
    });
    expect(r).not.toBeNull();
    expect(r!.sets).toHaveLength(1);
    expect(r!.sets[0]?.reps).toBe(1);
    expect(r!.sets[0]?.weight).toBe(75);
    expect(r!.autoResolvedExercise?.slug).toBe("military-press");
    expect(r!.localParse?.matchedPattern).toBe("log-new");
  });

  it("logs a newly named lift when the active block is a different exercise", () => {
    const context: ChatContextSnapshot = {
      blocks: [
        {
          exerciseSlug: "military-press",
          exerciseName: "Military Press",
          isActive: true,
          sets: [
            {
              setNumber: 1,
              reps: 5,
              weight: 65,
              weightUnit: "kg",
              rpe: null,
              rir: null,
              feel: null,
            },
          ],
        },
      ],
    };
    const r = tryWorkoutChatLocalFastPath({
      message: "Strict Curl 1x1 @ 65kg",
      context,
    });
    expect(r).not.toBeNull();
    expect(r!.autoResolvedExercise?.slug).toBe("strict-curl");
    expect(r!.sets[0]?.weight).toBe(65);
    expect(r!.sets[0]?.reps).toBe(1);
  });
});
