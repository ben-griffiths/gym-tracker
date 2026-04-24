"use client";

import { Sparkles } from "lucide-react";
import { ExerciseOptionButton } from "@/components/chat/exercise-option-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ExerciseWeightCandidate } from "@/lib/types/workout";

type CameraCandidatesProps = {
  candidates: ExerciseWeightCandidate[];
  onConfirm: (candidate: ExerciseWeightCandidate) => void;
};

function candidateSubtitle(candidate: ExerciseWeightCandidate): string {
  if (candidate.reasoning === "Catalog") {
    return "Catalog";
  }
  return `${Math.round(candidate.confidence * 100)}% match`;
}

export function CameraCandidates({ candidates, onConfirm }: CameraCandidatesProps) {
  if (candidates.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        Camera + catalog · tap to confirm
      </div>
      <ScrollArea
        className={
          candidates.length <= 6
            ? "pr-2"
            : "max-h-[min(50vh,22rem)] pr-2"
        }
      >
        <div className="flex flex-col gap-1.5 pb-1">
          {candidates.map((candidate) => (
            <ExerciseOptionButton
              key={`${candidate.exercise.slug}-${candidate.weight ?? "na"}`}
              exercise={candidate.exercise}
              onClick={() => onConfirm(candidate)}
              subtitle={candidateSubtitle(candidate)}
              trailing={
                candidate.weight !== null
                  ? `${candidate.weight} ${candidate.weightUnit}`
                  : undefined
              }
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
