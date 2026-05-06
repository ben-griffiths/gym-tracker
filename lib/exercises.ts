import exercisesJson from "../public/exercises/exercises.json";

export type ExerciseGuideStep = {
  text: string;
  imagePath: string | null;
};

export type ExerciseGuide = {
  url: string;
  intro: string | null;
  formCheck: string[];
  steps: ExerciseGuideStep[];
};

export type ExerciseRecord = {
  slug: string;
  name: string;
  category: string | null;
  iconPath: string;
  pageUrl: string;
  standards?: {
    unit: "kg" | "lb";
    sourceUrl: string;
    male: {
      beginner: number;
      novice: number;
      intermediate: number;
      advanced: number;
      elite: number;
    } | null;
    female: {
      beginner: number;
      novice: number;
      intermediate: number;
      advanced: number;
      elite: number;
    } | null;
  } | null;
  guide: ExerciseGuide | null;
};

type ExercisesFile = {
  source: string;
  scrapedAt: string;
  categories: string[];
  count: number;
  exercises: ExerciseRecord[];
};

const data = exercisesJson as ExercisesFile;

export const EXERCISES: ExerciseRecord[] = data.exercises;
export const EXERCISE_CATEGORIES: string[] = data.categories;

const BY_SLUG = new Map(EXERCISES.map((entry) => [entry.slug, entry]));
const BY_NAME = new Map(
  EXERCISES.map((entry) => [entry.name.toLowerCase(), entry]),
);

/** When the user query is a single colloquial token, prefer this catalog slug. */
const SHORT_QUERY_PREFERRED_SLUG: Record<string, string> = {
  bench: "bench-press",
};

export function getExerciseBySlug(slug: string): ExerciseRecord | null {
  return BY_SLUG.get(slug) ?? null;
}

export function getExerciseByName(name: string): ExerciseRecord | null {
  return BY_NAME.get(name.toLowerCase().trim()) ?? null;
}

/** Best-effort catalog match for a name stored on logged sets (fuzzy if needed). */
export function getExerciseByLoggedName(name: string): ExerciseRecord | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return getExerciseByName(trimmed) ?? searchExercises(trimmed, 1)[0] ?? null;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const EQUIPMENT_WORDS = new Set([
  "barbell",
  "bodyweight",
  "dumbbell",
  "machine",
  "cable",
  "smith",
]);

function score(queryTokens: string[], exercise: ExerciseRecord): number {
  if (queryTokens.length === 0) return 0;

  const nameLower = exercise.name.toLowerCase();
  const slugNormalized = exercise.slug.replace(/-/g, " ");
  const joined = queryTokens.join(" ");

  if (nameLower === joined) return 10_000;
  if (slugNormalized === joined) return 9_000;

  const nameTokens = tokenize(nameLower);
  if (nameTokens.length === 0) return 0;

  let hits = 0;
  let partials = 0;

  for (const qt of queryTokens) {
    if (qt.length < 2) continue;

    if (nameTokens.includes(qt)) {
      hits += 1;
      continue;
    }

    const isPrefixMatch = nameTokens.some(
      (nt) =>
        (nt.length >= 3 && qt.startsWith(nt)) ||
        (qt.length >= 3 && nt.startsWith(qt)),
    );
    if (isPrefixMatch) {
      partials += 1;
    }
  }

  if (hits === 0 && partials === 0) return 0;

  const coverage = (hits + partials * 0.5) / queryTokens.length;
  const brevity = 1 / Math.max(1, nameTokens.length);

  let categoryBoost = 0;
  if (exercise.category) {
    const category = exercise.category.toLowerCase();
    for (const qt of queryTokens) {
      if (EQUIPMENT_WORDS.has(qt) && category === qt) {
        categoryBoost += 25;
      }
    }
  }

  return coverage * 1000 + hits * 15 + categoryBoost + brevity;
}

export type ExerciseRank = { exercise: ExerciseRecord; score: number };

/** Same ranking as {@link searchExercises}, but includes numeric scores for tie-breaking UI. */
export function rankExercisesForQuery(query: string, limit = 5): ExerciseRank[] {
  const trimmed = query?.trim();
  if (!trimmed) return [];

  const exact = getExerciseByName(trimmed) ?? getExerciseBySlug(trimmed);
  const queryTokens = tokenize(trimmed);

  const ranked = EXERCISES.map((entry) => ({
    entry,
    score: score(queryTokens, entry),
  }))
    .filter(({ score: s }) => s > 0)
    .sort((a, b) => b.score - a.score);

  const top: ExerciseRank[] = [];
  if (exact) {
    top.push({ exercise: exact, score: score(queryTokens, exact) || 10_000 });
  }

  for (const { entry, score: sc } of ranked) {
    if (top.some((c) => c.exercise.slug === entry.slug)) continue;
    top.push({ exercise: entry, score: sc });
    if (top.length >= limit) break;
  }

  const preferred = SHORT_QUERY_PREFERRED_SLUG[trimmed.toLowerCase()];
  if (preferred) {
    const preferredEntry = getExerciseBySlug(preferred);
    if (preferredEntry) {
      const sc = score(queryTokens, preferredEntry);
      const at = top.findIndex((e) => e.exercise.slug === preferred);
      if (at > 0) {
        const rest = top.filter((e) => e.exercise.slug !== preferred);
        return [
          { exercise: preferredEntry, score: sc || 9_500 },
          ...rest,
        ].slice(0, limit);
      }
      if (at === -1) {
        const rest = top.filter((e) => e.exercise.slug !== preferred);
        return [
          { exercise: preferredEntry, score: sc || 9_500 },
          ...rest,
        ].slice(0, limit);
      }
    }
  }

  return top.slice(0, limit);
}

export function searchExercises(
  query: string,
  limit = 5,
): ExerciseRecord[] {
  return rankExercisesForQuery(query, limit).map((r) => r.exercise);
}

export function searchExercisesOrPopular(
  query: string,
  limit = 5,
): ExerciseRecord[] {
  const results = searchExercises(query, limit);
  if (results.length > 0) return results;
  return EXERCISES.slice(0, limit);
}

/**
 * Full-catalog search for the exercise library UI. Empty query returns every
 * exercise sorted A–Z; otherwise uses the same relevance ranking as chat search.
 */
export function filterExercisesBySearchQuery(query: string): ExerciseRecord[] {
  const trimmed = query?.trim() ?? "";
  if (!trimmed) {
    return [...EXERCISES].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }

  const queryTokens = tokenize(trimmed);
  if (queryTokens.length === 0) {
    return [...EXERCISES].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }

  return EXERCISES.map((entry) => ({
    entry,
    score: score(queryTokens, entry),
  }))
    .filter(({ score: s }) => s > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.name.localeCompare(b.entry.name, undefined, {
        sensitivity: "base",
      });
    })
    .map(({ entry }) => entry);
}
