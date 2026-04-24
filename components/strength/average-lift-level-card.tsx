"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  TIERS,
  type StrengthTier,
} from "@/lib/lift-profiles";
import { StrengthLevelBar } from "@/components/strength/strength-level-bar";

export type AverageStrengthForCard = {
  score: number;
  tier: StrengthTier;
  liftsCount: number;
} | null;

type AverageLiftLevelCardProps = {
  averageStrength: AverageStrengthForCard;
  /** e.g. home page link row; omit on /strength and /workout */
  footer?: ReactNode;
  className?: string;
};

export function AverageLiftLevelCard({
  averageStrength,
  footer,
  className,
}: AverageLiftLevelCardProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1.5">
        <div className="min-w-0 flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold leading-tight tracking-tight">
            Average lift level
          </h2>
          <p className="text-xs leading-snug text-muted-foreground">
            {averageStrength
              ? `Based on ${averageStrength.liftsCount} ${
                  averageStrength.liftsCount === 1 ? "lift" : "lifts"
                } with a catalog standard`
              : "Log a few weighted sets to see your average"}
          </p>
        </div>
        <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">
          {averageStrength ? (
            <>
              <Badge
                variant="outline"
                className="h-6 shrink-0 border-emerald-200/80 bg-emerald-50 px-2 text-xs font-normal text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
              >
                {averageStrength.tier}
              </Badge>
              <Badge
                variant="outline"
                className="h-6 shrink-0 border-sky-200/80 bg-sky-50 px-2 text-xs font-normal tabular-nums text-sky-900 dark:border-sky-500/35 dark:bg-sky-950/50 dark:text-sky-100"
              >
                {Math.round(averageStrength.score * 100)}/100
              </Badge>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </div>
      </div>

      <div className="px-4 pt-0 pb-0">
        <div className="space-y-1 pb-1">
          <StrengthLevelBar
            widthPercent={(averageStrength?.score ?? 0) * 100}
            trackClassName="h-2"
          />
          <div className="grid grid-cols-5 text-center text-[10px] leading-tight text-muted-foreground sm:text-[11px]">
            {TIERS.map((tier) => (
              <span key={tier} className="min-w-0">
                {tier}
              </span>
            ))}
          </div>
        </div>
      </div>

      {footer}
    </section>
  );
}
