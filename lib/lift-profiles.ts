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
  /** From `tierFromScore(score)` so the label matches the 0…100 readout, not 1RM vs kg only. */
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

function monotonicThresholdPoints(thresholds: Thresholds): number[] {
  const points = [
    thresholds.beginner,
    thresholds.novice,
    thresholds.intermediate,
    thresholds.advanced,
    thresholds.elite,
  ];
  return points.reduce<number[]>((acc, value, index) => {
    if (index === 0) return [value];
    acc.push(Math.max(value, acc[index - 1] + 0.0001));
    return acc;
  }, []);
}

/**
 * Which tier a 1RM falls into, using the same monotonicized kg boundaries as
 * the catalog (half-open: below beginner, then up to each published tier).
 */
export function tierFromOneRmKg(
  oneRmKg: number,
  thresholds: Thresholds,
): StrengthTier {
  const m = monotonicThresholdPoints(thresholds);
  if (oneRmKg <= m[0]) return "Beginner";
  for (let i = 1; i < m.length; i += 1) {
    if (oneRmKg <= m[i]) {
      return TIERS[i] as StrengthTier;
    }
  }
  return "Elite";
}

const SCORE_BAND = 0.2;

/**
 * 0…1 bar score: four gaps between the five published kg thresholds, each
 * worth 0.2, plus 0.2 for any weight past the last threshold. At or below the
 * beginner (first) threshold the score is 0 — there is no “ramp from 0 to m0”.
 * Within (m[i−1], m[i]], score = (i−1)·0.2 + (w−lo)/(hi−lo)·0.2.
 * Call `tierFromScore` on the result for a label that matches this scale.
 */
export function scoreAgainstThresholds(
  oneRmKg: number,
  thresholds: Thresholds,
): { score: number } {
  const m = monotonicThresholdPoints(thresholds);
  if (!Number.isFinite(oneRmKg) || !m.every((x) => Number.isFinite(x))) {
    return { score: 0 };
  }

  if (oneRmKg < 0) {
    return { score: 0 };
  }

  if (oneRmKg <= m[0]) {
    return { score: 0 };
  }

  for (let i = 1; i <= 4; i += 1) {
    const lo = m[i - 1];
    const hi = m[i];
    if (oneRmKg > hi) {
      continue;
    }
    const base = (i - 1) * SCORE_BAND;
    const span = hi - lo;
    if (span > 0) {
      return {
        score: Math.min(1, base + ((oneRmKg - lo) / span) * SCORE_BAND),
      };
    }
    return { score: Math.min(1, base + SCORE_BAND) };
  }

  // Past the published elite 1RM (fifth 0.2 step).
  return { score: 1 };
}

/** Maps an aggregate 0…1 score to a label; bands align to 0.2 ticks on the bar. */
export function tierFromScore(score: number): StrengthTier {
  if (score < 0.2) return "Beginner";
  if (score < 0.4) return "Novice";
  if (score < 0.6) return "Intermediate";
  if (score < 0.8) return "Advanced";
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
    const { score } = scoreAgainstThresholds(oneRmKg, thresholds);
    profiles.push({
      exerciseName: name,
      slug,
      oneRmKg,
      score,
      tier: tierFromScore(score),
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
