"use client";

import { type ReactNode } from "react";
import { Dumbbell } from "lucide-react";
import { ExerciseIconImage } from "@/components/workout/exercise-icon-image";
import { getExerciseBySlug } from "@/lib/exercises";
import type { UserStrengthSex } from "@/lib/user-strength-sex";
import { estimateOneRm, percentageOfOneRm } from "@/lib/rep-percentages";
import type { RepMaxRow } from "@/lib/rep-maxes";
import { cn } from "@/lib/utils";
import {
  formatWeightKgForDisplay,
  suffixForUnit,
  type WeightUnitPreference,
} from "@/lib/weight-units";

const REP_MAX_COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function estimatedOneRmSubtitle(
  row: RepMaxRow,
  strengthSex: UserStrengthSex,
  weightDisplayUnit: WeightUnitPreference,
): ReactNode | null {
  const u = suffixForUnit(weightDisplayUnit);
  if (
    row.estimatedOneRm !== null &&
    row.estimateKind === "logged" &&
    row.estimateSource
  ) {
    return (
      <>
        Estimated from{" "}
        <span className="tabular-nums font-medium">
          {formatWeightKgForDisplay(row.estimateSource.weightKg, weightDisplayUnit)}{" "}
          {u} × {row.estimateSource.reps}
        </span>
      </>
    );
  }
  if (row.estimatedOneRm !== null && row.estimateKind === "catalog") {
    return `intermediate (${strengthSex})`;
  }
  if (row.bestBodyweightReps !== null) {
    return (
      <>
        Best logged effort ·{" "}
        <span className="tabular-nums">{row.bestBodyweightReps}</span> reps
        bodyweight
      </>
    );
  }
  return null;
}

function EstimatedOneRmPrimary({
  row,
  weightDisplayUnit,
}: {
  row: RepMaxRow;
  weightDisplayUnit: WeightUnitPreference;
}) {
  const u = suffixForUnit(weightDisplayUnit);
  if (row.estimatedOneRm !== null) {
    return (
      <p className="m-0 shrink-0 text-right text-[13px] font-semibold tabular-nums leading-tight text-foreground sm:text-sm">
        {formatWeightKgForDisplay(row.estimatedOneRm, weightDisplayUnit)} {u}
      </p>
    );
  }
  if (row.bestBodyweightReps !== null) {
    return (
      <p className="m-0 shrink-0 text-right text-[13px] font-semibold tabular-nums leading-tight text-foreground sm:text-sm">
        BW
      </p>
    );
  }
  return (
    <p className="m-0 shrink-0 text-[13px] tabular-nums text-muted-foreground/60 sm:text-sm">
      —
    </p>
  );
}

function RepMaxRepWeightCell({
  reps,
  row,
  weightDisplayUnit,
}: {
  reps: number;
  row: RepMaxRow;
  weightDisplayUnit: WeightUnitPreference;
}) {
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

  let body: ReactNode;
  if (
    weight === undefined &&
    counterfactualKg !== null &&
    counterfactualKg > 0
  ) {
    body = (
      <span className="max-w-full truncate text-[10px] font-medium text-muted-foreground">
        {formatWeightKgForDisplay(counterfactualKg, weightDisplayUnit)}
      </span>
    );
  } else if (weight === undefined) {
    body = (
      <span className="max-w-full truncate text-muted-foreground/40">—</span>
    );
  } else if (cellOneRm !== null) {
    body = (
      <div className="flex min-w-0 w-full flex-col items-center leading-tight">
        {tiesRowBest ? (
          <span className="max-w-full truncate text-xs font-medium tabular-nums">
            {formatWeightKgForDisplay(weight, weightDisplayUnit)}
          </span>
        ) : counterfactualKg !== null ? (
          <>
            <span className="max-w-full truncate text-xs font-medium tabular-nums">
              {formatWeightKgForDisplay(weight, weightDisplayUnit)}
            </span>
            <span className="max-w-full truncate text-[9px] font-medium tabular-nums text-muted-foreground">
              {formatWeightKgForDisplay(counterfactualKg, weightDisplayUnit)}
            </span>
          </>
        ) : (
          <span className="max-w-full truncate text-xs font-medium tabular-nums">
            {formatWeightKgForDisplay(weight, weightDisplayUnit)}
          </span>
        )}
      </div>
    );
  } else {
    body = (
      <span className="max-w-full truncate text-[10px] font-medium">BW</span>
    );
  }

  return (
    <div
      className="flex min-h-[38px] w-full min-w-0 flex-col justify-center rounded-md px-0.5 py-1 text-center text-xs tabular-nums sm:px-1"
      style={tintStyle}
    >
      {body}
    </div>
  );
}

export function RepMaxOtherExercisesDivider() {
  return (
    <li role="separator" aria-label="Untracked" className="list-none">
      <div className="h-px bg-border/80 dark:bg-border/50" aria-hidden />
      <div className="flex items-center justify-center py-2.5">
        <span className="text-center text-xs font-semibold tracking-tight text-muted-foreground">
          Untracked
        </span>
      </div>
      <div className="h-px bg-border/80 dark:bg-border/50" aria-hidden />
    </li>
  );
}

type RepMaxExerciseRowViewProps = {
  row: RepMaxRow;
  strengthSex: UserStrengthSex;
  weightDisplayUnit: WeightUnitPreference;
  showTopDivider?: boolean;
  /** Omit icon/name; use inside exercise how-to dialog. */
  variant?: "full" | "compact";
};

export function RepMaxExerciseRowView({
  row,
  strengthSex,
  weightDisplayUnit,
  showTopDivider = false,
  variant = "full",
}: RepMaxExerciseRowViewProps) {
  const compact = variant === "compact";
  const record = !row.slug.startsWith("custom:")
    ? getExerciseBySlug(row.slug)
    : null;
  const iconPath = row.iconPath ?? record?.iconPath ?? null;

  const subtitle = estimatedOneRmSubtitle(row, strengthSex, weightDisplayUnit);

  const grid = (
    <div className={cn("w-full min-w-0", compact ? "mt-1.5" : "mt-2")}>
      <div className="grid w-full min-w-0 grid-cols-10 gap-0.5 sm:gap-1.5">
        {REP_MAX_COLUMNS.map((reps) => (
          <div
            key={reps}
            className="flex min-w-0 flex-col items-stretch gap-0.5"
          >
            <div className="min-w-0 truncate text-center text-[10px] font-medium tabular-nums text-muted-foreground">
              {reps}
            </div>
            <RepMaxRepWeightCell reps={reps} row={row} weightDisplayUnit={weightDisplayUnit} />
          </div>
        ))}
      </div>
    </div>
  );

  if (compact) {
    return (
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Maxes
          </h3>
          <div className="flex min-w-0 shrink-0 flex-col items-end text-right">
            <EstimatedOneRmPrimary row={row} weightDisplayUnit={weightDisplayUnit} />
            {subtitle !== null ? (
              <p
                className="m-0 mt-0.5 max-w-[12rem] text-[10px] leading-snug text-muted-foreground"
                title={
                  row.estimateKind === "catalog"
                    ? `Intermediate 1RM from the StrengthLevel catalog using the ${strengthSex} standard column when available (otherwise the other column). Catalog values are normalized via kg for UI.`
                    : undefined
                }
              >
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {grid}
      </div>
    );
  }

  return (
    <li className="relative py-2.5">
      {showTopDivider ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-border/80 dark:bg-border/50"
          aria-hidden
        />
      ) : null}
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50">
          {iconPath ? (
            <ExerciseIconImage
              src={iconPath}
              width={32}
              height={32}
              className="h-8 w-8"
              unoptimized
            />
          ) : (
            <Dumbbell className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-h-[1.5lh] min-w-0 flex-1 items-center">
              <p className="m-0 w-full text-[15px] font-semibold leading-snug sm:text-[16px] lg:text-[17px] lg:leading-tight [overflow-wrap:anywhere] line-clamp-2">
                {row.exerciseName}
              </p>
            </div>
            <div className="flex min-w-0 shrink-0 flex-col items-end text-right">
              <EstimatedOneRmPrimary row={row} weightDisplayUnit={weightDisplayUnit} />
              {subtitle !== null ? (
                <p
                  className="m-0 mt-0.5 max-w-[13rem] text-[10px] leading-snug text-muted-foreground"
                  title={
                    row.estimateKind === "catalog"
                      ? `Intermediate 1RM from the StrengthLevel catalog using the ${strengthSex} standard column when available (otherwise the other column). Catalog values are normalized via kg for UI.`
                      : undefined
                  }
                >
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {grid}
    </li>
  );
}
