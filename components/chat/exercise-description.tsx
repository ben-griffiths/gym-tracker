"use client";

import type { ExerciseRecord } from "@/lib/types/workout";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ExerciseGuideSheet } from "@/components/workout/exercise-guide-sheet";

type ExerciseDescriptionProps = {
  exercise: ExerciseRecord;
  mode: "instructions" | "description";
};

export function ExerciseDescription({
  exercise,
  mode,
}: ExerciseDescriptionProps) {
  const guide = exercise.guide;
  const fallbackDescription = `${exercise.name} is a ${
    exercise.category?.toLowerCase() ?? "weight"
  } exercise.`;

  return (
    <MessageBubble role="assistant">
      <div className="space-y-2">
        {mode === "instructions" ? (
          <InstructionsBody exercise={exercise} fallback={fallbackDescription} />
        ) : (
          <DescriptionBody exercise={exercise} fallback={fallbackDescription} />
        )}
        {guide ? (
          <ExerciseGuideSheet
            exercise={exercise}
            trigger={
              <button
                type="button"
                className="text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:underline"
              >
                See full guide with pictures
              </button>
            }
          />
        ) : null}
      </div>
    </MessageBubble>
  );
}

function InstructionsBody({
  exercise,
  fallback,
}: {
  exercise: ExerciseRecord;
  fallback: string;
}) {
  const steps = exercise.guide?.steps ?? [];
  if (steps.length === 0) {
    return (
      <p className="text-sm leading-relaxed">
        {exercise.guide?.intro ?? fallback}
      </p>
    );
  }
  return (
    <>
      <p className="text-sm font-medium text-foreground">
        Here&apos;s how to do {exercise.name.toLowerCase()}:
      </p>
      <ol className="space-y-1.5">
        {steps.map((step, index) => (
          <li
            key={index}
            className="flex items-start gap-2 text-sm leading-relaxed"
          >
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
              {index + 1}
            </span>
            <span>{step.text}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function DescriptionBody({
  exercise,
  fallback,
}: {
  exercise: ExerciseRecord;
  fallback: string;
}) {
  const intro = exercise.guide?.intro;
  const formCheck = exercise.guide?.formCheck ?? [];
  return (
    <>
      <p className="text-sm leading-relaxed">{intro ?? fallback}</p>
      {formCheck.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 pt-0.5">
          {formCheck.map((item) => (
            <li
              key={item}
              className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
