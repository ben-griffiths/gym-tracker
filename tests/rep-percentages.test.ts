import { describe, expect, it } from "vitest";
import {
  estimateOneRm,
  prefillSetsFromEstimatedOneRm,
  percentageOfOneRm,
  repsAtRpe,
  suggestWeightsForSetSequence,
} from "@/lib/rep-percentages";

describe("rep-percentages", () => {
  it("returns 100% for a single rep", () => {
    expect(percentageOfOneRm(1)).toBe(1);
  });

  it("matches the StrengthLevel published percentages", () => {
    // Spot-check a handful of published values from
    // https://strengthlevel.com/one-rep-max-calculator
    expect(percentageOfOneRm(3)).toBeCloseTo(0.94, 3);
    expect(percentageOfOneRm(5)).toBeCloseTo(0.89, 3);
    expect(percentageOfOneRm(10)).toBeCloseTo(0.75, 3);
    expect(percentageOfOneRm(20)).toBeCloseTo(0.6, 3);
  });

  it("clamps rep counts outside the scraped range", () => {
    expect(percentageOfOneRm(0)).toBe(1);
    expect(percentageOfOneRm(-3)).toBe(1);
    expect(percentageOfOneRm(40)).toBeCloseTo(0.5, 3);
  });

  it("rounds fractional reps to the nearest whole number", () => {
    expect(percentageOfOneRm(5.4)).toBeCloseTo(0.89, 3);
    expect(percentageOfOneRm(5.6)).toBeCloseTo(0.86, 3);
  });

  it("estimates 1RM by dividing weight by the rep percentage", () => {
    // 100kg for 5 reps at 89% -> ~112.4kg 1RM
    expect(estimateOneRm(100, 5)).toBeCloseTo(112.36, 1);
    // 80kg for 10 reps at 75% -> ~106.67kg 1RM
    expect(estimateOneRm(80, 10)).toBeCloseTo(106.67, 1);
    // Single rep stays at the lifted weight
    expect(estimateOneRm(140, 1)).toBe(140);
  });

  it("returns 0 for non-positive weights", () => {
    expect(estimateOneRm(0, 5)).toBe(0);
    expect(estimateOneRm(-10, 5)).toBe(0);
  });

  it("treats missing/invalid reps as a single rep", () => {
    expect(estimateOneRm(100, 0)).toBe(100);
    expect(estimateOneRm(100, Number.NaN)).toBe(100);
  });

  describe("repsAtRpe", () => {
    // Use 115kg as 1RM (matches the chat scenario in the bug report).
    const ONE_RM = 115;

    it("returns 1 rep when the weight is at/above 1RM", () => {
      expect(repsAtRpe(115, ONE_RM, 8)).toBe(1);
      expect(repsAtRpe(120, ONE_RM, 8)).toBe(1);
    });

    it("matches the chip math: 60kg @115kg 1RM @ RPE 8 leaves room for many reps", () => {
      // 60/115 ≈ 52% — well below the heaviest rep entry, so failure
      // ends up high on the table and RPE 8 lands at MAX_REPS - 2.
      const reps = repsAtRpe(60, ONE_RM, 8);
      expect(reps).not.toBeNull();
      expect((reps ?? 0) >= 20).toBe(true);
      expect((reps ?? 0) <= 30).toBe(true);
    });

    it("scales reps down as weight approaches 1RM at RPE 8", () => {
      const heavy = repsAtRpe(100, ONE_RM, 8);
      const lighter = repsAtRpe(80, ONE_RM, 8);
      expect(heavy).not.toBeNull();
      expect(lighter).not.toBeNull();
      expect((lighter ?? 0) > (heavy ?? 0)).toBe(true);
    });

    it("respects targetRpe — RPE 10 leaves 0 RIR, RPE 7 leaves 3 RIR", () => {
      const failure = repsAtRpe(80, ONE_RM, 10) ?? 0;
      const rpe8 = repsAtRpe(80, ONE_RM, 8) ?? 0;
      const rpe7 = repsAtRpe(80, ONE_RM, 7) ?? 0;
      expect(failure - rpe8).toBe(2);
      expect(failure - rpe7).toBe(3);
    });

    it("returns null for invalid inputs", () => {
      expect(repsAtRpe(0, ONE_RM, 8)).toBeNull();
      expect(repsAtRpe(80, 0, 8)).toBeNull();
      expect(repsAtRpe(80, ONE_RM, 11)).toBeNull();
      expect(repsAtRpe(Number.NaN, ONE_RM, 8)).toBeNull();
    });
  });

  describe("prefillSetsFromEstimatedOneRm", () => {
    it("prefills reps and weights for a newly added exercise when a 1RM exists", () => {
      const pending = Array.from({ length: 5 }, () => ({
        reps: null,
        weight: null,
        weightUnit: "kg" as const,
      }));
      const filled = prefillSetsFromEstimatedOneRm(pending, 120, {
        targetRpe: 8,
        defaultReps: 5,
      });

      expect(filled.every((set) => set.reps === 5)).toBe(true);
      expect(filled.every((set) => set.weight !== null && set.weight! > 0)).toBe(
        true,
      );
      // Rounded to gym-friendly 5kg jumps (same behavior as suggestion chips).
      expect(filled.every((set) => Number(set.weight) % 5 === 0)).toBe(true);
    });

    it("uses existing values and only fills missing fields", () => {
      const pending = [
        { reps: 3, weight: null, weightUnit: "kg" as const },
        { reps: null, weight: 100, weightUnit: "kg" as const },
      ];
      const filled = prefillSetsFromEstimatedOneRm(pending, 150, {
        targetRpe: 8,
        defaultReps: 5,
      });
      expect(filled[0]?.reps).toBe(3);
      expect(filled[0]?.weight).not.toBeNull();
      expect(filled[1]?.weight).toBe(100);
      expect(filled[1]?.reps).not.toBeNull();
    });
  });

  describe("suggestWeightsForSetSequence (warmups)", () => {
    it("ramps warmups from ~30% 1RM up to near working load", () => {
      const sequence = suggestWeightsForSetSequence(
        [
          { reps: 5 },
          { reps: 5 },
          { reps: 5 },
          { reps: 5 },
          { reps: 5 },
        ],
        120,
        { targetRpe: 8, warmupSets: 2 },
      );

      expect(sequence).toHaveLength(5);
      expect(sequence[0]).toBeCloseTo(36, 1); // ~30% 1RM start
      expect((sequence[1] ?? 0) > (sequence[0] ?? 0)).toBe(true); // ramp
      // working sets should settle on the same working weight target.
      expect(sequence[2]).toBeCloseTo(sequence[3] ?? 0, 6);
      expect(sequence[3]).toBeCloseTo(sequence[4] ?? 0, 6);
      expect((sequence[1] ?? 0) < (sequence[2] ?? 0)).toBe(true);
    });

    it("keeps 2nd warmup between 1st warmup and working weight", () => {
      const sequence = suggestWeightsForSetSequence(
        [
          { reps: 5 },
          { reps: 5 },
          { reps: 5 },
          { reps: 5 },
          { reps: 5 },
        ],
        120,
        { targetRpe: 8, warmupSets: 2 },
      );
      const firstWarmup = sequence[0] ?? 0;
      const secondWarmup = sequence[1] ?? 0;
      const working = sequence[2] ?? 0;
      expect(firstWarmup).toBeCloseTo(120 * 0.3, 6);
      expect(secondWarmup).toBeGreaterThan(firstWarmup);
      expect(secondWarmup).toBeLessThan(working);
    });
  });
});
