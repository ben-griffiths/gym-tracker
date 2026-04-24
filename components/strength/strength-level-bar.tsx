"use client";

import { cn } from "@/lib/utils";

/** Ticks at 20/40/60/80% of the bar. Bar hue is green (0) → orange (50) → red (100). */
const SCORE_TIER_START_PCT = [20, 40, 60, 80] as const;

type StrengthLevelBarProps = {
  /** 0–100: how much of the bar is “revealed” from the left; dashes white when past that point. */
  widthPercent: number;
  className?: string;
  trackClassName?: "h-1.5" | "h-2";
};

export function StrengthLevelBar({
  widthPercent,
  className,
  trackClassName = "h-2",
}: StrengthLevelBarProps) {
  const w = Math.max(0, Math.min(100, widthPercent));
  const coverPct = 100 - w;
  return (
    <div className={cn("relative w-full", className)}>
      <div
        className={cn(
          "relative z-0 w-full overflow-hidden rounded-full bg-muted",
          trackClassName,
        )}
      >
        {/* 0% = green, 50% = orange, 100% = red along the full bar; cover clips from the right. */}
        <div
          className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-green-500 from-[0%] via-orange-500 via-[50%] to-red-500 to-[100%] dark:from-lime-400 dark:via-amber-400 dark:to-rose-500"
          aria-hidden
        />
        <div
          className="absolute inset-y-0 right-0 z-[1] bg-muted transition-[width] duration-300 ease-out"
          style={{ width: `${coverPct}%` }}
          aria-hidden
        />
      </div>
      <div
        className={cn(
          "pointer-events-none absolute left-0 top-0 z-20 w-full",
          trackClassName,
        )}
        aria-hidden
      >
        {SCORE_TIER_START_PCT.map((pct) => {
          const inFill = w >= pct;
          return (
            <div
              key={pct}
              className={cn(
                "absolute top-0 h-full w-0.5 -translate-x-1/2 rounded-full",
                inFill
                  ? "bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.2)]"
                  : "bg-muted-foreground/50",
              )}
              style={{ left: `${pct}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
