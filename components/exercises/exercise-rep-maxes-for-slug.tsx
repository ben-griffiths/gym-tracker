"use client";

import { useMemo } from "react";
import { RepMaxExerciseRowView } from "@/components/rep-maxes/rep-max-exercise-row-view";
import { useUserStrengthSex } from "@/components/profile/user-strength-sex-provider";
import { useUserWeightUnit } from "@/components/profile/user-weight-unit-provider";
import { buildRepMaxRows } from "@/lib/rep-maxes";
import { useHistoryGroups } from "@/lib/sync/workouts-live";

type ExerciseRepMaxesForSlugProps = {
  slug: string;
};

export function ExerciseRepMaxesForSlug({ slug }: ExerciseRepMaxesForSlugProps) {
  const historyQuery = useHistoryGroups();
  const { strengthSex } = useUserStrengthSex();
  const { weightUnit: weightDisplayUnit } = useUserWeightUnit();

  const row = useMemo(() => {
    const sessions = (historyQuery.data?.groups ?? []).flatMap(
      (group) => group.sessions,
    );
    const items = buildRepMaxRows(sessions, strengthSex);
    for (const item of items) {
      if (item.kind !== "row") continue;
      if (item.row.slug === slug) return item.row;
    }
    return null;
  }, [historyQuery.data, slug, strengthSex]);

  if (historyQuery.isLoading) {
    return (
      <p className="text-[11px] text-muted-foreground">Loading maxes…</p>
    );
  }

  if (!row) return null;

  return (
    <RepMaxExerciseRowView
      row={row}
      strengthSex={strengthSex}
      weightDisplayUnit={weightDisplayUnit}
      variant="compact"
    />
  );
}
