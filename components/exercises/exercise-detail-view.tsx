"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ExerciseIconImage } from "@/components/workout/exercise-icon-image";
import { Badge } from "@/components/ui/badge";
import { useAppHeaderCenter } from "@/components/layout/app-header-center-context";
import { ExercisePersonalStats } from "@/components/exercises/exercise-personal-stats";
import type { ExerciseRecord } from "@/lib/exercises";
import type { StrengthTier } from "@/lib/lift-profiles";

type StandardLevelKey =
  keyof NonNullable<NonNullable<ExerciseRecord["standards"]>["male"]>;

const TIER_ROW: { tier: StrengthTier; stdKey: StandardLevelKey }[] = [
  { tier: "Beginner", stdKey: "beginner" },
  { tier: "Novice", stdKey: "novice" },
  { tier: "Intermediate", stdKey: "intermediate" },
  { tier: "Advanced", stdKey: "advanced" },
  { tier: "Elite", stdKey: "elite" },
];

type ExerciseDetailViewProps = {
  exercise: ExerciseRecord;
};

export function ExerciseDetailView({ exercise }: ExerciseDetailViewProps) {
  const { setCustomTitle } = useAppHeaderCenter();

  useEffect(() => {
    setCustomTitle(exercise.name);
    return () => setCustomTitle(null);
  }, [exercise.name, setCustomTitle]);

  const cat = exercise.category?.trim();
  const standards = exercise.standards;
  const unitLabel = standards?.unit === "lb" ? "lb" : "kg";

  return (
    <div className="flex flex-col bg-background pb-12 pt-4">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 sm:px-6">
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
                    Strength standards
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

        {standards ? (
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold tracking-tight">
              Reference 1RM levels
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Published one-rep max benchmarks ({unitLabel}) from the catalog
              source. Compare to your estimated 1RM above.
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
                  {TIER_ROW.map((row) => {
                    const m = standards.male?.[row.stdKey];
                    const f = standards.female?.[row.stdKey];
                    return (
                      <tr
                        key={row.tier}
                        className="border-b border-border/60 last:border-0"
                      >
                        <td className="px-3 py-2.5 font-medium">{row.tier}</td>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                          {m != null ? `${m} ${unitLabel}` : "—"}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                          {f != null ? `${f} ${unitLabel}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
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
        ) : (
          <section className="rounded-2xl border border-dashed border-border/70 bg-muted/10 p-5">
            <h2 className="text-sm font-semibold tracking-tight">
              Reference 1RM levels
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
                      <div className="relative mt-2 aspect-video w-full max-w-md overflow-hidden rounded-xl border bg-muted">
                        <Image
                          src={step.imagePath}
                          alt=""
                          fill
                          className="object-contain"
                          unoptimized
                          sizes="(max-width: 768px) 100vw, 28rem"
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
          <Link href="/exercises" className="underline-offset-4 hover:underline">
            ← Back to library
          </Link>
        </p>
      </div>
    </div>
  );
}
