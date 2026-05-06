"use client";

import { ExerciseIconImage } from "@/components/workout/exercise-icon-image";
import { useMemo } from "react";
import { Dumbbell } from "lucide-react";
import { getExerciseBySlug } from "@/lib/exercises";
import { flattenSets } from "@/lib/workout-history";
import { useHistoryGroups } from "@/lib/sync/workouts-live";
import { estimateOneRm, percentageOfOneRm } from "@/lib/rep-percentages";
import {
  buildRepMaxRows,
  type RepMaxRow,
} from "@/lib/rep-maxes";

const REP_COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const REP_MAX_TABLE_COL_SPAN = 1 + REP_COLUMNS.length + 1;

function RepMaxesTableHead() {
  return (
    <thead className="bg-card text-xs font-normal uppercase tracking-wide text-foreground">
      <tr className="h-[45px]">
        <th
          scope="col"
          className="sticky left-0 z-20 h-[45px] min-h-[45px] min-w-36 bg-card pl-4 pr-2 align-middle text-left after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border"
        >
          Exercise
        </th>
        {REP_COLUMNS.map((reps) => (
          <th
            key={reps}
            scope="col"
            className="h-[45px] min-h-[45px] min-w-13 bg-card px-2 text-center align-middle"
          >
            {reps}
          </th>
        ))}
        <th
          scope="col"
          className="sticky right-0 z-20 h-[45px] min-h-[45px] bg-card px-2 text-center align-middle before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-border"
        >
          Est&nbsp;1RM
        </th>
      </tr>
    </thead>
  );
}

function RepMaxOtherExercisesDividerRow() {
  return (
    <tr className="border-0">
      <td
        colSpan={REP_MAX_TABLE_COL_SPAN}
        className="border-t border-border bg-muted/15 px-4 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        role="separator"
        aria-label="Other exercises"
      >
        Other exercises
      </td>
    </tr>
  );
}

function RepMaxExerciseRow({ row }: { row: RepMaxRow }) {
  const record = !row.slug.startsWith("custom:")
    ? getExerciseBySlug(row.slug)
    : null;
  const iconPath = row.iconPath ?? record?.iconPath ?? null;

  return (
    <tr className="border-t transition-colors hover:bg-muted/30">
      <th
        scope="row"
        className="sticky left-0 z-10 min-w-36 bg-card py-2 pl-4 pr-2 text-left font-medium after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/50">
            {iconPath ? (
              <ExerciseIconImage
                src={iconPath}
                width={24}
                height={24}
                className="h-6 w-6"
                unoptimized
              />
            ) : (
              <Dumbbell className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
          <span className="truncate">{row.exerciseName}</span>
        </div>
      </th>
      {REP_COLUMNS.map((reps) => {
        const weight = row.maxes[reps];
        const hasWeight = weight !== undefined && weight > 0;
        const cellOneRm = hasWeight ? estimateOneRm(weight, reps) : null;
        let tintStyle: { backgroundColor: string } | undefined;
        if (
          cellOneRm !== null &&
          row.estimatedOneRm !== null &&
          row.estimatedOneRm > 0
        ) {
          const rawRatio = cellOneRm / row.estimatedOneRm;
          const ratio = Math.max(0, Math.min(1, rawRatio));
          const normalized = Math.max(0, (ratio - 0.75) / 0.25);
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
          row.estimatedOneRm !== null && row.estimatedOneRm > 0
            ? row.estimatedOneRm * percentageOfOneRm(reps)
            : null;
        return (
          <td
            key={reps}
            className="min-w-13 whitespace-nowrap px-2 py-2 text-center tabular-nums"
            style={tintStyle}
          >
            {weight === undefined &&
            counterfactualKg !== null &&
            counterfactualKg > 0 ? (
              <span className="text-[10px] font-medium text-muted-foreground">
                {Math.round(counterfactualKg)}
              </span>
            ) : weight === undefined ? (
              <span className="text-muted-foreground/40">—</span>
            ) : cellOneRm !== null ? (
              <div className="flex flex-col items-center leading-tight">
                {tiesRowBest ? (
                  <span className="font-medium">{Math.round(weight)}</span>
                ) : counterfactualKg !== null ? (
                  <>
                    <span className="font-medium">{Math.round(weight)}</span>
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {Math.round(counterfactualKg)}
                    </span>
                  </>
                ) : (
                  <span className="font-medium">{Math.round(weight)}</span>
                )}
              </div>
            ) : (
              <span className="text-[11px] font-medium">BW</span>
            )}
          </td>
        );
      })}
      <td
        className="sticky right-0 z-10 whitespace-nowrap bg-card px-2 py-2 text-center tabular-nums before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-border"
        title={
          row.estimatedOneRm !== null && row.estimateKind === "catalog"
            ? "Catalog intermediate 1RM (StrengthLevel): neutral average of male and female intermediate tiers when both exist; converted to kg."
            : undefined
        }
      >
        {row.estimatedOneRm !== null && row.estimateKind === "logged" && row.estimateSource ? (
          <div className="flex flex-col items-center leading-tight">
            <span className="font-semibold">
              {Math.round(row.estimatedOneRm)}
            </span>
            <span className="text-[10px] font-normal text-muted-foreground">
              {Math.round(row.estimateSource.weightKg)} × {row.estimateSource.reps}
            </span>
          </div>
        ) : row.estimatedOneRm !== null && row.estimateKind === "catalog" ? (
          <span className="font-semibold">{Math.round(row.estimatedOneRm)}</span>
        ) : row.bestBodyweightReps !== null ? (
          <div className="flex flex-col items-center leading-tight">
            <span className="font-semibold">{row.bestBodyweightReps}</span>
            <span className="text-[10px] font-normal text-muted-foreground">
              reps · bodyweight
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </td>
    </tr>
  );
}

export default function RepMaxesPage() {
  const historyQuery = useHistoryGroups();

  const tableItems = useMemo(() => {
    const sessions = (historyQuery.data?.groups ?? []).flatMap(
      (group) => group.sessions,
    );
    return buildRepMaxRows(sessions);
  }, [historyQuery.data]);

  const isLoading = historyQuery.isLoading;

  return (
    <div className="flex flex-col bg-background">
      <main className="flex-1 pb-10 pt-5">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          {isLoading ? (
            <div className="h-64 animate-pulse rounded-2xl border bg-card" />
          ) : (
            <section
              className="overflow-hidden rounded-2xl border bg-card shadow-sm"
              aria-labelledby="rep-maxes-heading"
            >
              <div
                id="rep-maxes-heading"
                className="border-b bg-muted/30 px-4 py-3"
              >
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  Rep maxes
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Logged exercises first (strongest estimated 1RM in kg), then
                  other catalog exercises (estimated 1RM high to low; missing
                  estimates last). Estimates from your log show weight × reps;
                  catalog-only rows use StrengthLevel intermediate (neutral M/F
                  average).
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full w-max border-collapse text-sm">
                  <RepMaxesTableHead />
                  <tbody>
                    {tableItems.map((item) =>
                      item.kind === "separator" ? (
                        <RepMaxOtherExercisesDividerRow key={item.id} />
                      ) : (
                        <RepMaxExerciseRow key={item.row.slug} row={item.row} />
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="text-[11px] text-muted-foreground">
            For logged rows, <span className="font-medium">Est&nbsp;1RM</span>{" "}
            is your strongest projection across sets (subtitle: weight × reps).
            Catalog-only rows mark{" "}
            <span className="font-medium">StrengthLevel · intermediate</span>{" "}
            (not from your log). In each rep column, the{" "}
            <span className="font-medium">main number</span> is what you lifted;
            otherwise muted targets come from the row&apos;s Est&nbsp;1RM
            (rep-% table). <span className="font-medium"> BW</span> is
            bodyweight-only. Display units match your log (stored as kg).
          </p>
        </div>
      </main>
    </div>
  );
}
