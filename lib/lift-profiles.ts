import {
  getExerciseByName,
  getExerciseBySlug,
  searchExercises,
} from "@/lib/exercises";
import { estimateOneRm } from "@/lib/rep-percentages";
import { flattenSets, type HistorySession } from "@/lib/workout-history";

export type StrengthTier =
  | "Beginner"
  | "Novice"
  | "Intermediate"
  | "Advanced"
  | "Elite";

export const TIERS: StrengthTier[] = [
  "Beginner",
  "Novice",
  "Intermediate",
  "Advanced",
  "Elite",
];

export type Thresholds = {
  beginner: number;
  novice: number;
  intermediate: number;
  advanced: number;
  elite: number;
};

export type LiftProfile = {
  exerciseName: string;
  slug: string;
  oneRmKg: number;
  score: number | null;
  tier: StrengthTier | null;
  /**
   * Catalog 1RM thresholds (in kg) for each tier, when StrengthLevel publishes
   * standards for this lift. Keyed by tier name so the UI can render "what
   * does 'Advanced' look like for this lift".
   */
  thresholdsKg: Record<StrengthTier, number> | null;
};

export function tierThresholdMap(thresholds: Thresholds): Record<StrengthTier, number> {
  return {
    Beginner: thresholds.beginner,
    Novice: thresholds.novice,
    Intermediate: thresholds.intermediate,
    Advanced: thresholds.advanced,
    Elite: thresholds.elite,
  };
}

export function toKg(weight: number, unit?: string) {
  if ((unit ?? "kg") === "lb") return weight * 0.45359237;
  return weight;
}

export function combineThresholds(standards: {
  male: Thresholds | null;
  female: Thresholds | null;
}): Thresholds | null {
  // Conservative baseline to avoid inflated levels: prefer male thresholds
  // when available, otherwise fall back to female.
  return standards.male ?? standards.female;
}

export function scoreAgainstThresholds(
  oneRmKg: number,
  thresholds: Thresholds,
): { score: number; tier: StrengthTier } {
  const points = [
    thresholds.beginner,
    thresholds.novice,
    thresholds.intermediate,
    thresholds.advanced,
    thresholds.elite,
  ];
  const monotonic = points.reduce<number[]>((acc, value, index) => {
    if (index === 0) return [value];
    acc.push(Math.max(value, acc[index - 1] + 0.0001));
    return acc;
  }, []);

  if (oneRmKg <= monotonic[0]) {
    const ratio = monotonic[0] > 0 ? oneRmKg / monotonic[0] : 0;
    return { score: Math.max(0, Math.min(1, ratio * 0.2)), tier: TIERS[0] };
  }
  for (let i = 1; i < monotonic.length; i += 1) {
    if (oneRmKg <= monotonic[i]) {
      const span = monotonic[i] - monotonic[i - 1];
      const ratio = span > 0 ? (oneRmKg - monotonic[i - 1]) / span : 0;
      const score = i * 0.2 + ratio * 0.2;
      return { score: Math.max(0, Math.min(1, score)), tier: TIERS[i] };
    }
  }
  return { score: 1, tier: TIERS[4] };
}

export function tierFromScore(score: number): StrengthTier {
  // Keep tiers conservative so low-60s don't read as "Advanced".
  if (score < 0.3) return "Beginner";
  if (score < 0.5) return "Novice";
  if (score < 0.7) return "Intermediate";
  if (score < 0.9) return "Advanced";
  return "Elite";
}

export function computeLiftProfiles(sessions: HistorySession[]): LiftProfile[] {
  const byExercise = new Map<string, number>();

  for (const session of sessions) {
    for (const set of flattenSets(session)) {
      const numericWeight = Number(set.weight);
      if (!Number.isFinite(numericWeight) || numericWeight <= 0) continue;
      const reps = set.reps && set.reps > 0 ? set.reps : 1;
      const weightKg = toKg(numericWeight, set.weightUnit);
      // Use StrengthLevel's published rep→%1RM table (scraped into
      // public/exercises/rep-percentages.json) so our estimates match what
      // users see on strengthlevel.com/one-rep-max-calculator. We pick the
      // LARGEST estimate across all of the user's sets for a given exercise,
      // which the outer loop handles via the running max below.
      const oneRmKg = estimateOneRm(weightKg, reps);

      const matched =
        getExerciseByName(set.exerciseName) ??
        searchExercises(set.exerciseName, 1)[0];
      if (!matched) continue;

      const current = byExercise.get(matched.slug);
      if (current === undefined || oneRmKg > current) {
        byExercise.set(matched.slug, oneRmKg);
      }
    }
  }

  const profiles: LiftProfile[] = [];
  for (const [slug, oneRmKg] of byExercise.entries()) {
    const record = getExerciseBySlug(slug);
    const name = record?.name ?? slug.replace(/-/g, " ");
    const thresholds = record?.standards
      ? combineThresholds(record.standards)
      : null;
    if (!thresholds) {
      profiles.push({
        exerciseName: name,
        slug,
        oneRmKg,
        score: null,
        tier: null,
        thresholdsKg: null,
      });
      continue;
    }
    const result = scoreAgainstThresholds(oneRmKg, thresholds);
    profiles.push({
      exerciseName: name,
      slug,
      oneRmKg,
      score: result.score,
      tier: result.tier,
      thresholdsKg: tierThresholdMap(thresholds),
    });
  }

  return profiles.sort((a, b) => {
    const aScore = a.score ?? -1;
    const bScore = b.score ?? -1;
    if (aScore !== bScore) return bScore - aScore;
    return b.oneRmKg - a.oneRmKg;
  });
}

export function computeAverageStrength(
  profiles: LiftProfile[],
): { score: number; tier: StrengthTier; liftsCount: number } | null {
  const scored = profiles.filter(
    (lift): lift is LiftProfile & { score: number } => lift.score !== null,
  );
  if (scored.length === 0) return null;
  const avg = scored.reduce((sum, lift) => sum + lift.score, 0) / scored.length;
  return {
    score: avg,
    tier: tierFromScore(avg),
    liftsCount: scored.length,
  };
}
