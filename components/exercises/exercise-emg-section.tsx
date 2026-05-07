import {
  getExerciseEmgActivation,
  MUSCLE_GROUPS,
  type MuscleGroup,
} from "@/lib/exercise-emg-activation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STRENGTH_LEVEL_BAR_GRADIENT_CLASS } from "@/lib/strength-level-bar-gradient";

/** Border hue at the reveal edge; matches StrengthLevelBar green→orange→red progression (t ∈ [0,1]). */
function thumbBorderFromBarProgress(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const hue = 128 - 88 * x;
  const sat = `${72 + 8 * (1 - x)}%`;
  const light = `${47 + 11 * x}%`;
  return `hsl(${hue} ${sat} ${light})`;
}

function muscleGroupLabel(id: MuscleGroup): string {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type ExerciseEmgSectionProps = {
  slug: string;
  /** Card on exercise detail page vs compact block inside how-to dialog. */
  variant?: "page" | "embedded";
};

export function ExerciseEmgSection({
  slug,
  variant = "page",
}: ExerciseEmgSectionProps) {
  const emg = getExerciseEmgActivation(slug);
  if (!emg) return null;

  const rows = MUSCLE_GROUPS.map((g) => ({ group: g, value: emg.relativeEmg[g] }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  if (rows.length === 0) return null;

  const maxVal = Math.max(...rows.map((r) => r.value), 1);
  const embedded = variant === "embedded";
  const Heading = embedded ? "h3" : "h2";

  return (
    <section
      className={cn(
        embedded ? "" : "rounded-2xl border bg-card p-5 shadow-sm",
      )}
      aria-labelledby={embedded ? "exercise-emg-heading-embedded" : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Heading
          id={embedded ? "exercise-emg-heading-embedded" : undefined}
          className={cn(
            "font-semibold tracking-tight text-foreground",
            embedded ? "text-xs" : "text-sm",
          )}
        >
          Relative muscle emphasis
        </Heading>
        <Badge
          variant={emg.confidence === "cited" ? "secondary" : "outline"}
          className="shrink-0 text-[10px] font-medium uppercase tracking-wide"
        >
          {emg.confidence === "cited" ? "Aligned with cites" : "Estimated"}
        </Badge>
      </div>
      <p
        className={cn(
          "mt-1 text-muted-foreground",
          embedded ? "text-[11px] leading-snug" : "text-xs",
        )}
      >
        Illustrative rankings from surface-EMG-style patterns using a{" "}
        <span className="tabular-nums font-medium text-foreground/80">0–100</span>{" "}
        scale comparing muscles{" "}
        <strong className="font-medium text-foreground/90">within this lift only</strong>
        ; not comparable across exercises or to true %MVIC. Technique and
        individual anatomy shift results.
      </p>

      <ul
        className={cn(
          "flex flex-col",
          embedded ? "mt-2 gap-2" : "mt-3 gap-2.5",
        )}
      >
        {rows.map(({ group, value }) => {
          const fillPctRaw = (value / maxVal) * 100;
          const fillPct = Math.round(fillPctRaw * 10) / 10;
          const safeFill = Math.max(fillPct, 2);
          /** Thumb center; keeps chip inside the track at extreme fills. */
          const markerLeft = `clamp(0.75rem, ${fillPct}%, calc(100% - 0.75rem))`;
          const rounded = Math.round(value);
          const gradientChildWidthPct = 10000 / safeFill;

          return (
            <li key={group} className="min-w-0 overflow-visible">
              <span className="block truncate text-xs font-medium leading-tight text-foreground">
                {muscleGroupLabel(group)}
              </span>
              <div className="relative mt-1 h-2.5 w-full">
                <div
                  className="absolute inset-0 overflow-hidden rounded-full bg-muted/90"
                  role="presentation"
                >
                  <div
                    className="absolute inset-y-0 left-0 overflow-hidden rounded-full"
                    style={{ width: `${fillPct}%` }}
                  >
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0 h-full min-h-0",
                        STRENGTH_LEVEL_BAR_GRADIENT_CLASS,
                      )}
                      style={{ width: `${gradientChildWidthPct}%` }}
                    />
                  </div>
                </div>
                <output
                  aria-label={`${muscleGroupLabel(group)} relative emphasis ${rounded} on this exercise’s 0–100 scale`}
                  className="pointer-events-none absolute top-1/2 left-0 z-[2] -translate-x-1/2 -translate-y-1/2"
                  style={{ left: markerLeft }}
                >
                  <span
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 bg-card text-[10px] font-bold leading-none tabular-nums text-foreground shadow-sm ring-1 ring-background/90"
                    style={{
                      borderColor: thumbBorderFromBarProgress(fillPct / 100),
                    }}
                  >
                    {rounded}
                  </span>
                </output>
              </div>
            </li>
          );
        })}
      </ul>

      {emg.notes ? (
        <p
          className={cn(
            "leading-snug text-muted-foreground",
            embedded ? "mt-2 text-[10px]" : "mt-4 text-[11px]",
          )}
        >
          {emg.notes}
        </p>
      ) : null}
    </section>
  );
}
