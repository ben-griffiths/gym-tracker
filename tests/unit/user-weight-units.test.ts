import { describe, expect, it } from "vitest";
import {
  computeVolumeForDisplayPreference,
  summarizeSetsForDisplayPreference,
} from "@/lib/workout-history";
import {
  KG_PER_LB,
  displayNumberToKg,
  formatWeightKgForDisplay,
  kgToDisplayNumber,
  suffixForUnit,
  toKg,
} from "@/lib/weight-units";

describe("user weight unit helpers", () => {
  it("suffixForUnit matches preference", () => {
    expect(suffixForUnit("kg")).toBe("kg");
    expect(suffixForUnit("lb")).toBe("lb");
  });

  it("converts canonical kg ⇄ display numbers without chaining errors", () => {
    expect(kgToDisplayNumber(100, "kg")).toBe(100);
    expect(displayNumberToKg(100, "kg")).toBe(100);
    const lbs = kgToDisplayNumber(100, "lb");
    expect(lbs).toBeCloseTo(100 / KG_PER_LB, 6);
    expect(displayNumberToKg(lbs, "lb")).toBeCloseTo(100, 6);
    expect(toKg(220.46226218, "lb")).toBeCloseTo(100, 4);
  });

  it("formatWeightKgForDisplay rounds compactly per unit", () => {
    expect(formatWeightKgForDisplay(100.04, "kg")).toBe("100");
    expect(formatWeightKgForDisplay(45.359237, "lb")).toBe("100");
  });

  it("computeVolumeForDisplayPreference sums reps × mass in preferred unit", () => {
    const sets = [{ id: "1", reps: 10, weight: 10, weightUnit: "kg" }];
    const kgVol = computeVolumeForDisplayPreference(sets, "kg");
    expect(kgVol.unitSuffix).toBe("kg");
    expect(kgVol.volume).toBe(100);

    const lbVol = computeVolumeForDisplayPreference(sets, "lb");
    expect(lbVol.unitSuffix).toBe("lb");
    expect(lbVol.volume).toBe(
      Math.round(10 * kgToDisplayNumber(10, "lb")),
    );
  });

  it("summarizeSetsForDisplayPreference formats using display unit", () => {
    const sets = [
      {
        id: "1",
        exerciseName: "x",
        reps: 5,
        weight: 100,
        weightUnit: "kg",
      },
      {
        id: "2",
        exerciseName: "x",
        reps: 5,
        weight: 100,
        weightUnit: "kg",
      },
    ];
    const s = summarizeSetsForDisplayPreference(sets, "lb");
    expect(s).toContain("lb");
    expect(s).not.toContain("kg");
  });
});
