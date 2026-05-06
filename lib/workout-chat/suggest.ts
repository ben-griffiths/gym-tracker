import {
  getExerciseBySlug,
  rankExercisesForQuery,
  type ExerciseRank,
  type ExerciseRecord,
} from "@/lib/exercises";
import { slugBoostsForQuery } from "@/lib/workout-chat/exercise-synonyms";

/** Upper bound for catalog-ranked candidates merged before chip picks. */
export const WORKOUT_CHAT_SUGGEST_MAX_CATALOG_RANK = 25;

/** Cap distinct recent custom names merged into suggestions. */
export const WORKOUT_CHAT_SUGGEST_MAX_CUSTOM = 15;

/** Max chips shown in the composer strip. */
export const WORKOUT_CHAT_SUGGEST_MAX_CHIPS = 6;

export type CatalogExerciseInput = Pick<
  ExerciseRecord,
  "slug" | "name" | "category"
>;

export type WorkoutChatSuggestInput = {
  value: string;
  caret: number;
  recentExerciseNames: string[];
  catalogExercises: CatalogExerciseInput[];
  currentExerciseSlug?: string | null;
  unitHint?: "kg" | "lb" | null;
  /** Usually `@ 72.5kg`-style tails extracted from recent chat lines / Dexie-backed strings. */
  recentLoadSnippets?: string[];
  /** Prefer load tails from the active exercise block’s logged sets (same ordering rules). */
  currentExerciseLoadSnippets?: string[];
  /** Recent user chat lines — volume tokens parsed for Phase B/C (no invention). */
  recentUserTexts?: string[];
  /** When true (IME composition), return no suggestions. */
  skipSuggestions?: boolean;
};

export type WorkoutChatSuggestPhase = "exercise" | "load" | "volume";

export type WorkoutChatSuggestionKind =
  | "exercise"
  | "load"
  | "volume"
  | "rep"
  | "set";

export type WorkoutChatSuggestionItem = {
  /** Short chip text */
  label: string;
  /** Inserted at caret (append) unless {@link applyWorkoutChatSuggestionAtCaret} uses exercise replace. */
  insertText: string;
  kind: WorkoutChatSuggestionKind;
};

export type WorkoutChatSuggestOutput = {
  /** @deprecated Inline ghost — kept null; use `suggestions` + chips. */
  ghost: string | null;
  phase: WorkoutChatSuggestPhase;
  suggestions: WorkoutChatSuggestionItem[];
};

export function splitLineAtCaret(
  value: string,
  caret: number,
): { lineStart: number; lineBefore: string; lineAfter: string } {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const before = value.slice(0, safeCaret);
  const after = value.slice(safeCaret);
  const lastNl = before.lastIndexOf("\n");
  const lineStart = lastNl + 1;
  const lineBefore = before.slice(lineStart);
  const nlAfter = after.indexOf("\n");
  const lineAfter = nlAfter === -1 ? after : after.slice(0, nlAfter);
  return { lineStart, lineBefore, lineAfter };
}

export function applyGhostAtCaret(
  value: string,
  caret: number,
  ghost: string,
): { nextValue: string; nextCaret: number } {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  return {
    nextValue: value.slice(0, safeCaret) + ghost + value.slice(safeCaret),
    nextCaret: safeCaret + ghost.length,
  };
}

/** Replace the current line prefix (line start → caret) with exercise text, or append for non-exercise kinds. */
export function applyWorkoutChatSuggestionAtCaret(
  value: string,
  caret: number,
  item: WorkoutChatSuggestionItem,
): { nextValue: string; nextCaret: number } {
  if (item.kind === "exercise") {
    const { lineStart } = splitLineAtCaret(value, caret);
    const insert =
      item.insertText.endsWith(" ") || item.insertText.endsWith("\n")
        ? item.insertText
        : `${item.insertText} `;
    const nextValue = value.slice(0, lineStart) + insert + value.slice(caret);
    const nextCaret = lineStart + insert.length;
    return { nextValue, nextCaret };
  }
  return applyGhostAtCaret(value, caret, item.insertText);
}

export function ghostSuffixIgnoreCase(
  prefix: string,
  completion: string,
): string | null {
  const pl = prefix.toLowerCase();
  const cl = completion.toLowerCase();
  if (!cl.startsWith(pl)) return null;
  return completion.slice(prefix.length);
}

function slugAsSpaces(slug: string): string {
  return slug.replace(/-/g, " ");
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const PRESS_FAMILY = new Set(["press"]);

function fuzzyRelationScore(queryTokens: string[], exercise: ExerciseRecord): number {
  if (queryTokens.length === 0) return 0;
  let score = 0;
  const nameLower = exercise.name.toLowerCase();
  const slugLower = exercise.slug.replace(/-/g, " ");
  const nameToks = tokenize(nameLower);

  for (const qt of queryTokens) {
    if (qt.length < 2) continue;
    if (nameLower.includes(qt) || slugLower.includes(qt)) score += 32;
    if (nameToks.some((nt) => nt.includes(qt) || qt.includes(nt))) score += 18;
  }

  const q0 = queryTokens[0];
  const n0 = nameToks[0];
  if (q0 && n0 && q0.length >= 3 && n0.length >= 3 && q0 === n0) score += 22;

  const qPress = queryTokens.some((t) => PRESS_FAMILY.has(t));
  const nPress = nameToks.some((t) => PRESS_FAMILY.has(t));
  if (qPress && nPress) score += 14;

  return score;
}

function catalogSlugAllowSet(
  catalog: CatalogExerciseInput[],
): Set<string> | null {
  if (catalog.length === 0) return null;
  return new Set(catalog.map((e) => e.slug));
}

/**
 * Merge catalog filter, `rankExercisesForQuery`, synonym buckets, and fuzzy token boosts (capped).
 */
export function rankExercisesForWorkoutChatSuggest(
  queryTrimEnd: string,
  catalog: CatalogExerciseInput[],
): ExerciseRank[] {
  const slugAllow = catalogSlugAllowSet(catalog);
  const allow = (slug: string) => !slugAllow || slugAllow.has(slug);

  const base = rankExercisesForQuery(queryTrimEnd, 55).filter((r) =>
    allow(r.exercise.slug),
  );

  const scores = new Map<string, number>();
  const exBySlug = new Map<string, ExerciseRecord>();

  for (const r of base) {
    scores.set(r.exercise.slug, r.score);
    exBySlug.set(r.exercise.slug, r.exercise);
  }

  for (const { slug, boost } of slugBoostsForQuery(queryTrimEnd)) {
    if (!allow(slug)) continue;
    const ex = getExerciseBySlug(slug);
    if (!ex) continue;
    exBySlug.set(slug, ex);
    scores.set(slug, Math.max(scores.get(slug) ?? 0, boost));
  }

  const qTokens = tokenize(queryTrimEnd);
  const fuzzySlugs = new Set<string>();
  for (const r of base.slice(0, 36)) fuzzySlugs.add(r.exercise.slug);
  for (const { slug } of slugBoostsForQuery(queryTrimEnd)) {
    if (allow(slug)) fuzzySlugs.add(slug);
  }

  for (const slug of fuzzySlugs) {
    const ex = exBySlug.get(slug) ?? getExerciseBySlug(slug);
    if (!ex || !allow(slug)) continue;
    exBySlug.set(slug, ex);
    const fz = fuzzyRelationScore(qTokens, ex);
    if (fz > 0) {
      scores.set(slug, (scores.get(slug) ?? 0) + fz);
    }
  }

  const merged: ExerciseRank[] = [...scores.entries()]
    .map(([slug, score]) => {
      const exercise = exBySlug.get(slug);
      if (!exercise) return null;
      return { exercise, score };
    })
    .filter((x): x is ExerciseRank => x !== null && x.score > 0)
    .sort((a, b) => b.score - a.score);

  return merged.slice(0, WORKOUT_CHAT_SUGGEST_MAX_CATALOG_RANK);
}

function shortExerciseLabel(name: string): string {
  const t = name.trim();
  if (t.length <= 22) return t;
  return `${t.slice(0, 20)}…`;
}

export function hasNumericVolumeContext(line: string): boolean {
  return /\d+\s*[x×]\s*\d+/i.test(line) || /\d+\s+reps?\b/i.test(line);
}

const SETS_REPS_TAIL = /\d+\s*[x×]\s*\d+\s*$/i;
const REPS_WORD_TAIL = /\d+\s+reps?\s*$/i;
const INCOMPLETE_X = /\d+\s*[x×]\s*$/i;
const TRAILING_REPS_WORD = /(\d+)\s+reps?\s*$/i;

/** Visible `@72.5` style weights missing an explicit unit suffix. */
function endsWithAtWeightMissingUnit(line: string): boolean {
  return (
    /@\s*\d+(?:\.\d+)?\s*$/i.test(line) &&
    !/\d+(?:\.\d+)?\s*(kg|lb)\s*$/i.test(line)
  );
}

function isVolumeShapedLine(trimmed: string): boolean {
  if (!trimmed) return false;
  return hasNumericVolumeContext(trimmed) || /^\d/.test(trimmed);
}

function minResolvedNameLen(name: string): boolean {
  return name.trim().length >= 4;
}

export function exerciseNameResolvedInLine(
  lineLower: string,
  catalog: CatalogExerciseInput[],
): boolean {
  for (const e of catalog) {
    const n = e.name.toLowerCase();
    if (minResolvedNameLen(n) && lineLower.includes(n)) return true;
    const slugSp = slugAsSpaces(e.slug).toLowerCase();
    if (slugSp.length >= 5 && lineLower.includes(slugSp)) return true;
  }
  return false;
}

export function exerciseContextResolved(
  lineTrimEnd: string,
  catalog: CatalogExerciseInput[],
  currentExerciseSlug: string | null | undefined,
): boolean {
  const low = lineTrimEnd.toLowerCase();
  if (exerciseNameResolvedInLine(low, catalog)) return true;

  if (currentExerciseSlug && isVolumeShapedLine(lineTrimEnd.trim())) {
    return true;
  }

  return false;
}

/**
 * Pull `@ weight`-style ghost tails from free text (user chat lines).
 * Only derives literals present in the source strings — never invents loads.
 */
export function extractLoadSnippetsFromTexts(
  texts: string[],
  limit = 24,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const compound = /(\d+)\s*[x×]\s*(\d+)\s+@\s*([\d.]+)\s*(kg|lb)?/gi;
  const atOnly = /@\s*([\d.]+)\s*(kg|lb)/gi;

  for (const text of texts) {
    for (const m of text.matchAll(compound)) {
      const unit = (m[4] ?? "kg").toLowerCase();
      const snippet = ` @ ${m[3]}${unit}`;
      if (!seen.has(snippet)) {
        seen.add(snippet);
        out.push(snippet);
        if (out.length >= limit) return out;
      }
    }
    for (const m of text.matchAll(atOnly)) {
      const unit = (m[2] ?? "kg").toLowerCase();
      const snippet = ` @ ${m[1]}${unit}`;
      if (!seen.has(snippet)) {
        seen.add(snippet);
        out.push(snippet);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

export function formatSetsLoadSnippetsFromBlockSets(
  sets: ReadonlyArray<{
    reps: number | null;
    weight: number | null;
    weightUnit: "kg" | "lb";
  }>,
  limit = 8,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = sets.length - 1; i >= 0; i -= 1) {
    const s = sets[i];
    if (s.weight === null || !Number.isFinite(s.weight)) continue;
    const snippet = ` @ ${s.weight}${s.weightUnit}`;
    if (!seen.has(snippet)) {
      seen.add(snippet);
      out.push(snippet);
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** `5×5`, `3×8`, plus bare reps from `N reps` (Phase C, history-only). */
export function extractVolumeTemplatesFromTexts(
  texts: string[],
  limit = 20,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const combo = /(\d+)\s*[x×]\s*(\d+)/gi;
  const repsWord = /(\d+)\s+reps?\b/gi;

  for (const text of texts) {
    for (const m of text.matchAll(combo)) {
      const s = `${m[1]}×${m[2]}`;
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
        if (out.length >= limit) return out;
      }
    }
  }
  for (const text of texts) {
    for (const m of text.matchAll(repsWord)) {
      const s = m[1]!;
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

function extractRepSecondariesFromTexts(texts: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const combo = /(\d+)\s*[x×]\s*(\d+)/gi;
  for (const text of texts) {
    for (const m of text.matchAll(combo)) {
      const s = m[2]!;
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

function extractSetPresFromTexts(texts: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const combo = /(\d+)\s*[x×]\s*(\d+)/gi;
  for (const text of texts) {
    for (const m of text.matchAll(combo)) {
      const s = m[1]!;
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

function normalizeHyphensToSpaces(s: string): string {
  return s.replace(/-/g, " ");
}

function loadSnippetChips(input: WorkoutChatSuggestInput): WorkoutChatSuggestionItem[] {
  const merged = [
    ...(input.currentExerciseLoadSnippets ?? []),
    ...(input.recentLoadSnippets ?? []),
  ];
  const out: WorkoutChatSuggestionItem[] = [];
  const seen = new Set<string>();
  for (const s of merged) {
    const t = s.trim();
    if (!t) continue;
    const label = t.length > 18 ? `${t.slice(0, 16)}…` : t;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push({
      label,
      insertText: s,
      kind: "load",
    });
    if (out.length >= WORKOUT_CHAT_SUGGEST_MAX_CHIPS) break;
  }
  return out;
}

function unitFixChip(input: WorkoutChatSuggestInput): WorkoutChatSuggestionItem | null {
  const unit = input.unitHint === "lb" ? "lb" : "kg";
  const insert = unit === "kg" ? "kg" : " lb";
  return { label: unit === "kg" ? "kg" : "lb", insertText: insert, kind: "load" };
}

function tryLoadAndVolumePhase(
  lineBeforeTrimEnd: string,
  input: WorkoutChatSuggestInput,
): { phase: WorkoutChatSuggestPhase; suggestions: WorkoutChatSuggestionItem[] } | null {
  const texts = input.recentUserTexts ?? [];

  if (
    hasNumericVolumeContext(lineBeforeTrimEnd) &&
    endsWithAtWeightMissingUnit(lineBeforeTrimEnd)
  ) {
    const u = unitFixChip(input);
    return u ? { phase: "load", suggestions: [u] } : null;
  }

  const incompleteX = INCOMPLETE_X.test(lineBeforeTrimEnd);
  const repsWordMatch = TRAILING_REPS_WORD.exec(lineBeforeTrimEnd);

  if (incompleteX) {
    const reps = extractRepSecondariesFromTexts(texts, 12);
    const chips: WorkoutChatSuggestionItem[] = reps
      .slice(0, WORKOUT_CHAT_SUGGEST_MAX_CHIPS)
      .map((r) => ({
        label: r,
        insertText: `${r} `,
        kind: "rep" as const,
      }));
    if (chips.length > 0) return { phase: "volume", suggestions: chips };
  }

  if (repsWordMatch && !SETS_REPS_TAIL.test(lineBeforeTrimEnd)) {
    const sets = extractSetPresFromTexts(texts, 12);
    const combos = extractVolumeTemplatesFromTexts(texts, 24).filter((t) =>
      t.includes("×"),
    );
    const repN = repsWordMatch[1]!;
    const matchingCombos = combos.filter((c) => c.endsWith(`×${repN}`));

    const setChips: WorkoutChatSuggestionItem[] = sets.slice(0, 4).map((s) => ({
      label: `${s}×…`,
      insertText: `${s}×`,
      kind: "set" as const,
    }));
    const comboChips: WorkoutChatSuggestionItem[] = matchingCombos
      .slice(0, 6)
      .map((t) => ({
        label: t,
        insertText: `${t} `,
        kind: "volume" as const,
      }));
    const suggestions = [...setChips, ...comboChips].slice(
      0,
      WORKOUT_CHAT_SUGGEST_MAX_CHIPS,
    );
    if (suggestions.length > 0) return { phase: "volume", suggestions };
  }

  if (SETS_REPS_TAIL.test(lineBeforeTrimEnd) || REPS_WORD_TAIL.test(lineBeforeTrimEnd)) {
    const loads = loadSnippetChips(input);
    if (loads.length > 0) return { phase: "load", suggestions: loads };
  }

  return null;
}

function volumeTemplateChips(texts: string[]): WorkoutChatSuggestionItem[] {
  const raw = extractVolumeTemplatesFromTexts(texts, 24);
  const reps = raw.filter((t) => /^\d+$/.test(t));
  const combos = raw.filter((t) => t.includes("×"));
  reps.sort((a, b) => Number(a) - Number(b));
  const ordered = [...reps, ...combos];
  return ordered.slice(0, WORKOUT_CHAT_SUGGEST_MAX_CHIPS).map((t) => ({
    label: t,
    insertText: t.includes("×") ? `${t} ` : `${t} `,
    kind: "volume" as const,
  }));
}

export function workoutChatSuggest(
  input: WorkoutChatSuggestInput,
): WorkoutChatSuggestOutput {
  if (input.skipSuggestions) {
    return { ghost: null, phase: "exercise", suggestions: [] };
  }

  const caret = Math.max(0, Math.min(input.caret, input.value.length));
  const { lineBefore } = splitLineAtCaret(input.value, caret);
  const lineTrimEnd = lineBefore.replace(/\s+$/u, "");
  const lineLower = lineTrimEnd.toLowerCase();

  const resolved = exerciseContextResolved(
    lineTrimEnd,
    input.catalogExercises,
    input.currentExerciseSlug ?? null,
  );

  const liftedOnly =
    !hasNumericVolumeContext(lineTrimEnd) &&
    !endsWithAtWeightMissingUnit(lineTrimEnd);

  const trailingSpace = /\s$/u.test(lineBefore);

  const lv = tryLoadAndVolumePhase(lineTrimEnd, input);
  if (lv && lv.suggestions.length > 0) {
    return { ghost: null, phase: lv.phase, suggestions: lv.suggestions };
  }

  if (
    resolved &&
    liftedOnly &&
    exerciseNameResolvedInLine(lineLower, input.catalogExercises) &&
    trailingSpace
  ) {
    const vol = volumeTemplateChips(input.recentUserTexts ?? []);
    if (vol.length > 0) {
      return { ghost: null, phase: "volume", suggestions: vol };
    }
  }

  if (
    input.currentExerciseSlug &&
    liftedOnly &&
    isVolumeShapedLine(lineTrimEnd.trim()) &&
    !exerciseNameResolvedInLine(lineLower, input.catalogExercises)
  ) {
    const vol = volumeTemplateChips(input.recentUserTexts ?? []);
    if (vol.length > 0) {
      return { ghost: null, phase: "volume", suggestions: vol };
    }
  }

  if (liftedOnly) {
    const queryTrimEnd = lineBefore.trimEnd();
    if (queryTrimEnd.length === 0) {
      return { ghost: null, phase: "exercise", suggestions: [] };
    }

    const ranked = rankExercisesForWorkoutChatSuggest(
      queryTrimEnd,
      input.catalogExercises,
    );

    type Cand = {
      label: string;
      insertText: string;
      kind: "exercise";
      score: number;
    };

    const cands: Cand[] = [];

    const pushEx = (name: string, score: number) => {
      const insertText = `${name} `;
      cands.push({
        label: shortExerciseLabel(name),
        insertText,
        kind: "exercise",
        score,
      });
    };

    let i = 0;
    for (const r of ranked) {
      if (i >= WORKOUT_CHAT_SUGGEST_MAX_CHIPS * 2) break;
      pushEx(r.exercise.name, r.score + 2);
      i += 1;
    }

    let customIdx = 0;
    const seenNames = new Set(cands.map((c) => c.insertText.trim().toLowerCase()));
    const unifiedQuery = normalizeHyphensToSpaces(queryTrimEnd);
    for (const name of input.recentExerciseNames) {
      if (cands.length >= WORKOUT_CHAT_SUGGEST_MAX_CHIPS * 2) break;
      if (customIdx >= WORKOUT_CHAT_SUGGEST_MAX_CUSTOM) break;
      const t = name.trim();
      if (!t) continue;
      customIdx += 1;
      const score = 4100 - customIdx;
      if (
        ghostSuffixIgnoreCase(queryTrimEnd, t) ||
        ghostSuffixIgnoreCase(unifiedQuery.trimEnd(), t)
      ) {
        if (!seenNames.has(t.toLowerCase())) {
          seenNames.add(t.toLowerCase());
          pushEx(t, score);
        }
      }
    }

    cands.sort((a, b) => b.score - a.score);
    const dedup: WorkoutChatSuggestionItem[] = [];
    const seen = new Set<string>();
    for (const c of cands) {
      const k = c.insertText.trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push({
        label: c.label,
        insertText: c.insertText,
        kind: c.kind,
      });
      if (dedup.length >= WORKOUT_CHAT_SUGGEST_MAX_CHIPS) break;
    }

    return { ghost: null, phase: "exercise", suggestions: dedup };
  }

  return { ghost: null, phase: "load", suggestions: [] };
}
