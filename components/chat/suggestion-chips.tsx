"use client";

import { cn } from "@/lib/utils";

type Chip = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

type SuggestionChipsProps = {
  chips: Chip[];
  className?: string;
};

export function SuggestionChips({ chips, className }: SuggestionChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div
      className={cn(
        "flex snap-x gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={chip.onClick}
          disabled={chip.disabled}
          className="shrink-0 snap-start rounded-full border bg-background px-3.5 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
