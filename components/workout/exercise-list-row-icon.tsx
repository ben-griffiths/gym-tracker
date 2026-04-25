"use client";

import { Dumbbell } from "lucide-react";
import { getExerciseByLoggedName } from "@/lib/exercises";
import { cn } from "@/lib/utils";
import { ExerciseIconImage } from "@/components/workout/exercise-icon-image";

type ExerciseListRowIconProps = {
  exerciseName: string;
  className?: string;
};

/** 32×32 well + catalog icon (or dumbbell fallback) for session history rows. */
export function ExerciseListRowIcon({
  exerciseName,
  className,
}: ExerciseListRowIconProps) {
  const record = getExerciseByLoggedName(exerciseName);
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/60 dark:bg-muted/40",
        className,
      )}
    >
      {record?.iconPath ? (
        <ExerciseIconImage
          src={record.iconPath}
          width={28}
          height={28}
          className="h-7 w-7"
          unoptimized
        />
      ) : (
        <Dumbbell className="h-4 w-4 text-muted-foreground" aria-hidden />
      )}
    </span>
  );
}
