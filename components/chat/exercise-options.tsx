"use client";

import { Dumbbell, Shuffle } from "lucide-react";
import { ExerciseOptionButton } from "@/components/chat/exercise-option-button";
import type { ExerciseRecord, SetDetail } from "@/lib/types/workout";

type ExerciseOptionsProps = {
  options: ExerciseRecord[];
  sets: SetDetail[];
  onSelect: (exercise: ExerciseRecord) => void;
  disabled?: boolean;
  variant?: "pick" | "switch";
};

function summarizeSets(sets: SetDetail[]) {
  if (sets.length === 0) return "start a new block";
  const parts = sets.map((set) => {
    const reps = set.reps ?? "–";
    const weight = set.weight !== null ? `${set.weight}${set.weightUnit}` : "–";
    return `${reps}×${weight}`;
  });
  return parts.join(" · ");
}

export function ExerciseOptions({
  options,
  sets,
  onSelect,
  disabled,
  variant = "pick",
}: ExerciseOptionsProps) {
  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing matched — try rephrasing or searching a specific exercise.
      </p>
    );
  }

  const isSwitch = variant === "switch";
  const HeaderIcon = isSwitch ? Shuffle : Dumbbell;
  const headerText = isSwitch
    ? "Not right? Switch to:"
    : sets.length > 0
      ? `Pick the exercise · ${summarizeSets(sets)}`
      : "Pick the exercise to start";

  // Switch variant flows as wrapping chips so alternates fill horizontal
  // space on wider viewports; pick variant keeps the single-column list to
  // emphasise the primary candidate.
  const listClassName = isSwitch
    ? "flex flex-wrap gap-1.5"
    : "flex flex-col gap-1.5";
  const buttonClassName = isSwitch
    ? "w-auto grow basis-44 min-w-0"
    : undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <HeaderIcon className="h-3.5 w-3.5" />
        {headerText}
      </div>
      <div className={listClassName}>
        {options.map((exercise) => (
          <ExerciseOptionButton
            key={exercise.slug}
            exercise={exercise}
            onClick={() => onSelect(exercise)}
            disabled={disabled}
            className={buttonClassName}
          />
        ))}
      </div>
    </div>
  );
}
