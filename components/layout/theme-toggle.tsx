"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@teispace/next-themes";
import { cn } from "@/lib/utils";

const MODES = [
  { value: "system" as const, label: "Auto", Icon: Monitor },
  { value: "light" as const, label: "Light", Icon: Sun },
  { value: "dark" as const, label: "Dark", Icon: Moon },
] as const;

type ThemeModeRadioGroupProps = {
  className?: string;
};

export function ThemeModeRadioGroup({ className }: ThemeModeRadioGroupProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selected: (typeof MODES)[number]["value"] =
    theme === "light" || theme === "dark" || theme === "system" ? theme : "system";

  if (!mounted) {
    return (
      <div className={cn("space-y-1.5", className)} aria-hidden>
        <p className="text-sm text-muted-foreground">Theme</p>
        <div className="flex w-full min-w-0 gap-0.5">
          <div className="h-8 min-w-0 flex-1 rounded-md bg-muted/50" />
          <div className="h-8 min-w-0 flex-1 rounded-md bg-muted/50" />
          <div className="h-8 min-w-0 flex-1 rounded-md bg-muted/50" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-sm text-muted-foreground" id="theme-mode-label">
        Theme
      </p>
      <div
        role="radiogroup"
        aria-labelledby="theme-mode-label"
        className="flex w-full min-w-0 gap-0.5"
      >
        {MODES.map(({ value, label, Icon }) => {
          const isSelected = selected === value;
          const id = `theme-mode-${value}`;
          return (
            <label
              key={value}
              htmlFor={id}
              className={cn(
                "flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border py-1.5 text-xs font-medium transition-colors",
                isSelected
                  ? "border-border bg-muted/80 text-foreground"
                  : "border-transparent text-foreground hover:bg-muted/50",
              )}
            >
              <input
                id={id}
                className="sr-only"
                type="radio"
                name="liftlog-theme"
                value={value}
                checked={isSelected}
                onChange={() => setTheme(value)}
              />
              <Icon
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  isSelected ? "text-foreground" : "text-muted-foreground",
                )}
                aria-hidden
              />
              <span className="truncate leading-none">{label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
