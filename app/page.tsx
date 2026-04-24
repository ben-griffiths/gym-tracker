"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Dumbbell, Pencil, Trash2 } from "lucide-react";
import { StartWorkoutFab } from "@/components/home/start-workout-fab";
import { Badge } from "@/components/ui/badge";
import { deleteWorkoutSession } from "@/lib/api";
import { getExerciseBySlug } from "@/lib/exercises";
import {
  computeVolume,
  flattenSets,
  formatWorkoutTitle,
  groupByExercise,
  type HistoryResponse,
} from "@/lib/workout-history";
import {
  TIERS,
  computeAverageStrength,
  computeLiftProfiles,
  type LiftProfile,
} from "@/lib/lift-profiles";

export default function HomePage() {
  const queryClient = useQueryClient();

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

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteWorkoutSession(sessionId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["workouts"] }),
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
      { label: "Squat max", slug: "squat" },
      { label: "Bench max", slug: "bench-press" },
      { label: "Deadlift max", slug: "deadlift" },
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
        return { label: target.label, lift: direct, fallback: false };
      }
      const fallback = liftProfiles.find((lift) => !used.has(lift.slug)) ?? null;
      if (fallback) used.add(fallback.slug);
      return { label: target.label, lift: fallback, fallback: Boolean(fallback) };
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
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">
                  Average lift level
                </h2>
                <p className="text-xs text-muted-foreground">
                  Compared against StrengthLevel standards (kg)
                </p>
              </div>
              <Badge variant="outline">
                {averageStrength
                  ? `${Math.round(averageStrength.score * 100)}/100 · ${averageStrength.tier} · ${averageStrength.liftsCount} lifts`
                  : "Not enough weighted data"}
              </Badge>
            </div>
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${(averageStrength?.score ?? 0) * 100}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                {TIERS.map((tier) => (
                  <span key={tier}>{tier}</span>
                ))}
              </div>
            </div>
            <div className="mt-3 flex">
              <Link
                href="/strength"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 transition-colors hover:underline focus-visible:underline focus-visible:outline-none"
              >
                View full exercise overview
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">
                  Key lift maxes
                </h2>
                <p className="text-xs text-muted-foreground">
                  Top maxes from your strongest lifts
                </p>
              </div>
              {sbdTotalKg !== null ? (
                <Badge variant="outline" className="shrink-0">
                  Total {Math.round(sbdTotalKg)} kg
                </Badge>
              ) : null}
            </div>
            <ul className="grid gap-2 sm:grid-cols-3">
              {spotlightLifts.map((entry) => {
                const record = entry.lift
                  ? getExerciseBySlug(entry.lift.slug)
                  : null;
                return (
                  <li key={entry.label} className="rounded-xl bg-muted/40 p-3">
                    <div className="flex items-center gap-2.5">
                      {record?.iconPath ? (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background">
                          <Image
                            src={record.iconPath}
                            alt=""
                            width={32}
                            height={32}
                            className="h-8 w-8 object-contain"
                            unoptimized
                          />
                        </span>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {entry.lift
                            ? `${entry.lift.exerciseName} max`
                            : entry.label}
                        </p>
                        {entry.lift ? (
                          <>
                            <p className="mt-1 text-sm font-semibold">
                              {Math.round(entry.lift.oneRmKg)} kg 1RM
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {entry.lift.tier ?? " "}
                            </p>
                          </>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">
                            No weighted sets yet
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex">
              <Link
                href="/rep-maxes"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 transition-colors hover:underline focus-visible:underline focus-visible:outline-none"
              >
                View rep max table
                <ArrowRight className="h-3 w-3" />
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
            <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed bg-card/40 px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Dumbbell className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">No workouts yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tap the button below to start logging your first session.
                </p>
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
                    <section className="rounded-2xl border bg-card p-4 shadow-sm">
                      <header className="mb-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold">
                            {formatWorkoutTitle(session.startedAt, session.name)}
                          </h3>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          <Badge variant="outline">{sets.length} sets</Badge>
                          {volume > 0 ? (
                            <Badge variant="outline">
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
                      <ul className="flex flex-col gap-1.5">
                        {exerciseGroups.length === 0 ? (
                          <li className="text-xs text-muted-foreground">
                            No sets logged.
                          </li>
                        ) : (
                          exerciseGroups.map((group) => (
                            <li
                              key={group.exerciseName}
                              className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-2.5 py-1.5 text-sm"
                            >
                              <span className="truncate pr-2 font-medium">
                                {group.exerciseName}
                              </span>
                              <span className="shrink-0 text-muted-foreground">
                                {group.summary}
                              </span>
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
