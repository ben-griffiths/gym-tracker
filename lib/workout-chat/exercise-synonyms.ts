/**
 * Phrase → catalog slugs for vaguer exercise matching in workout chat.
 * Keys are lowercase, space-separated phrases; slugs are ordered by typical usefulness.
 */
export const EXERCISE_QUERY_SYNONYM_SLUGS: Record<string, string[]> = {
  "shoulder press": [
    "military-press",
    "shoulder-press",
    "arnold-press",
    "dumbbell-shoulder-press",
  ],
  "overhead press": [
    "military-press",
    "shoulder-press",
    "arnold-press",
    "dumbbell-shoulder-press",
  ],
  "ohp": ["military-press", "shoulder-press", "arnold-press"],
  "military press": ["military-press", "shoulder-press"],
  "arnold press": ["arnold-press", "dumbbell-shoulder-press"],
};

export type SynonymSlugBoost = { slug: string; boost: number };

function normalizePhrase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Return synonym slug boosts when the user query overlaps a bucket phrase.
 */
export function slugBoostsForQuery(rawQuery: string): SynonymSlugBoost[] {
  const q = normalizePhrase(rawQuery);
  if (q.length < 2) return [];

  const out: SynonymSlugBoost[] = [];
  const seen = new Set<string>();

  for (const [phrase, slugs] of Object.entries(EXERCISE_QUERY_SYNONYM_SLUGS)) {
    if (phrase.length < 3) continue;
    const same = q === phrase;
    const qInPhrase = q.length >= 3 && phrase.includes(q);
    const phraseInQ = phrase.length >= 3 && q.includes(phrase);
    if (!same && !qInPhrase && !phraseInQ) continue;

    let base = 6500;
    if (same) base = 9200;
    else if (phraseInQ) base = 8800;
    else if (qInPhrase) base = 8200;

    slugs.forEach((slug, i) => {
      if (seen.has(slug)) return;
      seen.add(slug);
      out.push({ slug, boost: base - i * 12 });
    });
  }

  return out;
}
