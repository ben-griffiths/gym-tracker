"use client";

import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useHistoryGroups } from "@/lib/sync/workouts-live";
import { useUserStrengthSex } from "@/components/profile/user-strength-sex-provider";
import { useUserWeightUnit } from "@/components/profile/user-weight-unit-provider";
import {
  buildRepMaxRows,
  type RepMaxRow,
  type RepMaxTableItem,
} from "@/lib/rep-maxes";
import { exerciseMatchesSearchQuery } from "@/lib/exercise-search-query";
import {
  RepMaxExerciseRowView,
  RepMaxOtherExercisesDivider,
} from "@/components/rep-maxes/rep-max-exercise-row-view";
import { suffixForUnit } from "@/lib/weight-units";

function rowHasLoggedEvidence(row: RepMaxRow): boolean {
  if (row.estimateKind === "logged") return true;
  if (Object.keys(row.maxes).length > 0) return true;
  if ((row.bestBodyweightReps ?? 0) > 0) return true;
  return false;
}

/** When `buildRepMaxRows` omits a separator, the list is either all logged or all catalog-only. */
function splitRepMaxBlocks(items: RepMaxTableItem[]): {
  logged: RepMaxRow[];
  catalog: RepMaxRow[];
} {
  const sepIdx = items.findIndex((i) => i.kind === "separator");
  if (sepIdx !== -1) {
    const logged = items
      .slice(0, sepIdx)
      .filter((i): i is RepMaxTableItem & { kind: "row" } => i.kind === "row")
      .map((i) => i.row);
    const catalog = items
      .slice(sepIdx + 1)
      .filter((i): i is RepMaxTableItem & { kind: "row" } => i.kind === "row")
      .map((i) => i.row);
    return { logged, catalog };
  }
  const rows = items
    .filter((i): i is RepMaxTableItem & { kind: "row" } => i.kind === "row")
    .map((i) => i.row);
  if (rows.some(rowHasLoggedEvidence)) {
    return { logged: rows, catalog: [] };
  }
  return { logged: [], catalog: rows };
}

function repMaxRowMatchesQuery(row: RepMaxRow, rawQuery: string): boolean {
  return exerciseMatchesSearchQuery(row.exerciseName, row.slug, rawQuery);
}

function filterRepMaxTableItems(
  listItems: RepMaxTableItem[],
  query: string,
): RepMaxTableItem[] {
  const q = query.trim();
  if (!q) return listItems;

  const { logged, catalog } = splitRepMaxBlocks(listItems);
  const loggedFiltered = logged.filter((row) => repMaxRowMatchesQuery(row, q));
  const catalogFiltered = catalog.filter((row) =>
    repMaxRowMatchesQuery(row, q),
  );

  const out: RepMaxTableItem[] = loggedFiltered.map((row) => ({
    kind: "row" as const,
    row,
  }));
  if (loggedFiltered.length > 0 && catalogFiltered.length > 0) {
    out.push({ kind: "separator", id: "other-exercises" });
  }
  for (const row of catalogFiltered) {
    out.push({ kind: "row", row });
  }
  return out;
}

export default function RepMaxesPage() {
  const historyQuery = useHistoryGroups();
  const { strengthSex } = useUserStrengthSex();
  const { weightUnit: weightDisplayUnit } = useUserWeightUnit();
  const [repMaxesSearchQuery, setRepMaxesSearchQuery] = useState("");

  const listItems = useMemo(() => {
    const sessions = (historyQuery.data?.groups ?? []).flatMap(
      (group) => group.sessions,
    );
    return buildRepMaxRows(sessions, strengthSex);
  }, [historyQuery.data, strengthSex]);

  const filteredItems = useMemo(
    () => filterRepMaxTableItems(listItems, repMaxesSearchQuery),
    [listItems, repMaxesSearchQuery],
  );

  const hasFilteredRows = filteredItems.some((i) => i.kind === "row");
  const isSearchActive = repMaxesSearchQuery.trim().length > 0;

  const isLoading = historyQuery.isLoading;

  return (
    <div className="flex flex-col bg-background">
      <main className="flex flex-1 flex-col pb-10 pt-5">
        <div className="flex w-full flex-col gap-6">
          {isLoading ? (
            <div className="h-64 animate-pulse rounded-2xl border bg-card" />
          ) : (
            <section
              className="overflow-hidden rounded-2xl border bg-card shadow-sm"
              aria-labelledby="rep-maxes-heading"
            >
              <div
                id="rep-maxes-heading"
                className="border-b bg-muted/30 px-4 py-3"
              >
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  Maxes
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Logged exercises first (strongest estimated 1RM), then untracked
                  catalog exercises (common lifts first, then higher estimated
                  1RM when available; missing estimates last).
                  Estimates from your log show weight × reps;
                  catalog-only rows use StrengthLevel intermediate for the male
                  / female column you chose in Profile (fallback to the other
                  column when a value is missing).
                </p>
              </div>
              <div className="border-b border-border/80 bg-card px-4 py-3">
                <label htmlFor="rep-maxes-search" className="sr-only">
                  Filter maxes by exercise
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="rep-maxes-search"
                    type="search"
                    placeholder="Search exercises…"
                    value={repMaxesSearchQuery}
                    onChange={(e) => setRepMaxesSearchQuery(e.target.value)}
                    className="h-10 rounded-xl border-border/80 bg-muted/30 pl-9 text-sm shadow-none"
                  />
                </div>
              </div>
              {isSearchActive && !hasFilteredRows ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No exercises match your search.
                </div>
              ) : (
                <ul className="list-none flex flex-col px-4">
                  {filteredItems.map((item, index) => {
                    if (item.kind === "separator") {
                      return (
                        <RepMaxOtherExercisesDivider key={item.id} />
                      );
                    }
                    const prev = index > 0 ? filteredItems[index - 1]! : null;
                    const showTopDivider =
                      prev !== null && prev.kind !== "separator";
                    return (
                      <RepMaxExerciseRowView
                        key={item.row.slug}
                        row={item.row}
                        showTopDivider={showTopDivider}
                        strengthSex={strengthSex}
                        weightDisplayUnit={weightDisplayUnit}
                        variant="full"
                      />
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          <p className="text-[11px] text-muted-foreground">
            The <span className="font-medium">top line</span> shows your{" "}
            <span className="font-medium">estimated 1RM</span>
            —from your strongest logged set projection, StrengthLevel catalog
            intermediate tier for your selected strength standard (male or
            female, from the profile menu), or bodyweight reps—mirroring the
            strength overview layout. The{" "}
            <span className="font-medium">rep strip</span> shows masses in{" "}
            <span className="font-medium">{suffixForUnit(weightDisplayUnit)}</span>{" "}
            at each rep count; muted numbers are targets from rep-% of that
            1RM. <span className="font-medium">BW</span> is bodyweight-only.
            Values follow your weight-unit preference under Profile (converted
            from canonical kg for display).
          </p>
        </div>
      </main>
    </div>
  );
}
