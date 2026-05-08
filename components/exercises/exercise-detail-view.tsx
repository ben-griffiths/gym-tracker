"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ExerciseIconImage } from "@/components/workout/exercise-icon-image";
import { Badge } from "@/components/ui/badge";
import { useAppHeaderCenter } from "@/components/layout/app-header-center-context";
import { ExerciseEmgSection } from "@/components/exercises/exercise-emg-section";
import { ExercisePersonalStats } from "@/components/exercises/exercise-personal-stats";
import { useUserWeightUnit } from "@/components/profile/user-weight-unit-provider";
import {
  type BodyweightKgMatrixRow,
  type ExerciseRecord,
  type StrengthStandardFiveTier,
  isBodyweightExerciseStandards,
  type BodyweightExerciseStandards,
} from "@/lib/exercises";
import type { StrengthTier } from "@/lib/lift-profiles";
import {
  formatWeightKgForDisplay,
  suffixForUnit,
  toKg,
  type WeightUnitPreference,
} from "@/lib/weight-units";

const TIER_ROW: { tier: StrengthTier; stdKey: keyof StrengthStandardFiveTier }[] =
  [
    { tier: "Beginner", stdKey: "beginner" },
    { tier: "Novice", stdKey: "novice" },
    { tier: "Intermediate", stdKey: "intermediate" },
    { tier: "Advanced", stdKey: "advanced" },
    { tier: "Elite", stdKey: "elite" },
  ];

/** Reps: catalog stores Strength Level `"< 1"` as `0`. */
function formatCommunityReps(n: number) {
  if (n === 0) return "< 1";
  return String(n);
}

function formatSignedKgOffsetForDisplay(
  kgOffset: number,
  displayUnit: WeightUnitPreference,
) {
  const abs = `${formatWeightKgForDisplay(Math.abs(kgOffset), displayUnit)} ${suffixForUnit(displayUnit)}`;
  if (kgOffset === 0) return abs.trim();
  if (kgOffset < 0) return `−${abs}`;
  return `+${abs}`;
}

function BodyweightBwMatrix(props: {
  title: string;
  rowsMale: BodyweightKgMatrixRow[];
  rowsFemale: BodyweightKgMatrixRow[];
  mode: "reps" | "addedKg";
  displayUnit: WeightUnitPreference;
}) {
  const { title, rowsMale, rowsFemale, mode, displayUnit } = props;
  const head = ["BW", "Beg.", "Nov.", "Int.", "Adv.", "Elite"];

  const panels = (
    [
      { label: "Male", rows: rowsMale },
      { label: "Female", rows: rowsFemale },
    ] as const
  ).filter((p) => p.rows.length > 0);

  if (panels.length === 0) return null;

  function cellBw(kgBw: number) {
    return `${formatWeightKgForDisplay(kgBw, displayUnit)} ${suffixForUnit(displayUnit)}`;
  }

  function cellTier(n: number) {
    if (mode === "reps") return formatCommunityReps(n);
    return formatSignedKgOffsetForDisplay(n, displayUnit);
  }

  const gridCols =
    panels.length >= 2 ? "sm:grid-cols-2" : "sm:grid-cols-1 max-w-xl";

  return (
    <div className="mt-4 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className={`grid gap-4 ${gridCols}`}>
        {panels.map((panel) => (
          <div key={panel.label} className="space-y-1.5">
            <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
              {panel.label}
            </div>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[300px] border-collapse text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                    {head.map((h) => (
                      <th
                        key={`${panel.label}-${h}`}
                        className="px-2 py-2 tabular-nums"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  {panel.rows.map((r) => (
                    <tr
                      key={`${panel.label}-${r.bodyweightKg}`}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-2 py-1.5 font-medium">{cellBw(r.bodyweightKg)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{cellTier(r.beginner)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{cellTier(r.novice)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{cellTier(r.intermediate)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{cellTier(r.advanced)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{cellTier(r.elite)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BodyweightBenchmarkSection({
  standards,
  displayUnit,
}: {
  standards: BodyweightExerciseStandards;
  displayUnit: WeightUnitPreference;
}) {
  const hasEcOneRm =
    standards.male?.entireCommunityOneRmAddedKgByTier != null ||
    standards.female?.entireCommunityOneRmAddedKgByTier != null;

  const maleRepsBw = standards.male?.repsByBodyweightKg ?? [];
  const femaleRepsBw = standards.female?.repsByBodyweightKg ?? [];
  const maleOneRmBw = standards.male?.oneRmAddedKgByBodyweight ?? [];
  const femaleOneRmBw = standards.female?.oneRmAddedKgByBodyweight ?? [];

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold tracking-tight">
        Bodyweight benchmarks
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Community rep benchmarks
        {hasEcOneRm ? (
          <>
            {" "}
            and <span className="font-medium">1RM added load</span> (positive ≈ extra
            weight; negative ≈ assistance)
          </>
        ) : null}
        . Matrices list targets by nominal body mass; catalog values are kg and converted
        to <span className="font-medium">{suffixForUnit(displayUnit)}</span> for display.
      </p>

      <div className="mt-4 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[280px] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5">Level</th>
              <th className="px-3 py-2.5">Male reps</th>
              <th className="px-3 py-2.5">Female reps</th>
            </tr>
          </thead>
          <tbody>
            {TIER_ROW.map((row) => {
              const mr = standards.male?.entireCommunityRepsByTier[row.stdKey];
              const fr = standards.female?.entireCommunityRepsByTier[row.stdKey];
              return (
                <tr
                  key={`ec-reps-${row.tier}`}
                  className="border-b border-border/60 text-muted-foreground last:border-0"
                >
                  <td className="px-3 py-2.5 font-medium text-foreground">
                    {row.tier}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {mr == null ? "—" : formatCommunityReps(mr)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {fr == null ? "—" : formatCommunityReps(fr)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasEcOneRm ? (
        <div className="mt-4 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[280px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5">Level</th>
                <th className="px-3 py-2.5">Male 1RM added</th>
                <th className="px-3 py-2.5">Female 1RM added</th>
              </tr>
            </thead>
            <tbody>
              {TIER_ROW.map((row) => {
                const mk =
                  standards.male?.entireCommunityOneRmAddedKgByTier?.[row.stdKey];
                const fk =
                  standards.female?.entireCommunityOneRmAddedKgByTier?.[
                    row.stdKey
                  ];
                return (
                  <tr
                    key={`ec-kg-${row.tier}`}
                    className="border-b border-border/60 text-muted-foreground last:border-0"
                  >
                    <td className="px-3 py-2.5 font-medium text-foreground">
                      {row.tier}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {mk == null
                        ? "—"
                        : formatSignedKgOffsetForDisplay(mk, displayUnit)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {fk == null
                        ? "—"
                        : formatSignedKgOffsetForDisplay(fk, displayUnit)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <BodyweightBwMatrix
        title="Reps × bodyweight (by tier)"
        rowsMale={maleRepsBw}
        rowsFemale={femaleRepsBw}
        mode="reps"
        displayUnit={displayUnit}
      />

      <BodyweightBwMatrix
        title="1RM added load × bodyweight"
        rowsMale={maleOneRmBw}
        rowsFemale={femaleOneRmBw}
        mode="addedKg"
        displayUnit={displayUnit}
      />

      <a
        href={standards.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Source table
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </section>
  );
}

type ExerciseDetailViewProps = {
  exercise: ExerciseRecord;
};

export function ExerciseDetailView({ exercise }: ExerciseDetailViewProps) {
  const { setCustomTitle } = useAppHeaderCenter();
  const { weightUnit: displayUnit } = useUserWeightUnit();

  useEffect(() => {
    setCustomTitle(exercise.name);
    return () => setCustomTitle(null);
  }, [exercise.name, setCustomTitle]);

  const cat = exercise.category?.trim();
  const standards = exercise.standards;
  const displaySuffix = suffixForUnit(displayUnit);

  return (
    <div className="flex flex-col bg-background pb-12 pt-4">
      <div className="flex w-full flex-col gap-6">
        <header className="flex flex-col gap-4 rounded-3xl border bg-gradient-to-b from-card to-card/80 p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-muted/60 sm:h-24 sm:w-24">
              {exercise.iconPath ? (
                <ExerciseIconImage
                  src={exercise.iconPath}
                  width={88}
                  height={88}
                  className="h-[5.25rem] w-[5.25rem] sm:h-24 sm:w-24"
                  unoptimized
                  alt=""
                />
              ) : (
                <span className="text-xs text-muted-foreground">No icon</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
                {exercise.name}
              </h1>
              <div className="mt-2 flex flex-wrap gap-2">
                {cat ? (
                  <Badge variant="secondary" className="text-xs">
                    {cat}
                  </Badge>
                ) : null}
                {standards ? (
                  <Badge variant="outline" className="text-xs">
                    {isBodyweightExerciseStandards(standards)
                      ? "Bodyweight benchmarks"
                      : "1RM reference"}
                  </Badge>
                ) : null}
              </div>
              <a
                href={exercise.pageUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                View on Strength Level
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </div>
          </div>
        </header>

        <ExercisePersonalStats catalogSlug={exercise.slug} />

        <ExerciseEmgSection slug={exercise.slug} />

        {standards ? (
          isBodyweightExerciseStandards(standards) ? (
            <BodyweightBenchmarkSection
              standards={standards}
              displayUnit={displayUnit}
            />
          ) : (
            <section className="rounded-2xl border bg-card p-5 shadow-sm">
              <h2 className="text-sm font-semibold tracking-tight">
                Reference 1RM table
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Published one-rep max benchmarks converted to{" "}
                <span className="font-medium">{displaySuffix}</span>{" "}
                for display using your profile preference (catalog source
                publishes in its native unit).
              </p>
              <div className="mt-4 overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[280px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2.5">Level</th>
                      <th className="px-3 py-2.5">Male</th>
                      <th className="px-3 py-2.5">Female</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const catalogMassUnit: WeightUnitPreference =
                        standards.unit === "lb" ? "lb" : "kg";
                      function cell(raw: number | undefined) {
                        if (raw == null) return "—";
                        const kgMass = toKg(raw, catalogMassUnit);
                        return `${formatWeightKgForDisplay(kgMass, displayUnit)} ${displaySuffix}`;
                      }
                      return TIER_ROW.map((row) => {
                        const m = standards.male?.[row.stdKey];
                        const f = standards.female?.[row.stdKey];
                        return (
                          <tr
                            key={row.tier}
                            className="border-b border-border/60 last:border-0"
                          >
                            <td className="px-3 py-2.5 font-medium">
                              {row.tier}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                              {cell(m)}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                              {cell(f)}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
              <a
                href={standards.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Source table
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </section>
          )
        ) : (
          <section className="rounded-2xl border border-dashed border-border/70 bg-muted/10 p-5">
            <h2 className="text-sm font-semibold tracking-tight">
              Reference 1RM table
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              This exercise does not have published strength-standard rows in the
              local catalog yet.
            </p>
          </section>
        )}

        {exercise.guide ? (
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold tracking-tight">How to</h2>
            {exercise.guide.intro ? (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {exercise.guide.intro}
              </p>
            ) : null}
            {exercise.guide.formCheck?.length ? (
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Form cues
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
                  {exercise.guide.formCheck.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {exercise.guide.steps?.length ? (
              <ol className="mt-4 flex list-decimal flex-col gap-4 pl-5 text-sm">
                {exercise.guide.steps.map((step, i) => (
                  <li key={i} className="pl-1">
                    <p className="leading-relaxed">{step.text}</p>
                    {step.imagePath ? (
                      <div className="relative mt-2 aspect-video w-full overflow-hidden rounded-xl border bg-muted">
                        <Image
                          src={step.imagePath}
                          alt=""
                          fill
                          className="object-contain"
                          unoptimized
                          sizes="(max-width: 768px) 100vw, 100vw"
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {exercise.guide.url ? (
              <a
                href={exercise.guide.url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                Full guide
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : null}
          </section>
        ) : null}

        <p className="text-center text-xs text-muted-foreground">
          <Link
            href="/exercises"
            prefetch
            className="underline-offset-4 hover:underline"
          >
            ← Back to library
          </Link>
        </p>
      </div>
    </div>
  );
}
