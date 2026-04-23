"use client";

import { History } from "lucide-react";
import { cn } from "@/lib/utils";

export type RecentWorkoutSummary = {
  id: string;
  title: string;
  exerciseNames: string[];
  totalSets: number;
};

type Props = {
  workouts: RecentWorkoutSummary[];
  onSelect: (sessionId: string) => void;
  disabled?: boolean;
};

export function RecentWorkoutSuggestions({
  workouts,
  onSelect,
  disabled,
}: Props) {
  if (workouts.length === 0) return null;

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Start from a recent workout</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Tap one to copy its exercises, reps and weights into today&apos;s
        session.
      </p>
      <ul className="flex flex-col gap-2">
        {workouts.map((workout) => (
          <li key={workout.id}>
            <button
              type="button"
              onClick={() => onSelect(workout.id)}
              disabled={disabled}
              className={cn(
                "w-full rounded-xl border bg-background p-3 text-left transition-colors",
                "hover:border-primary/50 hover:bg-primary/5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium">
                  {workout.title}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {workout.totalSets}{" "}
                  {workout.totalSets === 1 ? "set" : "sets"}
                </span>
              </div>
              {workout.exerciseNames.length > 0 ? (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {workout.exerciseNames.join(" · ")}
                </p>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
