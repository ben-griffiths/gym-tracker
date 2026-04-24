"use client";

import Image from "next/image";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dumbbell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getExerciseBySlug } from "@/lib/exercises";
import { type HistoryResponse } from "@/lib/workout-history";
import { AverageLiftLevelCard } from "@/components/strength/average-lift-level-card";
import {
  TIERS,
  computeAverageStrength,
  computeLiftProfiles,
  type LiftProfile,
  type StrengthTier,
} from "@/lib/lift-profiles";
import { StrengthLevelBar } from "@/components/strength/strength-level-bar";

function tierIndex(tier: StrengthTier): number {
  return TIERS.indexOf(tier);
}

export default function StrengthOverviewPage() {
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

  const sessions = (historyQuery.data?.groups ?? []).flatMap((group) =>
    group.sessions,
  );

  const liftProfiles = useMemo(
    () => computeLiftProfiles(sessions),
    [sessions],
  );

  const averageStrength = useMemo(
    () => computeAverageStrength(liftProfiles),
    [liftProfiles],
  );

  const scored = liftProfiles.filter(
    (lift): lift is LiftProfile & { score: number; tier: StrengthTier } =>
      lift.score !== null && lift.tier !== null,
  );
  const unscored = liftProfiles.filter(
    (lift) => lift.score === null || lift.tier === null,
  );

  const isLoading = historyQuery.isLoading;
  const isEmpty = !isLoading && liftProfiles.length === 0;

  return (
    <div className="flex flex-col bg-background">
      <main className="flex-1 pb-10 pt-5">
        <div className="flex w-full flex-col gap-4">
          <AverageLiftLevelCard averageStrength={averageStrength} />

          {isLoading ? (
            <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="flex flex-col px-4">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="relative py-3">
                    {index > 0 ? (
                      <div
                        className="pointer-events-none absolute top-0 right-0 left-0 h-px bg-border/80 dark:bg-border/50"
                        aria-hidden
                      />
                    ) : null}
                    <div className="h-20 animate-pulse rounded-md bg-muted/50" />
                  </div>
                ))}
              </div>
            </section>
          ) : isEmpty ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/80 bg-card/40 px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Dumbbell className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">No weighted lifts yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Log some working sets and come back to see your strength
                  levels.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {scored.length > 0 ? (
                <h2 className="text-sm font-semibold tracking-tight">
                  Tracked lifts
                </h2>
              ) : null}
              <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                <div>
                {scored.length > 0 ? (
                    <ul className="flex flex-col px-4">
                      {scored.map((lift, index) => {
                        const record = getExerciseBySlug(lift.slug);
                        const percent = Math.round(lift.score * 100);
                        return (
                          <li key={lift.slug} className="relative py-3.5">
                            {index > 0 ? (
                              <div
                                className="pointer-events-none absolute top-0 right-0 left-0 h-px bg-border/80 dark:bg-border/50"
                                aria-hidden
                              />
                            ) : null}
                            <div className="flex items-center gap-3">
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/50">
                                {record?.iconPath ? (
                                  <Image
                                    src={record.iconPath}
                                    alt=""
                                    width={36}
                                    height={36}
                                    className="h-9 w-9 object-contain"
                                    unoptimized
                                  />
                                ) : (
                                  <Dumbbell className="h-4 w-4 text-muted-foreground" />
                                )}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="truncate text-sm font-semibold">
                                    {lift.exerciseName}
                                  </p>
                                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                    <Badge
                                      variant="outline"
                                      className="shrink-0 border-emerald-200/80 bg-emerald-50 font-medium text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
                                    >
                                      {lift.tier}
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className="shrink-0 border-sky-200/80 bg-sky-50 font-medium tabular-nums text-sky-900 dark:border-sky-500/35 dark:bg-sky-950/50 dark:text-sky-100"
                                    >
                                      {percent}/100
                                    </Badge>
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {Math.round(lift.oneRmKg)} kg estimated 1RM
                                </p>
                              </div>
                            </div>
                            <div className="mt-2.5 space-y-1">
                              <StrengthLevelBar
                                widthPercent={lift.score * 100}
                                trackClassName="h-1.5"
                              />
                              <div className="grid grid-cols-5 text-center text-[10px] text-muted-foreground">
                                {TIERS.map((tier) => {
                                  const threshold = lift.thresholdsKg?.[tier];
                                  const isHighlighted =
                                    tierIndex(tier) === tierIndex(lift.tier);
                                  return (
                                    <div
                                      key={tier}
                                      className="min-w-0 leading-tight"
                                    >
                                      <div
                                        className={
                                          isHighlighted
                                            ? "font-medium text-foreground"
                                            : undefined
                                        }
                                      >
                                        {tier}
                                      </div>
                                      <div className="tabular-nums text-muted-foreground/80">
                                        {threshold !== undefined
                                          ? `${Math.round(threshold)} kg`
                                          : "—"}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                ) : null}

                {unscored.length > 0 ? (
                  <div>
                    {scored.length > 0 ? (
                      <div
                        className="mx-4 h-px bg-border/80 dark:bg-border/50"
                        aria-hidden
                      />
                    ) : null}
                    <h2 className="px-4 pt-3 text-sm font-semibold tracking-tight">
                      Other lifts
                    </h2>
                    <p className="px-4 pb-1 text-xs text-muted-foreground">
                      These exercises don&apos;t have published StrengthLevel
                      standards, so they aren&apos;t scored.
                    </p>
                    <ul className="flex flex-col px-4">
                      {unscored.map((lift, index) => {
                        const record = getExerciseBySlug(lift.slug);
                        return (
                          <li
                            key={lift.slug}
                            className="relative flex items-center gap-3 py-3.5"
                          >
                            {index > 0 ? (
                              <div
                                className="pointer-events-none absolute top-0 right-0 left-0 h-px bg-border/80 dark:bg-border/50"
                                aria-hidden
                              />
                            ) : null}
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/50">
                              {record?.iconPath ? (
                                <Image
                                  src={record.iconPath}
                                  alt=""
                                  width={32}
                                  height={32}
                                  className="h-8 w-8 object-contain"
                                  unoptimized
                                />
                              ) : (
                                <Dumbbell className="h-4 w-4 text-muted-foreground" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {lift.exerciseName}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {Math.round(lift.oneRmKg)} kg estimated 1RM
                              </p>
                            </div>
                            <Badge variant="outline">No standard</Badge>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
