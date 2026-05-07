"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Dumbbell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { getExerciseByName, searchExercises } from "@/lib/exercises";
import { computeLiftProfiles } from "@/lib/lift-profiles";
import { estimateOneRm, percentageOfOneRm } from "@/lib/rep-percentages";
import { useHistoryGroups } from "@/lib/sync/workouts-live";
import { flattenSets } from "@/lib/workout-history";
import {
  formatWeightKgForDisplay,
  suffixForUnit,
  toKg,
  type WeightUnitPreference,
} from "@/lib/weight-units";
import { useUserStrengthSex } from "@/components/profile/user-strength-sex-provider";
import { useUserWeightUnit } from "@/components/profile/user-weight-unit-provider";

type ExercisePersonalStatsProps = {
  catalogSlug: string;
};

function matchCatalogSlug(exerciseName: string): string | null {
  const matched =
    getExerciseByName(exerciseName) ?? searchExercises(exerciseName, 1)[0];
  return matched?.slug ?? null;
}

export function ExercisePersonalStats({ catalogSlug }: ExercisePersonalStatsProps) {
  const [authUserId, setAuthUserId] = useState<string | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    const client = createClient();
    client.auth.getSession().then(({ data }) => {
      if (!cancelled) setAuthUserId(data.session?.user?.id ?? null);
    });
    const sub = client.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setAuthUserId(session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      sub.data.subscription.unsubscribe();
    };
  }, []);

  const historyQuery = useHistoryGroups();
  const sessions = (historyQuery.data?.groups ?? []).flatMap((g) => g.sessions);
  const { strengthSex } = useUserStrengthSex();
  const { weightUnit } = useUserWeightUnit();

  const aggregated = useMemo(() => {
    let bestOneRmKg = 0;
    let bestDisplay: {
      reps: number;
      weight: number;
      weightUnit: WeightUnitPreference;
    } | null = null;

    const sessionIds = new Set<string>();

    for (const session of sessions) {
      let touched = false;
      for (const set of flattenSets(session)) {
        const slug = matchCatalogSlug(set.exerciseName);
        if (slug !== catalogSlug) continue;
        touched = true;
        const numericWeight = Number(set.weight);
        const reps = typeof set.reps === "number" ? set.reps : null;
        if (
          !Number.isFinite(numericWeight) ||
          numericWeight <= 0 ||
          reps === null ||
          reps < 1
        ) {
          continue;
        }
        const wKg = toKg(numericWeight, set.weightUnit);
        const est = estimateOneRm(wKg, reps);
        if (est > bestOneRmKg) {
          bestOneRmKg = est;
          bestDisplay = {
            reps,
            weight: numericWeight,
            weightUnit: (set.weightUnit === "lb"
              ? "lb"
              : "kg") as WeightUnitPreference,
          };
        }
      }
      if (touched) sessionIds.add(session.id);
    }

    const profiles = computeLiftProfiles(sessions, strengthSex);
    const profile = profiles.find((p) => p.slug === catalogSlug) ?? null;

    return {
      sessionCount: sessionIds.size,
      bestOneRmKg: bestOneRmKg > 0 ? bestOneRmKg : null,
      bestSet: bestDisplay,
      profile,
    };
  }, [sessions, catalogSlug, strengthSex]);

  if (authUserId === undefined) {
    return (
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="h-24 animate-pulse rounded-xl bg-muted/50" />
      </section>
    );
  }

  if (authUserId === null) {
    return (
      <section className="rounded-2xl border border-dashed border-border/80 bg-card/50 p-5 shadow-sm">
        <h2 className="text-sm font-semibold tracking-tight">Your training</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          Sign in to see personal bests and strength tier for this lift using
          workouts synced on this device.
        </p>
        <Link
          href="/auth"
          className="mt-3 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </section>
    );
  }

  if (historyQuery.isLoading) {
    return (
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="h-28 animate-pulse rounded-xl bg-muted/50" />
      </section>
    );
  }

  const hasStats =
    aggregated.sessionCount > 0 ||
    aggregated.bestOneRmKg !== null ||
    aggregated.profile !== null;

  if (!hasStats) {
    return (
      <section className="rounded-2xl border border-dashed border-border/80 bg-card/50 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
            <Dumbbell className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              Your training
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              No logged sets for this exercise in your recent workout history
              (local journal). Start a session on the workout page and log
              working sets to see estimated 1RM and strength level here.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const pct8 = percentageOfOneRm(8);
  const suggestKg =
    aggregated.bestOneRmKg !== null
      ? aggregated.bestOneRmKg * pct8
      : null;
  const u = suffixForUnit(weightUnit);

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold tracking-tight">Your training</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {aggregated.profile?.tier ? (
          <Badge variant="secondary" className="text-xs">
            Strength: {aggregated.profile.tier}
          </Badge>
        ) : null}
        {aggregated.sessionCount > 0 ? (
          <Badge variant="outline" className="text-xs">
            {aggregated.sessionCount}{" "}
            {aggregated.sessionCount === 1 ? "session" : "sessions"}
          </Badge>
        ) : null}
      </div>

      <dl className="mt-4 grid gap-3 text-sm">
        {aggregated.bestOneRmKg !== null ? (
          <div className="flex flex-col gap-0.5 rounded-xl bg-muted/40 px-3 py-2.5">
            <dt className="text-xs font-medium text-muted-foreground">
              Estimated 1RM
            </dt>
            <dd className="font-semibold tabular-nums">
              {formatWeightKgForDisplay(aggregated.bestOneRmKg, weightUnit)} {u}
            </dd>
          </div>
        ) : null}

        {aggregated.bestSet ? (
          <div className="flex flex-col gap-0.5 rounded-xl bg-muted/40 px-3 py-2.5">
            <dt className="text-xs font-medium text-muted-foreground">
              Best logged set
            </dt>
            <dd className="font-semibold tabular-nums">
              {formatWeightKgForDisplay(
                toKg(
                  aggregated.bestSet.weight,
                  aggregated.bestSet.weightUnit,
                ),
                weightUnit,
              )}{" "}
              {u} × {aggregated.bestSet.reps}
            </dd>
          </div>
        ) : null}

        {suggestKg !== null ? (
          <div className="flex flex-col gap-0.5 rounded-xl bg-muted/40 px-3 py-2.5">
            <dt className="text-xs font-medium text-muted-foreground">
              Suggested ~8 @ RPE ~8
            </dt>
            <dd className="text-xs tabular-nums text-foreground">
              ≈ {formatWeightKgForDisplay(suggestKg, weightUnit)} {u}{" "}
              <span className="text-muted-foreground">
                ({Math.round(pct8 * 100)}% est. 1RM)
              </span>
            </dd>
          </div>
        ) : null}
      </dl>

      {aggregated.profile?.score !== null && aggregated.profile?.score !== undefined ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Strength score vs catalog:{" "}
          <span className="font-medium text-foreground">
            {Math.round(aggregated.profile.score * 100)} / 100
          </span>
        </p>
      ) : null}
    </section>
  );
}
