"use client";

import { cn } from "@/lib/utils";
import { useUserWeightUnit } from "@/components/profile/user-weight-unit-provider";

const OPTIONS = [
  { value: "kg" as const, label: "kg" },
  { value: "lb" as const, label: "lb" },
];

type UserWeightUnitRadioGroupProps = {
  className?: string;
};

export function UserWeightUnitRadioGroup({
  className,
}: UserWeightUnitRadioGroupProps) {
  const { weightUnit, setWeightUnit } = useUserWeightUnit();

  return (
    <div className={cn("space-y-1.5", className)}>
      <p
        className="text-sm font-semibold text-foreground"
        id="weight-unit-label"
      >
        Weight units
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground/90">
        Display inputs, summaries, and chat hints follow this preference.
        Persisted workouts keep each set&apos;s stored weight and unit; strength
        math converts through canonical kg when needed (no double conversion).
      </p>
      <div
        role="radiogroup"
        aria-labelledby="weight-unit-label"
        className="flex w-full min-w-0 gap-1"
      >
        {OPTIONS.map(({ value, label }) => {
          const isSelected = weightUnit === value;
          const id = `weight-unit-${value}`;
          return (
            <label
              key={value}
              htmlFor={id}
              className={cn(
                "flex min-w-0 flex-1 cursor-pointer items-center justify-center rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                isSelected
                  ? "border-border bg-muted/80 text-foreground"
                  : "border-transparent text-foreground hover:bg-muted/50",
              )}
            >
              <input
                id={id}
                className="sr-only"
                type="radio"
                name="liftlog-weight-unit"
                value={value}
                checked={isSelected}
                onChange={() => setWeightUnit(value)}
              />
              {label}
            </label>
          );
        })}
      </div>
    </div>
  );
}
