import { describe, expect, it } from "vitest";
import { EXERCISES, getExerciseBySlug } from "@/lib/exercises";
import {
  buildRepMaxRows,
  catalogIntermediateOneRmKg,
  compareCatalogOnlyRowsDesc,
  compareRowsWithLoggedDataDesc,
  type RepMaxRow,
  type RepMaxTableItem,
} from "@/lib/rep-maxes";
import type { HistorySession } from "@/lib/workout-history";

/** Bench Press fixture: male intermediate 98 kg, female intermediate 51 kg */
const BENCH_MALE_INTERMEDIATE_KG = 98;
const BENCH_FEMALE_INTERMEDIATE_KG = 51;

function dataRowsOnly(items: RepMaxTableItem[]): RepMaxRow[] {
  return items
    .filter((i): i is { kind: "row"; row: RepMaxRow } => i.kind === "row")
    .map((i) => i.row);
}

describe("catalogIntermediateOneRmKg", () => {
  it("uses male intermediate tier by default when available (Bench Press fixture)", () => {
    const bench = getExerciseBySlug("bench-press");
    expect(bench).not.toBeNull();
    expect(catalogIntermediateOneRmKg(bench!, "male")).toBe(BENCH_MALE_INTERMEDIATE_KG);
    expect(catalogIntermediateOneRmKg(bench!)).toBe(BENCH_MALE_INTERMEDIATE_KG);
  });

  it("uses female intermediate when requested", () => {
    const bench = getExerciseBySlug("bench-press");
    expect(bench).not.toBeNull();
    expect(catalogIntermediateOneRmKg(bench!, "female")).toBe(
      BENCH_FEMALE_INTERMEDIATE_KG,
    );
  });
});

describe("buildRepMaxRows", () => {
  it("lists every catalog exercise once with no sessions (order: popularity, then Est 1RM, nulls last, then name)", () => {
    const items = buildRepMaxRows([]);
    expect(items.some((i) => i.kind === "separator")).toBe(false);
    const rows = dataRowsOnly(items);
    expect(rows).toHaveLength(EXERCISES.length);
    const sorted = [...rows].sort(compareCatalogOnlyRowsDesc);
    expect(rows.map((r) => r.slug)).toEqual(sorted.map((r) => r.slug));
  });

  it("marks catalog bench row with inferred intermediate 1RM (not logged)", () => {
    const items = buildRepMaxRows([]);
    const bench = dataRowsOnly(items).find((r) => r.slug === "bench-press");
    expect(bench).toBeDefined();
    expect(bench!.estimateKind).toBe("catalog");
    expect(bench!.estimatedOneRm).toBe(BENCH_MALE_INTERMEDIATE_KG);
    expect(bench!.estimateSource).toBeNull();
  });

  it("uses female catalog intermediate when sex is female", () => {
    const items = buildRepMaxRows([], "female");
    const bench = dataRowsOnly(items).find((r) => r.slug === "bench-press");
    expect(bench?.estimateKind).toBe("catalog");
    expect(bench!.estimatedOneRm).toBe(BENCH_FEMALE_INTERMEDIATE_KG);
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
    const items = buildRepMaxRows(sessions);
    expect(items.filter((i) => i.kind === "separator")).toHaveLength(1);
    const rows = dataRowsOnly(items);
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
    const items = buildRepMaxRows(sessions);
    const rows = dataRowsOnly(items);
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
    const sep = items.findIndex((i) => i.kind === "separator");
    expect(sep).toBeGreaterThan(-1);
    const iBench = items.findIndex((i) => i.kind === "row" && i.row.slug === "bench-press");
    const iDead = items.findIndex((i) => i.kind === "row" && i.row.slug === "deadlift");
    expect(iDead).toBeLessThan(iBench);
    expect(iBench).toBeLessThan(sep);
    expect(iDead).toBeLessThan(sep);
  });

  it("places every logged row before any catalog-only inferred row, with a separator in between", () => {
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
    const items = buildRepMaxRows(sessions);
    const sep = items.findIndex((i) => i.kind === "separator");
    const firstCatalogOnly = items.findIndex(
      (i) => i.kind === "row" && i.row.estimateKind === "catalog",
    );
    const iDead = items.findIndex((i) => i.kind === "row" && i.row.slug === "deadlift");
    expect(sep).toBeGreaterThan(0);
    expect(firstCatalogOnly).toBeGreaterThan(sep);
    expect(iDead).toBeLessThan(sep);
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

describe("compareCatalogOnlyRowsDesc", () => {
  it("orders a more popular lift ahead of a higher catalog Est 1RM", () => {
    const bench: RepMaxRow = {
      slug: "bench-press",
      exerciseName: "Bench Press",
      iconPath: null,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: 80,
      estimateSource: null,
      estimateKind: "catalog",
      bestBodyweightReps: null,
    };
    const arnold: RepMaxRow = {
      slug: "arnold-press",
      exerciseName: "Arnold Press",
      iconPath: null,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: 300,
      estimateSource: null,
      estimateKind: "catalog",
      bestBodyweightReps: null,
    };
    expect(compareCatalogOnlyRowsDesc(bench, arnold)).toBeLessThan(0);
    expect(compareCatalogOnlyRowsDesc(arnold, bench)).toBeGreaterThan(0);
  });

  it("orders higher catalog Est 1RM first", () => {
    const hi = {
      slug: "a",
      exerciseName: "A",
      iconPath: null,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: 200,
      estimateSource: null,
      estimateKind: "catalog" as const,
      bestBodyweightReps: null,
    };
    const lo = {
      slug: "b",
      exerciseName: "B",
      iconPath: null,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: 100,
      estimateSource: null,
      estimateKind: "catalog" as const,
      bestBodyweightReps: null,
    };
    expect(compareCatalogOnlyRowsDesc(hi, lo)).toBeLessThan(0);
    expect(compareCatalogOnlyRowsDesc(lo, hi)).toBeGreaterThan(0);
  });

  it("places null Est 1RM after numeric estimates", () => {
    const withEst: RepMaxRow = {
      slug: "a",
      exerciseName: "Zebra",
      iconPath: null,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: 50,
      estimateSource: null,
      estimateKind: "catalog",
      bestBodyweightReps: null,
    };
    const noEst: RepMaxRow = {
      slug: "b",
      exerciseName: "Apple",
      iconPath: null,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: null,
      estimateSource: null,
      estimateKind: null,
      bestBodyweightReps: null,
    };
    expect(compareCatalogOnlyRowsDesc(withEst, noEst)).toBeLessThan(0);
    expect(compareCatalogOnlyRowsDesc(noEst, withEst)).toBeGreaterThan(0);
  });

  it("when both Est 1RM are null, sorts by exercise name A–Z", () => {
    const zebra: RepMaxRow = {
      slug: "z",
      exerciseName: "Zebra",
      iconPath: null,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: null,
      estimateSource: null,
      estimateKind: null,
      bestBodyweightReps: null,
    };
    const apple: RepMaxRow = {
      slug: "a",
      exerciseName: "Apple",
      iconPath: null,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: null,
      estimateSource: null,
      estimateKind: null,
      bestBodyweightReps: null,
    };
    expect(compareCatalogOnlyRowsDesc(apple, zebra)).toBeLessThan(0);
    expect(compareCatalogOnlyRowsDesc(zebra, apple)).toBeGreaterThan(0);
  });

  it("breaks ties on equal numeric Est 1RM by exercise name A–Z", () => {
    const b: RepMaxRow = {
      slug: "b",
      exerciseName: "Bench",
      iconPath: null,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: 100,
      estimateSource: null,
      estimateKind: "catalog",
      bestBodyweightReps: null,
    };
    const a: RepMaxRow = {
      slug: "a",
      exerciseName: "Arnold",
      iconPath: null,
      maxes: {},
      bestWeight: 0,
      estimatedOneRm: 100,
      estimateSource: null,
      estimateKind: "catalog",
      bestBodyweightReps: null,
    };
    expect(compareCatalogOnlyRowsDesc(a, b)).toBeLessThan(0);
    expect(compareCatalogOnlyRowsDesc(b, a)).toBeGreaterThan(0);
  });
});
