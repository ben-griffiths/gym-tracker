import { describe, expect, it } from "vitest";
import { EXERCISES, getExerciseBySlug } from "@/lib/exercises";
import {
  buildRepMaxRows,
  catalogIntermediateOneRmKg,
  compareRowsWithLoggedDataDesc,
} from "@/lib/rep-maxes";
import type { HistorySession } from "@/lib/workout-history";

/** Bench Press `standards`: male intermediate 98 kg, female 51 kg → neutral (98+51)/2 in kg. */
const BENCH_NEUTRAL_INTERMEDIATE_KG = (98 + 51) / 2;

describe("catalogIntermediateOneRmKg", () => {
  it("uses neutral average of male/female intermediate (Bench Press fixture)", () => {
    const bench = getExerciseBySlug("bench-press");
    expect(bench).not.toBeNull();
    expect(catalogIntermediateOneRmKg(bench!)).toBe(BENCH_NEUTRAL_INTERMEDIATE_KG);
  });
});

describe("buildRepMaxRows", () => {
  it("lists every catalog exercise once with no sessions (A–Z)", () => {
    const rows = buildRepMaxRows([]);
    expect(rows).toHaveLength(EXERCISES.length);
    const names = rows.map((r) => r.exerciseName);
    const sorted = [...names].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    expect(names).toEqual(sorted);
  });

  it("marks catalog bench row with inferred intermediate 1RM (not logged)", () => {
    const rows = buildRepMaxRows([]);
    const bench = rows.find((r) => r.slug === "bench-press");
    expect(bench).toBeDefined();
    expect(bench!.estimateKind).toBe("catalog");
    expect(bench!.estimatedOneRm).toBe(BENCH_NEUTRAL_INTERMEDIATE_KG);
    expect(bench!.estimateSource).toBeNull();
  });

  it("keeps logged catalog lifts once and drops them from the catalog tail", () => {
    const sessions: HistorySession[] = [
      {
        id: "s1",
        name: "W",
        sets: [
          {
            id: "x1",
            exercise: "Bench Press",
            weight: 100,
            reps: 5,
            weightUnit: "kg",
          },
        ],
      },
    ];
    const rows = buildRepMaxRows(sessions);
    expect(rows.filter((r) => r.slug === "bench-press")).toHaveLength(1);
    expect(rows.some((r) => r.slug === "bench-press" && r.estimateKind === "logged")).toBe(
      true,
    );
    expect(rows).toHaveLength(EXERCISES.length);
  });

  it("sorts logged rows by higher estimated 1RM (kg) first", () => {
    const sessions: HistorySession[] = [
      {
        id: "s1",
        name: "W",
        sets: [
          {
            id: "a",
            exercise: "Bench Press",
            weight: 100,
            reps: 5,
            weightUnit: "kg",
          },
          {
            id: "b",
            exercise: "Deadlift",
            weight: 140,
            reps: 5,
            weightUnit: "kg",
          },
        ],
      },
    ];
    const rows = buildRepMaxRows(sessions);
    const logged = rows.filter(
      (r) => r.estimateKind === "logged" || r.bestBodyweightReps !== null,
    );
    expect(logged.length).toBeGreaterThanOrEqual(2);
    const benchRow = rows.find((r) => r.slug === "bench-press");
    const deadRow = rows.find((r) => r.slug === "deadlift");
    expect(benchRow).toBeDefined();
    expect(deadRow).toBeDefined();
    expect(benchRow!.estimateKind).toBe("logged");
    expect(deadRow!.estimateKind).toBe("logged");
    if (deadRow!.estimatedOneRm !== null && benchRow!.estimatedOneRm !== null) {
      expect(deadRow!.estimatedOneRm).toBeGreaterThanOrEqual(benchRow!.estimatedOneRm);
    }
    const iBench = rows.findIndex((r) => r.slug === "bench-press");
    const iDead = rows.findIndex((r) => r.slug === "deadlift");
    expect(iDead).toBeLessThan(iBench);
  });

  it("places every logged row before any catalog-only inferred row", () => {
    const sessions: HistorySession[] = [
      {
        id: "s1",
        name: "W",
        sets: [
          {
            id: "a",
            exercise: "Deadlift",
            weight: 40,
            reps: 5,
            weightUnit: "kg",
          },
        ],
      },
    ];
    const rows = buildRepMaxRows(sessions);
    const firstCatalogOnly = rows.findIndex((r) => r.estimateKind === "catalog");
    const iDead = rows.findIndex((r) => r.slug === "deadlift");
    expect(firstCatalogOnly).toBeGreaterThan(0);
    expect(iDead).toBeLessThan(firstCatalogOnly);
  });
});

describe("compareRowsWithLoggedDataDesc", () => {
  it("orders pure bodyweight rows after all weighted rows by default", () => {
    const weighted = {
      slug: "a",
      exerciseName: "A",
      iconPath: null,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: 100,
      estimateSource: { weightKg: 80, reps: 5 },
      estimateKind: "logged" as const,
      bestBodyweightReps: null,
    };
    const bw = {
      slug: "b",
      exerciseName: "B",
      iconPath: null,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: null,
      estimateSource: null,
      estimateKind: null,
      bestBodyweightReps: 15,
    };
    expect(compareRowsWithLoggedDataDesc(weighted, bw)).toBeLessThan(0);
    expect(compareRowsWithLoggedDataDesc(bw, weighted)).toBeGreaterThan(0);
  });
});
