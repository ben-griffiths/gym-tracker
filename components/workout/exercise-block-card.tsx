"use client";

import type { ReactNode } from "react";
import { ExerciseIconImage } from "@/components/workout/exercise-icon-image";
import {
  ChevronDown,
  ChevronUp,
  CopyPlus,
  HelpCircle,
  Trash2,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { EffortFeel, ExerciseRecord } from "@/lib/types/workout";
import { ExerciseGuideSheet } from "@/components/workout/exercise-guide-sheet";

export type BlockSet = {
  id: string;
  dbId?: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  weightUnit: "kg" | "lb";
  source: "manual" | "camera" | "chat";
  rpe?: number | null;
  rir?: number | null;
  feel?: EffortFeel | null;
};

function formatRpeLabel(rpe: number | null | undefined): string | null {
  if (rpe === null || rpe === undefined) return null;
  const value = Number.isInteger(rpe) ? String(rpe) : rpe.toFixed(1);
  return `RPE ${value}`;
}

function feelBadgeClass(feel: EffortFeel): string {
  switch (feel) {
    case "easy":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "medium":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "hard":
      return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
}

type ExerciseBlockCardProps = {
  exercise: ExerciseRecord;
  sets: BlockSet[];
  active?: boolean;
  collapsed?: boolean;
  /** Set when the card sits in the sticky exercise header stack (collapsed rows). */
  sticky?: boolean;
  onToggle?: () => void;
  onDeleteSet?: (setId: string) => void;
  /** Appends a new set with the same reps, weight, and effort as this row. */
  onDuplicateSet?: (setId: string) => void;
  onDelete?: () => void;
  deleted?: boolean;
  onRestore?: () => void;
  /**
   * Shown as a border-separated footer inside the card (e.g. rep/weight
   * suggestion chips for the active exercise in the workout chat).
   */
  suggestionsFooter?: ReactNode;
};

function formatSet(set: BlockSet) {
  const reps = set.reps !== null ? `${set.reps} reps` : "– reps";
  const weight =
    set.weight !== null ? `${set.weight} ${set.weightUnit}` : "– weight";
  return { reps, weight };
}

function formatRepRange(sets: BlockSet[]): string {
  const reps = sets
    .map((set) => set.reps)
    .filter((value): value is number => value !== null);
  if (reps.length === 0) return "– reps";
  const min = Math.min(...reps);
  const max = Math.max(...reps);
  return min === max ? `${min} reps` : `${min}–${max} reps`;
}

function formatWeightRange(sets: BlockSet[]): string {
  const weights = sets
    .map((set) => set.weight)
    .filter((value): value is number => value !== null);
  if (weights.length === 0) return "";
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const unit = sets.find((set) => set.weight !== null)?.weightUnit ?? "kg";
  return min === max ? `${min} ${unit}` : `${min}–${max} ${unit}`;
}

export function ExerciseBlockCard({
  exercise,
  sets,
  active,
  collapsed,
  sticky,
  onToggle,
  onDeleteSet,
  onDuplicateSet,
  onDelete,
  deleted,
  onRestore,
  suggestionsFooter,
}: ExerciseBlockCardProps) {
  const summaryParts: string[] = [];
  if (deleted) {
    summaryParts.push("Deleted");
  } else {
    summaryParts.push(`${sets.length} ${sets.length === 1 ? "set" : "sets"}`);
    const reps = formatRepRange(sets);
    if (reps !== "– reps") summaryParts.push(reps);
    const weight = formatWeightRange(sets);
    if (weight) summaryParts.push(weight);
  }

  const ChevronIcon = collapsed ? ChevronDown : ChevronUp;
  const showGuide = !deleted && Boolean(exercise.guide);
  const showDelete = !deleted && Boolean(onDelete);
  const showSetDelete = !deleted && Boolean(onDeleteSet);
  const showSetDuplicate = !deleted && Boolean(onDuplicateSet);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-3xl shadow-sm transition-shadow",
        deleted && "border border-dashed bg-muted/30 shadow-none",
        !deleted &&
          (active && !collapsed
            ? "border-2 border-primary/50 bg-card"
            : "border border-border bg-card"),
        sticky && !deleted && "shadow-md",
      )}
      data-block-card
      data-deleted={deleted ? "true" : undefined}
    >
      <div
        className={cn(
          "flex w-full items-center gap-1 pr-4 transition-colors",
          collapsed
            ? cn(
                "border-b border-b-transparent",
                deleted ? "bg-transparent" : "bg-card",
              )
            : active && !deleted
              ? "border-b border-primary/25 bg-transparent"
              : "border-b border-border bg-card",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors",
            onToggle ? "cursor-pointer hover:bg-muted/70" : "cursor-default",
          )}
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? `Expand ${exercise.name}` : `Collapse ${exercise.name}`
          }
        >
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card",
              deleted && "opacity-50",
            )}
          >
            <ExerciseIconImage
              src={exercise.iconPath}
              width={36}
              height={36}
              className="h-9 w-9"
              unoptimized
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className={cn(
                "truncate text-sm font-semibold",
                deleted && "text-muted-foreground line-through",
              )}
            >
              {exercise.name}
            </span>
            <span className="truncate text-xs text-muted-foreground tabular-nums">
              {exercise.category ?? "Exercise"} · {summaryParts.join(" · ")}
            </span>
          </div>
          {onToggle ? (
            <ChevronIcon
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : null}
        </button>
        {showGuide ? (
          <ExerciseGuideSheet
            exercise={exercise}
            trigger={
              <button
                type="button"
                aria-label={`How to do ${exercise.name}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            }
          />
        ) : null}
        {showDelete ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${exercise.name}`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
        {deleted && onRestore ? (
          <button
            type="button"
            onClick={onRestore}
            aria-label={`Restore ${exercise.name}`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Undo2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {!collapsed ? (
        sets.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            No sets yet. Send reps or weight in the chat to add one.
          </div>
        ) : (
          <ul className="flex flex-col">
            {sets.map((set, index) => {
              const { reps: repsLabel, weight: weightLabel } = formatSet(set);
              const rpeLabel = formatRpeLabel(set.rpe);
              const hasEffort =
                rpeLabel !== null ||
                (set.rir !== null && set.rir !== undefined) ||
                Boolean(set.feel);
              return (
                <li key={set.id} className="flex flex-col">
                  {index > 0 ? (
                    <div
                      className="mx-4 h-px shrink-0 bg-border/70 dark:bg-border/50"
                      aria-hidden
                    />
                  ) : null}
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm tabular-nums">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                      {set.setNumber}
                    </span>
                    <span className="text-foreground">{repsLabel}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-foreground">{weightLabel}</span>
                    {hasEffort ? (
                      <span className="flex flex-wrap items-center gap-1">
                        {rpeLabel ? (
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            {rpeLabel}
                          </span>
                        ) : null}
                        {set.rir !== null && set.rir !== undefined ? (
                          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">
                            {`${set.rir} RIR`}
                          </span>
                        ) : null}
                        {set.feel ? (
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
                              feelBadgeClass(set.feel),
                            )}
                          >
                            {set.feel}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  {showSetDuplicate || (showSetDelete && onDeleteSet) ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5">
                      {showSetDuplicate && onDuplicateSet ? (
                        <button
                          type="button"
                          onClick={() => onDuplicateSet(set.id)}
                          disabled={set.reps === null && set.weight === null}
                          title="Duplicate this set"
                          aria-label={`Duplicate set ${set.setNumber}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <CopyPlus className="h-4 w-4" />
                        </button>
                      ) : null}
                      {showSetDelete && onDeleteSet ? (
                        <button
                          type="button"
                          onClick={() => onDeleteSet(set.id)}
                          aria-label={`Delete set ${set.setNumber}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {!collapsed && suggestionsFooter ? (
        <div
          className={cn(
            "flex min-h-0 min-w-0 items-center border-t px-1 py-1.5",
            !deleted && (active
              ? "border-primary/20 bg-card"
              : "border-border/70 bg-card"),
          )}
        >
          {suggestionsFooter}
        </div>
      ) : null}
    </div>
  );
}
