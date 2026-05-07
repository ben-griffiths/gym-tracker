/** Lowercase slug / custom id stretched into searchable words/spaces */
export function slugAsSearchHaystack(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[-_:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function exerciseMatchesSearchQuery(
  exerciseName: string,
  slug: string,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  if (exerciseName.toLowerCase().includes(q)) return true;
  return slugAsSearchHaystack(slug).includes(q);
}
