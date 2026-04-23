"use client";

import { Flame } from "lucide-react";

type SessionPillProps = {
  setsCount: number;
  volume: number;
  unit: "kg" | "lb";
};

export function SessionPill({ setsCount, volume, unit }: SessionPillProps) {
  return (
    <div className="flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur">
      <Flame className="h-3.5 w-3.5 text-orange-500" />
      <span>{setsCount} sets</span>
      <span className="text-muted-foreground">·</span>
      <span>
        {volume.toLocaleString()} {unit}
      </span>
    </div>
  );
}
