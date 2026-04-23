"use client";

import Image from "next/image";
import { Camera, Dumbbell, MessagesSquare } from "lucide-react";
import type { ExerciseRecord } from "@/lib/types/workout";

type SetReceiptProps = {
  exercise: ExerciseRecord;
  reps: number | null;
  weight: number | null;
  weightUnit: "kg" | "lb";
  setNumber: number;
  source: "manual" | "camera" | "chat";
};

const sourceIcons = {
  manual: Dumbbell,
  camera: Camera,
  chat: MessagesSquare,
} as const;

export function SetReceipt({
  exercise,
  reps,
  weight,
  weightUnit,
  setNumber,
  source,
}: SetReceiptProps) {
  const Icon = sourceIcons[source];

  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-background/60 px-3 py-2.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
        <Image
          src={exercise.iconPath}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 object-contain"
          unoptimized
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold">{exercise.name}</p>
          <span className="text-xs text-muted-foreground">Set {setNumber}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {reps ?? "-"} reps · {weight ?? "-"} {weightUnit}
          </span>
          <Icon className="h-3 w-3" />
        </div>
      </div>
    </div>
  );
}
