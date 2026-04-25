"use client";

import { ExerciseIconImage } from "@/components/workout/exercise-icon-image";
import { cn } from "@/lib/utils";
import type { ExerciseRecord } from "@/lib/types/workout";

type ExerciseOptionButtonProps = {
  exercise: ExerciseRecord;
  onClick: () => void;
  disabled?: boolean;
  trailing?: React.ReactNode;
  subtitle?: string;
  className?: string;
};

export function ExerciseOptionButton({
  exercise,
  onClick,
  disabled,
  trailing,
  subtitle,
  className,
}: ExerciseOptionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-60",
        className,
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
        <ExerciseIconImage
          src={exercise.iconPath}
          width={36}
          height={36}
          className="h-9 w-9"
          unoptimized
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{exercise.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {subtitle ?? exercise.category ?? "Exercise"}
        </span>
      </span>
      {trailing ? (
        <span className="shrink-0 text-sm font-semibold">{trailing}</span>
      ) : null}
    </button>
  );
}
