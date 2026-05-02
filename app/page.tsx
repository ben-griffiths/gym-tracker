"use client";

import { ExerciseIconImage } from "@/components/workout/exercise-icon-image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useHistoryGroups } from "@/lib/sync/workouts-live";
import { toast } from "sonner";
import { ChevronRight, Dumbbell, Pencil, Trash2, X } from "lucide-react";
import { StartWorkoutFab } from "@/components/home/start-workout-fab";
import { ExerciseListRowIcon } from "@/components/workout/exercise-list-row-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getExerciseBySlug } from "@/lib/exercises";
import { deleteWorkoutSession } from "@/lib/api";
import {
  computeVolume,
  flattenSets,
  formatWorkoutTitle,
  groupByExercise,
} from "@/lib/workout-history";
import { AverageLiftLevelCard } from "@/components/strength/average-lift-level-card";
import {
  computeAverageStrength,
  computeLiftProfiles,
  type LiftProfile,
} from "@/lib/lift-profiles";

export default function HomePage() {
  /** Session-only: hidden after dismiss until the next full page load. */
  const [maxesHintVisible, setMaxesHintVisible] = useState(true);

  function dismissMaxesHint() {
    setMaxesHintVisible(false);
  }

  const historyQuery = useHistoryGroups();

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteWorkoutSession(sessionId),
    onError: () => toast.error("Could not delete workout"),
  });

  function handleDelete(sessionId: string, sessionName: string) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${sessionName}? This cannot be undone.`)
    ) {
      return;
    }
    deleteMutation.mutate(sessionId);
  }

  const sessions = (historyQuery.data?.groups ?? []).flatMap((group) =>
    group.sessions.map((session) => ({ ...session, groupName: group.name })),
  );

  const liftProfiles = useMemo(
    () => computeLiftProfiles(sessions),
    [sessions],
  );

  const averageStrength = useMemo(
    () => computeAverageStrength(liftProfiles),
    [liftProfiles],
  );

  const spotlightLifts = useMemo(() => {
    const targets = [
      { label: "Squat", slug: "squat" },
      { label: "Bench", slug: "bench-press" },
      { label: "Deadlift", slug: "deadlift" },
    ];
    const directBySlug = new Map<string, LiftProfile>();
    for (const target of targets) {
      const found = liftProfiles.find((lift) => lift.slug === target.slug);
      if (found) directBySlug.set(target.slug, found);
    }
    // Reserve direct S/B/D hits first so fallbacks cannot consume them.
    const used = new Set<string>(
      Array.from(directBySlug.values()).map((lift) => lift.slug),
    );
    const chosen = targets.map((target) => {
      const direct = directBySlug.get(target.slug) ?? null;
      if (direct) {
        return {
          label: target.label,
          catalogSlug: target.slug,
          lift: direct,
          fallback: false,
        };
      }
      const fallback = liftProfiles.find((lift) => !used.has(lift.slug)) ?? null;
      if (fallback) used.add(fallback.slug);
      return {
        label: target.label,
        catalogSlug: target.slug,
        lift: fallback,
        fallback: Boolean(fallback),
      };
    });
    return chosen;
  }, [liftProfiles]);

  // Classic powerlifting total — only shown when the user actually has all
  // three of squat, bench, and deadlift logged (no fallback substitutions).
  const sbdTotalKg = useMemo(() => {
    const allDirect = spotlightLifts.every(
      (entry) => entry.lift && !entry.fallback,
    );
    if (!allDirect) return null;
    return spotlightLifts.reduce(
      (sum, entry) => sum + (entry.lift?.oneRmKg ?? 0),
      0,
    );
  }, [spotlightLifts]);

  const isLoading = historyQuery.isLoading;
  const isEmpty = !isLoading && sessions.length === 0;

  return (
    <div className="relative flex flex-col bg-background">
      <main className="flex-1 pb-36 pt-5">
        <div className="flex w-full flex-col gap-4">
          <AverageLiftLevelCard
            averageStrength={averageStrength}
            footer={
              <div className="w-full border-t border-border/50">
                <Link
                  href="/strength"
                  className="group flex h-[45px] min-h-[45px] w-full min-w-0 items-center justify-between gap-2 px-4 text-xs font-medium text-primary transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span>View full exercise overview</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-45" />
                </Link>
              </div>
            }
          />

          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex h-[45px] min-h-[45px] items-center border-b border-border/50 px-4">
              <div className="flex w-full min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold tracking-tight">
                    Key lift maxes
                  </h2>
                </div>
                {sbdTotalKg !== null ? (
                  <Badge
                    variant="outline"
                    className="h-fit max-w-full shrink-0 border-emerald-200/80 bg-emerald-50 font-normal tabular-nums text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
                  >
                    Total {Math.round(sbdTotalKg)} kg
                  </Badge>
                ) : null}
              </div>
            </div>

            <ul className="flex flex-col px-4 pb-0 pt-0">
              {spotlightLifts.map((entry, index) => {
                const name = entry.lift
                  ? entry.lift.exerciseName
                  : entry.label;
                const iconSlug = entry.lift?.slug ?? entry.catalogSlug;
                const record = getExerciseBySlug(iconSlug);
                const iconPath = record?.iconPath ?? null;
                return (
                  <li key={entry.label} className="relative">
                    {index > 0 ? (
                      <div
                        className="pointer-events-none absolute top-0 right-0 left-0 h-px bg-border/70 dark:bg-border/50"
                        aria-hidden
                      />
                    ) : null}
                    <div className="flex items-center justify-between gap-3 py-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
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
                        <p className="min-w-0 text-sm font-medium text-foreground capitalize">
                          {name.toLowerCase()}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {entry.lift ? (
                          <>
                            <p className="text-sm font-semibold tabular-nums text-foreground">
                              {Math.round(entry.lift.oneRmKg)} kg
                            </p>
                            {entry.lift.tier ? (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {entry.lift.tier}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No data yet
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="w-full border-t border-border/50">
              <Link
                href="/rep-maxes"
                className="group flex h-[45px] min-h-[45px] w-full min-w-0 items-center justify-between gap-2 px-4 text-xs font-medium text-primary transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>View rep max table</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-45" />
              </Link>
            </div>
          </section>

          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              Previous workouts
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isLoading
                ? "Loading your history…"
                : `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} logged`}
            </p>
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="h-28 animate-pulse rounded-2xl border bg-card"
                />
              ))}
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col gap-4">
              {maxesHintVisible ? (
                <section
                  className={cn(
                    "relative rounded-2xl border p-3 shadow-sm sm:p-4",
                    "border-amber-200/90 bg-amber-50/95",
                    "dark:border-amber-800/50 dark:bg-amber-950/40",
                  )}
                >
                  <p className="min-w-0 pr-8 text-sm leading-tight text-amber-950/90 sm:pr-9 sm:text-base dark:text-amber-50/95">
                    Start a workout and log past sets — weight and rep ideas
                    match your strength better.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={dismissMaxesHint}
                    className="absolute top-1.5 right-1.5 z-10 text-amber-800/70 hover:bg-amber-900/10 hover:text-amber-950 sm:top-2 sm:right-2 dark:text-amber-200/80 dark:hover:bg-amber-100/10 dark:hover:text-amber-50"
                    aria-label="Dismiss hint"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </section>
              ) : null}

              <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-sky-200/60 bg-card/40 px-5 py-9 text-center dark:border-sky-500/20">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-violet-100 text-sky-700 dark:from-sky-950/50 dark:to-violet-950/50 dark:text-sky-300">
                  <Dumbbell className="h-4 w-4" />
                </div>
                <div className="max-w-sm">
                  <p className="text-sm font-medium">No workouts yet</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    Sessions you log will list here. Tap + below to start.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {sessions.map((session) => {
                const sets = flattenSets(session);
                const exerciseGroups = groupByExercise(sets);
                const { volume, unit: volumeUnit } = computeVolume(sets);
                return (
                  <li key={session.id}>
                    <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-card shadow-sm ring-1 ring-sky-500/[0.08] dark:border-border dark:ring-sky-400/10">
                      <header className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold">
                            {formatWorkoutTitle(session.startedAt, session.name)}
                          </h3>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          <Badge
                            variant="outline"
                            className="border-sky-200/80 bg-sky-50/90 font-normal text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100"
                          >
                            {sets.length} sets
                          </Badge>
                          {volume > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-200/80 bg-emerald-50/90 font-normal text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
                            >
                              {volume.toLocaleString()} {volumeUnit}
                            </Badge>
                          ) : null}
                          <Link
                            href={`/workout?edit=${encodeURIComponent(session.id)}`}
                            aria-label={`Edit ${session.name}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                          <button
                            type="button"
                            onClick={() =>
                              handleDelete(session.id, session.name)
                            }
                            disabled={deleteMutation.isPending}
                            aria-label={`Delete ${session.name}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </header>
                      <ul className="flex flex-col px-4 pt-0">
                        {exerciseGroups.length === 0 ? (
                          <li className="py-2.5 text-xs text-muted-foreground">
                            No sets logged.
                          </li>
                        ) : (
                          exerciseGroups.map((group, index) => (
                            <li
                              key={group.exerciseName}
                              className="relative"
                            >
                              {index > 0 ? (
                                <div
                                  className="pointer-events-none absolute left-0 right-0 top-0 h-px bg-border/80 dark:bg-border/50"
                                  aria-hidden
                                />
                              ) : null}
                              <div className="flex items-center justify-between gap-3 py-2.5 pr-0 text-sm">
                                <div className="flex min-w-0 flex-1 items-center gap-2.5 pr-1">
                                  <ExerciseListRowIcon
                                    exerciseName={group.exerciseName}
                                  />
                                  <span className="truncate font-medium">
                                    {group.exerciseName}
                                  </span>
                                </div>
                                <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:text-sm">
                                  {group.summary}
                                </span>
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    </section>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>

      <StartWorkoutFab />
    </div>
  );
}
