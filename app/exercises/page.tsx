"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ExerciseIconImage } from "@/components/workout/exercise-icon-image";
import { Input } from "@/components/ui/input";
import {
  EXERCISES,
  filterExercisesBySearchQuery,
  type ExerciseRecord,
} from "@/lib/exercises";

function ExerciseLibraryRow({ exercise }: { exercise: ExerciseRecord }) {
  return (
    <Link
      href={`/exercises/${exercise.slug}`}
      className="group flex items-center gap-3 rounded-xl border border-transparent bg-card px-3 py-3 shadow-sm ring-1 ring-border/60 transition-colors hover:border-border hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted/50">
        {exercise.iconPath ? (
          <ExerciseIconImage
            src={exercise.iconPath}
            width={40}
            height={40}
            className="h-9 w-9"
            unoptimized
            alt=""
          />
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium group-hover:text-foreground">
          {exercise.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {exercise.category ?? "Catalog exercise"}
        </p>
      </div>
    </Link>
  );
}

export default function ExercisesLibraryPage() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () => filterExercisesBySearchQuery(query),
    [query],
  );

  return (
    <div className="flex flex-col bg-background pb-14 pt-4">
      <div className="flex w-full flex-col gap-5">
        <div>
          <p className="text-xs text-muted-foreground">
            Browse the full catalog sourced from Strength Level. Tap an exercise
            for standards and form notes when available.
          </p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by name, slug, equipment…"
            aria-label="Filter exercises"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 rounded-xl border-border/80 bg-card pl-9 shadow-sm"
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">{filtered.length} exercises</span>
          <span>Browse-only — your logs stay on workout</span>
        </div>

        <ul className="flex flex-col gap-2">
          {filtered.map((exercise) => (
            <li key={exercise.slug}>
              <ExerciseLibraryRow exercise={exercise} />
            </li>
          ))}
        </ul>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-muted/15 px-4 py-10 text-center text-sm text-muted-foreground">
            No matches for &quot;{query}&quot;. Try fewer words or a different
            equipment term — the catalog has {EXERCISES.length} lifts.
          </div>
        ) : null}
      </div>
    </div>
  );
}
