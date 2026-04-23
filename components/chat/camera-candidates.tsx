"use client";

import { Sparkles } from "lucide-react";
import { ExerciseOptionButton } from "@/components/chat/exercise-option-button";
import type { ExerciseWeightCandidate } from "@/lib/types/workout";

type CameraCandidatesProps = {
  candidates: ExerciseWeightCandidate[];
  onConfirm: (candidate: ExerciseWeightCandidate) => void;
};

export function CameraCandidates({ candidates, onConfirm }: CameraCandidatesProps) {
  if (candidates.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        Camera suggestions · tap to confirm
      </div>
      <div className="flex flex-col gap-1.5">
        {candidates.map((candidate) => (
          <ExerciseOptionButton
            key={`${candidate.exercise.slug}-${candidate.weight ?? "na"}`}
            exercise={candidate.exercise}
            onClick={() => onConfirm(candidate)}
            subtitle={`${Math.round(candidate.confidence * 100)}% confidence`}
            trailing={
              candidate.weight !== null
                ? `${candidate.weight} ${candidate.weightUnit}`
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
