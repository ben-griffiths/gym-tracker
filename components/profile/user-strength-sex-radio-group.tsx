"use client";

import { cn } from "@/lib/utils";
import { useUserStrengthSex } from "@/components/profile/user-strength-sex-provider";

const OPTIONS = [
  { value: "male" as const, label: "Male" },
  { value: "female" as const, label: "Female" },
];

type UserStrengthSexRadioGroupProps = {
  className?: string;
};

export function UserStrengthSexRadioGroup({
  className,
}: UserStrengthSexRadioGroupProps) {
  const { strengthSex, setStrengthSex } = useUserStrengthSex();

  return (
    <div className={cn("space-y-1.5", className)}>
      <p
        className="text-sm font-semibold text-foreground"
        id="strength-sex-label"
      >
        Choose sex
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground/90">
        Used for estimated maxes, exercise comparisons, and in-app tips.
      </p>
      <div
        role="radiogroup"
        aria-labelledby="strength-sex-label"
        className="flex w-full min-w-0 gap-1"
      >
        {OPTIONS.map(({ value, label }) => {
          const isSelected = strengthSex === value;
          const id = `strength-sex-${value}`;
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
                name="liftlog-strength-sex"
                value={value}
                checked={isSelected}
                onChange={() => setStrengthSex(value)}
              />
              {label}
            </label>
          );
        })}
      </div>
    </div>
  );
}
