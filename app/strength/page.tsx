"use client";

import Image from "next/image";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dumbbell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getExerciseBySlug } from "@/lib/exercises";
import { type HistoryResponse } from "@/lib/workout-history";
import {
  TIERS,
  computeAverageStrength,
  computeLiftProfiles,
  tierFromScore,
  type LiftProfile,
  type StrengthTier,
} from "@/lib/lift-profiles";

function tierIndex(tier: StrengthTier): number {
  return TIERS.indexOf(tier);
}

function tierBadgeVariant(tier: StrengthTier | null) {
  if (!tier) return "outline" as const;
  // Keep it simple: just use outline everywhere so the card stays calm.
  // The progress bar already conveys where the lift sits.
  return "outline" as const;
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
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">
                  Average lift level
                </h2>
                <p className="text-xs text-muted-foreground">
                  {averageStrength
                    ? `Based on ${averageStrength.liftsCount} ${
                        averageStrength.liftsCount === 1 ? "lift" : "lifts"
                      } with a catalog standard`
                    : "Log a few weighted sets to see your average"}
                </p>
              </div>
              <Badge variant="outline">
                {averageStrength
                  ? `${Math.round(averageStrength.score * 100)}/100 · ${averageStrength.tier}`
                  : "—"}
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
          </section>

          {isLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="h-20 animate-pulse rounded-2xl border bg-card"
                />
              ))}
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed bg-card/40 px-6 py-12 text-center">
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
            <div className="flex flex-col gap-4">
              {scored.length > 0 ? (
                <section>
                  <h2 className="mb-2 text-sm font-semibold tracking-tight">
                    Tracked lifts
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {scored.map((lift) => {
                      const record = getExerciseBySlug(lift.slug);
                      const percent = Math.round(lift.score * 100);
                      const highlightedTier = tierFromScore(lift.score);
                      return (
                        <li
                          key={lift.slug}
                          className="rounded-2xl border bg-card p-3 shadow-sm"
                        >
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
                                <Badge variant={tierBadgeVariant(lift.tier)}>
                                  {percent}/100 · {lift.tier}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {Math.round(lift.oneRmKg)} kg estimated 1RM
                              </p>
                            </div>
                          </div>
                          <div className="mt-2.5 space-y-1">
                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                            <div className="flex items-start justify-between gap-1 text-[10px] text-muted-foreground">
                              {TIERS.map((tier) => {
                                const threshold = lift.thresholdsKg?.[tier];
                                const isHighlighted =
                                  tierIndex(tier) === tierIndex(highlightedTier);
                                return (
                                  <span
                                    key={tier}
                                    className="flex flex-col items-center leading-tight"
                                  >
                                    <span
                                      className={
                                        isHighlighted
                                          ? "font-medium text-foreground"
                                          : undefined
                                      }
                                    >
                                      {tier}
                                    </span>
                                    <span className="tabular-nums text-muted-foreground/80">
                                      {threshold !== undefined
                                        ? `${Math.round(threshold)} kg`
                                        : "—"}
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {unscored.length > 0 ? (
                <section>
                  <h2 className="mb-2 text-sm font-semibold tracking-tight">
                    Other lifts
                  </h2>
                  <p className="mb-2 text-xs text-muted-foreground">
                    These exercises don&apos;t have published StrengthLevel
                    standards, so they aren&apos;t scored.
                  </p>
                  <ul className="flex flex-col gap-2">
                    {unscored.map((lift) => {
                      const record = getExerciseBySlug(lift.slug);
                      return (
                        <li
                          key={lift.slug}
                          className="flex items-center gap-3 rounded-2xl border bg-card px-3 py-2.5 shadow-sm"
                        >
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
                </section>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
