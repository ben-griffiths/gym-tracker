"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Dumbbell } from "lucide-react";
import {
  getExerciseByName,
  getExerciseBySlug,
  searchExercises,
} from "@/lib/exercises";
import { flattenSets, type HistoryResponse } from "@/lib/workout-history";
import { toKg } from "@/lib/lift-profiles";
import { estimateOneRm, percentageOfOneRm } from "@/lib/rep-percentages";

const REP_COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type EstimateSource = {
  reps: number;
  weightKg: number;
};

type RepMaxRow = {
  slug: string;
  exerciseName: string;
  iconPath: string | null;
  maxes: Record<number, number>;
  bestWeight: number;
  estimatedOneRm: number | null;
  estimateSource: EstimateSource | null;
  /**
   * Highest rep count achieved for this exercise, regardless of whether any
   * weight was added. Used to surface bodyweight-only exercises (dips,
   * pull-ups, etc.) that would otherwise be invisible on this page.
   */
  bestBodyweightReps: number | null;
};

export default function RepMaxesPage() {
  const [repPage, setRepPage] = useState<0 | 1>(0);

  const historyQuery = useQuery<HistoryResponse>({
    queryKey: ["workouts"],
    queryFn: async () => {
      const response = await fetch("/api/workouts");
      if (!response.ok) {
        let message = "Failed to load history";
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {}
        throw new Error(message);
      }
      return response.json();
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const rows = useMemo<RepMaxRow[]>(() => {
    const sessions = (historyQuery.data?.groups ?? []).flatMap(
      (group) => group.sessions,
    );

    // slug -> aggregated state for the row
    const byExercise = new Map<
      string,
      {
        exerciseName: string;
        iconPath: string | null;
        maxes: Map<number, number>;
        estimatedOneRm: number;
        estimateSource: EstimateSource | null;
        bestBodyweightReps: number;
      }
    >();

    for (const session of sessions) {
      for (const set of flattenSets(session)) {
        const numericWeight = Number(set.weight);
        // Allow zero-weight (bodyweight) sets through — we still want dips,
        // pull-ups etc. to appear on the page. Skip negative / non-finite.
        if (!Number.isFinite(numericWeight) || numericWeight < 0) continue;
        const reps = typeof set.reps === "number" ? set.reps : null;
        if (reps === null || reps < 1) continue;

        const matched =
          getExerciseByName(set.exerciseName) ??
          searchExercises(set.exerciseName, 1)[0];
        const slug = matched?.slug ?? `custom:${set.exerciseName}`;
        const name = matched?.name ?? set.exerciseName;
        const iconPath = matched?.iconPath ?? null;

        const weightKg = toKg(numericWeight, set.weightUnit);

        let entry = byExercise.get(slug);
        if (!entry) {
          entry = {
            exerciseName: name,
            iconPath,
            maxes: new Map(),
            estimatedOneRm: 0,
            estimateSource: null,
            bestBodyweightReps: 0,
          };
          byExercise.set(slug, entry);
        }

        // Track heaviest weight per rep count (only cols 1..10 are rendered).
        if (reps <= 10) {
          const existing = entry.maxes.get(reps);
          if (existing === undefined || weightKg > existing) {
            entry.maxes.set(reps, weightKg);
          }
        }

        if (weightKg > 0) {
          // Track the set that yields the highest estimated 1RM — any rep
          // count is fair game here since StrengthLevel's table covers 1..30.
          const oneRm = estimateOneRm(weightKg, reps);
          if (oneRm > entry.estimatedOneRm) {
            entry.estimatedOneRm = oneRm;
            entry.estimateSource = { reps, weightKg };
          }
        } else if (reps > entry.bestBodyweightReps) {
          entry.bestBodyweightReps = reps;
        }
      }
    }

    const list: RepMaxRow[] = [];
    for (const [slug, entry] of byExercise.entries()) {
      const maxesObject: Record<number, number> = {};
      let bestWeight = 0;
      for (const [reps, weight] of entry.maxes.entries()) {
        maxesObject[reps] = weight;
        if (weight > bestWeight) bestWeight = weight;
      }
      list.push({
        slug,
        exerciseName: entry.exerciseName,
        iconPath: entry.iconPath,
        maxes: maxesObject,
        bestWeight,
        estimatedOneRm: entry.estimatedOneRm > 0 ? entry.estimatedOneRm : null,
        estimateSource: entry.estimateSource,
        bestBodyweightReps:
          entry.bestBodyweightReps > 0 ? entry.bestBodyweightReps : null,
      });
    }

    return list.sort((a, b) => {
      // Weighted lifts (with an estimated 1RM) come before pure bodyweight
      // rows. Within each group, sort by the most impressive metric.
      const aEst = a.estimatedOneRm ?? 0;
      const bEst = b.estimatedOneRm ?? 0;
      if (bEst !== aEst) return bEst - aEst;
      const aReps = a.bestBodyweightReps ?? 0;
      const bReps = b.bestBodyweightReps ?? 0;
      if (bReps !== aReps) return bReps - aReps;
      return a.exerciseName.localeCompare(b.exerciseName);
    });
  }, [historyQuery.data]);

  const isLoading = historyQuery.isLoading;
  const isEmpty = !isLoading && rows.length === 0;
  const visibleRepColumns = useMemo(
    () => (repPage === 0 ? REP_COLUMNS.slice(0, 5) : REP_COLUMNS.slice(5, 10)),
    [repPage],
  );

  return (
    <div className="flex flex-col bg-background">
      <main className="flex-1 pb-10 pt-5">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          {isLoading ? (
            <div className="h-64 animate-pulse rounded-2xl border bg-card" />
          ) : isEmpty ? (
            <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed bg-card/40 px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Dumbbell className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">No rep data yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Log a few sets with reps and weight and they&apos;ll appear
                  here.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th
                        scope="col"
                        className="sticky left-0 z-10 w-44 bg-muted/40 px-2 py-2 text-left font-medium"
                      >
                        Exercise
                      </th>
                      {visibleRepColumns.map((reps, index) => (
                        <th
                          key={reps}
                          scope="col"
                          className="relative px-3 py-2 text-center font-medium"
                        >
                          {index === 0 ? (
                            <button
                              type="button"
                              onClick={() => setRepPage(0)}
                              disabled={repPage === 0}
                              aria-label="Show reps 1 to 5"
                              className="absolute left-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-foreground/70 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                          ) : null}
                          {reps}
                          {index === visibleRepColumns.length - 1 ? (
                            <button
                              type="button"
                              onClick={() => setRepPage(1)}
                              disabled={repPage === 1}
                              aria-label="Show reps 6 to 10"
                              className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-foreground/70 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          ) : null}
                        </th>
                      ))}
                      <th
                        scope="col"
                        className="border-l bg-muted/60 px-3 py-2 text-center font-semibold text-foreground"
                      >
                        Est&nbsp;1RM
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const record = !row.slug.startsWith("custom:")
                        ? getExerciseBySlug(row.slug)
                        : null;
                      const iconPath = row.iconPath ?? record?.iconPath ?? null;
                      return (
                        <tr
                          key={row.slug}
                          className="border-t transition-colors hover:bg-muted/30"
                        >
                          <th
                            scope="row"
                            className="sticky left-0 z-[1] w-44 bg-card px-2 py-2 text-left font-medium"
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                                {iconPath ? (
                                  <Image
                                    src={iconPath}
                                    alt=""
                                    width={24}
                                    height={24}
                                    className="h-6 w-6 object-contain"
                                    unoptimized
                                  />
                                ) : (
                                  <Dumbbell className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                              </span>
                              <span className="truncate">
                                {row.exerciseName}
                              </span>
                            </div>
                          </th>
                          {visibleRepColumns.map((reps) => {
                            const weight = row.maxes[reps];
                            // Each weighted cell is rendered as the projected
                            // 1RM for that weight × reps combo (using the
                            // StrengthLevel rep-percentage table) so the
                            // whole row is on the same scale. The cell that
                            // sourced row.estimatedOneRm sits at ratio 1
                            // (deepest green); weaker projections shade
                            // toward red. BW and empty cells stay neutral.
                            const hasWeight =
                              weight !== undefined && weight > 0;
                            const cellOneRm = hasWeight
                              ? estimateOneRm(weight, reps)
                              : null;
                            let tintStyle:
                              | { backgroundColor: string }
                              | undefined;
                            if (
                              cellOneRm !== null &&
                              row.estimatedOneRm !== null &&
                              row.estimatedOneRm > 0
                            ) {
                              const rawRatio = cellOneRm / row.estimatedOneRm;
                              const ratio = Math.max(0, Math.min(1, rawRatio));
                              // Map a realistic 0.75..1.00 projection window
                              // onto the full colour range so the differences
                              // between rep ranges are actually visible.
                              const normalized = Math.max(
                                0,
                                (ratio - 0.75) / 0.25,
                              );
                              const hue = Math.round(normalized * 120);
                              const alpha = 0.12 + normalized * 0.22;
                              tintStyle = {
                                backgroundColor: `hsl(${hue} 70% 45% / ${alpha})`,
                              };
                            }
                            const tiesRowBest =
                              cellOneRm !== null &&
                              row.estimatedOneRm !== null &&
                              row.estimatedOneRm > 0 &&
                              cellOneRm >= row.estimatedOneRm - 0.01;
                            const counterfactualKg =
                              row.estimatedOneRm !== null &&
                              row.estimatedOneRm > 0
                                ? row.estimatedOneRm *
                                  percentageOfOneRm(reps)
                                : null;
                            return (
                              <td
                                key={reps}
                                className="whitespace-nowrap px-3 py-2 text-center tabular-nums"
                                style={tintStyle}
                              >
                                {weight === undefined &&
                                counterfactualKg !== null &&
                                counterfactualKg > 0 ? (
                                  <span className="text-[10px] font-medium text-muted-foreground">
                                    {Math.round(counterfactualKg)}
                                  </span>
                                ) : weight === undefined ? (
                                  <span className="text-muted-foreground/40">
                                    —
                                  </span>
                                ) : cellOneRm !== null ? (
                                  <div className="flex flex-col items-center leading-tight">
                                    {tiesRowBest ? (
                                      <span className="font-medium">
                                        {Math.round(weight)}
                                      </span>
                                    ) : counterfactualKg !== null ? (
                                      <>
                                        <span className="font-medium">
                                          {Math.round(weight)}
                                        </span>
                                        <span className="text-[10px] font-medium text-muted-foreground">
                                          {Math.round(counterfactualKg)}
                                        </span>
                                      </>
                                    ) : (
                                      <span className="font-medium">
                                        {Math.round(weight)}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-[11px] font-medium">
                                    BW
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className="whitespace-nowrap border-l bg-muted/20 px-3 py-2 text-center tabular-nums">
                            {row.estimatedOneRm !== null &&
                            row.estimateSource ? (
                              <div className="flex flex-col items-center leading-tight">
                                <span className="font-semibold">
                                  {Math.round(row.estimatedOneRm)}
                                </span>
                                <span className="text-[10px] font-normal text-muted-foreground">
                                  {Math.round(row.estimateSource.weightKg)} ×{" "}
                                  {row.estimateSource.reps}
                                </span>
                              </div>
                            ) : row.bestBodyweightReps !== null ? (
                              <div className="flex flex-col items-center leading-tight">
                                <span className="font-semibold">
                                  {row.bestBodyweightReps}
                                </span>
                                <span className="text-[10px] font-normal text-muted-foreground">
                                  reps · bodyweight
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground/40">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Your row&apos;s{" "}
            <span className="font-medium">Est&nbsp;1RM</span> is the strongest
            projection across all logged sets. In each rep column, the{" "}
            <span className="font-medium">main number</span> is always what you
            actually lifted. If that set ties your best projection, that&apos;s
            all we show.             Otherwise a second line shows the{" "}
            <span className="font-medium">target</span> weight at that rep
            count that would match the same estimated 1RM
            (StrengthLevel rep-% table). Empty rep columns show that same
            target from your row Est&nbsp;1RM only (no tint). Cell colour still
            compares your{" "}
            <span className="font-medium">actual</span> projection to your best.
            <span className="font-medium"> BW</span> is bodyweight-only. The
            Est&nbsp;1RM column shows the peak projection and the weight × reps
            that produced it. Weights in kg (from your log).
          </p>
        </div>
      </main>
    </div>
  );
}
