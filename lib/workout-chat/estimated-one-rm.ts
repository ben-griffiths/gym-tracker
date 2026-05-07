import { computeLiftProfiles, toKg } from "@/lib/lift-profiles";
import type { UserStrengthSex } from "@/lib/user-strength-sex";
import { estimateOneRm } from "@/lib/rep-percentages";
import type { HistorySession } from "@/lib/workout-history";

/**
 * Largest StrengthLevel-table 1RM (kg) for a slug from Dexie-backed history,
 * matching {@link computeLiftProfiles}, then tightened with heavier estimates
 * from the current workout’s logged sets (matches chat prefill heuristics).
 */
export function buildEstimatedOneRmKgBySlug(
  sessions: HistorySession[],
  liveBlocks:
    | ReadonlyArray<{
        deleted?: boolean;
        exercise: { slug: string };
        sets: ReadonlyArray<{
          reps: number | null;
          weight: number | null;
          weightUnit: "kg" | "lb";
        }>;
      }>
    | null
    | undefined,
  strengthSex: UserStrengthSex = "male",
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of computeLiftProfiles(sessions, strengthSex)) {
    out[p.slug] = p.oneRmKg;
  }
  if (!liveBlocks?.length) return out;
  for (const block of liveBlocks) {
    if (block.deleted) continue;
    const slug = block.exercise.slug;
    let best = out[slug] ?? 0;
    for (const set of block.sets) {
      const reps = set.reps ?? null;
      const weight = set.weight ?? null;
      if (reps === null || reps < 1 || weight === null || weight <= 0) continue;
      const est = estimateOneRm(toKg(weight, set.weightUnit), reps);
      if (est > best) best = est;
    }
    if (best > 0) out[slug] = best;
  }
  return out;
}

export function getEstimatedOneRmKgForSlug(
  slug: string,
  sessions: HistorySession[],
  liveBlocks?: Parameters<typeof buildEstimatedOneRmKgBySlug>[1],
  strengthSex: UserStrengthSex = "male",
): number | null {
  const m = buildEstimatedOneRmKgBySlug(
    sessions,
    liveBlocks ?? null,
    strengthSex,
  );
  return m[slug] ?? null;
}
