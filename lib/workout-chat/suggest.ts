import {
  getExerciseBySlug,
  rankExercisesForQuery,
  type ExerciseRank,
  type ExerciseRecord,
} from "@/lib/exercises";
import { percentageOfOneRm } from "@/lib/rep-percentages";
import {
  formatLoadIncrement,
  oneRmKgToDisplayUnit,
  rpeChipsRoundIncrement,
  weightLoadIncrement,
} from "@/lib/weight-increments";
import { formatWeightKgForDisplay, toKg } from "@/lib/weight-units";
import { slugBoostsForQuery } from "@/lib/workout-chat/exercise-synonyms";

/** Upper bound for catalog-ranked candidates merged before chip picks. */
export const WORKOUT_CHAT_SUGGEST_MAX_CATALOG_RANK = 25;

/** Cap distinct recent custom names merged into suggestions. */
export const WORKOUT_CHAT_SUGGEST_MAX_CUSTOM = 15;

/** Max chips shown in the composer strip. */
export const WORKOUT_CHAT_SUGGEST_MAX_CHIPS = 6;

/**
 * Generic barbell-ish defaults when there is no history-derived `@ …` load text.
 * Not user-specific; explicit unit suffix matches {@link WorkoutChatSuggestInput.unitHint}.
 */
export const WORKOUT_CHAT_SUGGEST_DEFAULT_LOAD_KG = [
  20, 40, 60, 80, 100,
] as const;
export const WORKOUT_CHAT_SUGGEST_DEFAULT_LOAD_LB = [
  45, 95, 135, 185, 225,
] as const;

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
  /** Display unit for `@` chips; defaults to {@link WorkoutChatSuggestInput.unitHint} or kg. */
  weightUnit?: "kg" | "lb" | null;
  /** When the composer line resolves to {@link WorkoutChatSuggestInput.currentExerciseSlug}, use this 1RM (kg). */
  estimatedOneRmKg?: number | null;
  /** Max estimated 1RM (kg) per catalog slug (history + lift profile logic in `lib/workout-chat/estimated-one-rm.ts`). */
  estimatedOneRmKgBySlug?: Readonly<Record<string, number>> | null;
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

/**
 * Normalizes text inserted at `caret` for append kinds: adds exactly one leading space when the
 * character before `caret` is non-whitespace and `insertText` does not already start with
 * whitespace (avoids double spaces). If `caret === 0` or the previous character is whitespace
 * (space, tab, newline — i.e. caret at buffer start or after a separator), returns `insertText`
 * unchanged.
 */
export function ensureSpaceBeforeInsertIfNeeded(
  value: string,
  caret: number,
  insertText: string,
): string {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  if (safeCaret === 0) return insertText;
  const prev = value.charAt(safeCaret - 1);
  if (/\s/u.test(prev)) return insertText;
  if (/^\s/u.test(insertText)) return insertText;
  return ` ${insertText}`;
}

/**
 * Applies a chip suggestion at the caret.
 *
 * **exercise** — Replaces the current line from `lineStart` (see {@link splitLineAtCaret}) through `caret`
 * with `insertText`. Ensures a trailing space after the exercise segment when `insertText` does not already
 * end with space or newline. No leading separator (replacement begins at line start, not after prior text).
 *
 * **load | volume | rep | set** — Inserts at `caret` using {@link ensureSpaceBeforeInsertIfNeeded}, then
 * {@link applyGhostAtCaret} so a word-boundary gap appears only when needed (e.g. `dips` + `@ 20kg` → `dips @ 20kg`;
 * load snippets that already include a leading space keep a single gap).
 */
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
  const toInsert = ensureSpaceBeforeInsertIfNeeded(
    value,
    caret,
    item.insertText,
  );
  return applyGhostAtCaret(value, caret, toInsert);
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
const TRAILING_SETS_WORD = /\d+\s+sets\s*$/i;
const INCOMPLETE_X = /\d+\s*[x×]\s*$/i;
const TRAILING_REPS_WORD = /(\d+)\s+reps?\s*$/i;

/** True when the user has already typed an `@ …` fragment or explicit kg/lb literal. */
function hasLoadTailFragment(lineTrimEnd: string): boolean {
  return (
    /@/i.test(lineTrimEnd) || /\d+(?:\.\d+)?\s*(?:kg|lb)\b/i.test(lineTrimEnd)
  );
}

function labelForBareRepDigit(insertTextBare: string): string {
  return `${insertTextBare} reps`;
}

function volumeTemplateChipLabelsForInsert(insertTextStem: string): {
  label: string;
  insertText: string;
} {
  const stem = insertTextStem.trimEnd();
  if (/^\d+$/.test(stem))
    return { label: `${stem} reps`, insertText: `${stem} reps ` };
  return { label: stem, insertText: `${stem} ` };
}

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
  options?: { limit?: number; displayUnit?: "kg" | "lb" },
): string[] {
  const limit = options?.limit ?? 8;
  const displayUnit = options?.displayUnit ?? "kg";
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = sets.length - 1; i >= 0; i -= 1) {
    const s = sets[i];
    if (s.weight === null || !Number.isFinite(s.weight)) continue;
    const kg = toKg(s.weight, s.weightUnit);
    const label = formatWeightKgForDisplay(kg, displayUnit);
    const snippet = ` @ ${label}${displayUnit}`;
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

/** Unicode NBSP (often from autocorrect) → normal space for comparisons. */
function normalizeSuggestSpaces(s: string): string {
  return s.replace(/\u00a0/g, " ");
}

/**
 * True when the trimmed line exactly matches a catalog exercise display name
 * (case-insensitive) or the slug rendered with spaces ("bench-press" → "bench press").
 * Used to enter volume chips after a chip apply even when there is no trailing space yet,
 * and when substring-only guards would otherwise keep ranking exercises.
 */
export function lineMatchesCanonicalCatalogExercise(
  lineTrimmed: string,
  catalog: CatalogExerciseInput[],
): boolean {
  const norm = normalizeSuggestSpaces(lineTrimmed).trim().toLowerCase();
  if (!norm) return false;
  for (const e of catalog) {
    if (e.name.trim().toLowerCase() === norm) return true;
    if (slugAsSpaces(e.slug).toLowerCase() === norm) return true;
  }
  return false;
}

/**
 * Top-2 are "too close" — keep exercise chips for disambiguation (e.g. "shoulder press"
 * matches the Shoulder Press record but Military Press is still a plausible runner-up).
 */
const EXACT_LINE_VOLUME_MAX_RUNNER_UP_RATIO = 0.91;

/**
 * True when the line is an exact canonical match **and** the ranker puts that exercise
 * clearly ahead of alternatives (runner-up score ratio below {@link EXACT_LINE_VOLUME_MAX_RUNNER_UP_RATIO}).
 */
function exactCatalogLineQualifiesForVolume(
  lineTrimEnd: string,
  catalog: CatalogExerciseInput[],
): boolean {
  const norm = normalizeSuggestSpaces(lineTrimEnd).trim().toLowerCase();
  if (!norm) return false;
  let exact: CatalogExerciseInput | null = null;
  for (const e of catalog) {
    if (e.name.trim().toLowerCase() === norm) {
      exact = e;
      break;
    }
    if (slugAsSpaces(e.slug).toLowerCase() === norm) {
      exact = e;
      break;
    }
  }
  if (!exact) return false;
  const ranked = rankExercisesForWorkoutChatSuggest(lineTrimEnd, catalog);
  if (ranked[0]?.exercise.slug !== exact.slug) return false;
  if (ranked.length < 2) return true;
  const runnerUpRatio = ranked[1]!.score / ranked[0]!.score;
  return runnerUpRatio < EXACT_LINE_VOLUME_MAX_RUNNER_UP_RATIO;
}

function normalizeLoadChipDedupeKey(insertText: string): string {
  return normalizeSuggestSpaces(insertText).replace(/\s+/g, " ").trim().toLowerCase();
}

/** Strip reps / sets / N×M suffixes repeatedly so the remainder ranks as exercise text. */
function stripTrailingVolumeFromLineForExerciseQuery(lineTrimEnd: string): string {
  let s = lineTrimEnd.trimEnd();
  for (let i = 0; i < 8; i++) {
    const before = s;
    s = s.replace(/\d+\s+sets\s*$/i, "").trimEnd();
    s = s.replace(/\d+\s+reps?\s*$/i, "").trimEnd();
    s = s.replace(/\d+\s*[x×]\s*\d+\s*$/i, "").trimEnd();
    if (s === before) break;
  }
  return s.trimEnd();
}

function resolveExerciseSlugForLoadPhase(
  lineTrimEnd: string,
  lineLower: string,
  catalog: CatalogExerciseInput[],
  currentExerciseSlug: string | null | undefined,
): string | null {
  const stripped = stripTrailingVolumeFromLineForExerciseQuery(lineTrimEnd);
  if (!stripped) {
    return currentExerciseSlug ?? null;
  }

  const ranked = rankExercisesForWorkoutChatSuggest(stripped, catalog);
  if (ranked.length === 0) {
    return currentExerciseSlug ?? null;
  }

  const top = ranked[0]!;
  if (
    ranked.length >= 2 &&
    currentExerciseSlug &&
    ranked.some((r) => r.exercise.slug === currentExerciseSlug)
  ) {
    const second = ranked[1]!;
    const ratio = second.score / top.score;
    if (ratio >= EXACT_LINE_VOLUME_MAX_RUNNER_UP_RATIO) {
      return currentExerciseSlug;
    }
  }
  return top.exercise.slug;
}

function lookupEstimatedOneRmKgForSlug(
  slug: string | null,
  input: WorkoutChatSuggestInput,
): number | null {
  if (!slug) return null;
  const fromMap = input.estimatedOneRmKgBySlug?.[slug];
  if (
    typeof fromMap === "number" &&
    Number.isFinite(fromMap) &&
    fromMap > 0
  ) {
    return fromMap;
  }

  const cur = input.currentExerciseSlug ?? "";
  if (
    slug === cur &&
    typeof input.estimatedOneRmKg === "number" &&
    Number.isFinite(input.estimatedOneRmKg) &&
    input.estimatedOneRmKg > 0
  ) {
    return input.estimatedOneRmKg;
  }

  return null;
}

function labelForParsedLoadInsertion(displayWeight: number, unit: "kg" | "lb"): string {
  const v = formatLoadIncrement(displayWeight);
  const u = unit === "kg" ? "kg" : "lb";
  return `@ ${v} ${u}`;
}

function insertForParsedLoad(displayWeight: number, unit: "kg" | "lb"): string {
  const v = formatLoadIncrement(displayWeight);
  return ` @ ${v}${unit}`;
}

/**
 * Priority load chips from estimated 1RM × {@link percentageOfOneRm}(8); labels show a space before the unit,
 * inserts match existing parser style (` @ 72.5kg`).
 */
function buildOneRmEightRepDerivedLoadChipItems(
  estimatedOneRmKg: number,
  unit: "kg" | "lb",
): WorkoutChatSuggestionItem[] {
  const pctEight = percentageOfOneRm(8);
  const workingKg = estimatedOneRmKg * pctEight;
  const oneRmInDisplayUnit = oneRmKgToDisplayUnit(estimatedOneRmKg, unit);
  const fullInc = weightLoadIncrement(oneRmInDisplayUnit, unit);
  const inc = rpeChipsRoundIncrement(oneRmInDisplayUnit, unit, fullInc);

  const toDisplayFromKg = (kg: number) => oneRmKgToDisplayUnit(kg, unit);

  const roundDisplayWeight = (rawDisplay: number) => {
    if (!Number.isFinite(rawDisplay) || rawDisplay <= 0) return 0;
    return Math.max(inc, Math.round(rawDisplay / inc) * inc);
  };

  const mainRaw = toDisplayFromKg(workingKg);
  const main = roundDisplayWeight(mainRaw);
  if (main <= 0) return [];

  const minus5 = roundDisplayWeight(main * 0.95);
  const plus5 = roundDisplayWeight(main * 1.05);

  type Cand = { w: number; label: string };
  const cand: Cand[] = [
    { w: main, label: `${labelForParsedLoadInsertion(main, unit)} (8RM)` },
    { w: minus5, label: `${labelForParsedLoadInsertion(minus5, unit)} −5%` },
    { w: plus5, label: `${labelForParsedLoadInsertion(plus5, unit)} +5%` },
  ];

  const downInc = roundDisplayWeight(main - inc);
  const upInc = roundDisplayWeight(main + inc);
  if (downInc > 0 && Math.abs(downInc - minus5) >= inc * 0.25) {
    cand.push({
      w: downInc,
      label: `${labelForParsedLoadInsertion(downInc, unit)} −${formatLoadIncrement(inc)}`,
    });
  }
  if (upInc > 0 && upInc !== main && Math.abs(upInc - plus5) >= inc * 0.25) {
    cand.push({
      w: upInc,
      label: `${labelForParsedLoadInsertion(upInc, unit)} +${formatLoadIncrement(inc)}`,
    });
  }

  const out: WorkoutChatSuggestionItem[] = [];
  const seen = new Set<string>();
  const seenVals = new Set<number>();
  for (const { w, label } of cand) {
    if (w <= 0 || seenVals.has(w)) continue;
    seenVals.add(w);
    const item: WorkoutChatSuggestionItem = {
      label,
      insertText: insertForParsedLoad(w, unit),
      kind: "load",
    };
    const k = normalizeLoadChipDedupeKey(item.insertText);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= 5) break;
  }
  return out;
}

/** History order: active block snippets first, then recent chat-derived snippets (deduped). */
function collectOrderedLoadSnippetItems(
  input: WorkoutChatSuggestInput,
  maxPick: number,
): WorkoutChatSuggestionItem[] {
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
    if (out.length >= maxPick) break;
  }
  return out;
}

function catalogOrResolvedExerciseImpliesBodyweight(
  slug: string | null | undefined,
  catalog: CatalogExerciseInput[],
  lineTrimEnd: string,
): boolean {
  if (slug) {
    const fromCat = catalog.find((e) => e.slug === slug);
    const cat = fromCat?.category ?? null;
    if (
      typeof cat === "string" &&
      cat.trim().toLowerCase() === "bodyweight"
    ) {
      return true;
    }
    const full = getExerciseBySlug(slug);
    if (
      full?.category?.trim().toLowerCase() === "bodyweight"
    ) {
      return true;
    }
  }

  const lineLow = lineTrimEnd.toLowerCase();
  for (const e of catalog) {
    if (e.category?.trim().toLowerCase() !== "bodyweight") continue;
    const n = e.name.toLowerCase();
    if (minResolvedNameLen(n) && lineLow.includes(n)) return true;
    const slugSp = slugAsSpaces(e.slug).toLowerCase();
    if (slugSp.length >= 5 && lineLow.includes(slugSp)) return true;
  }

  return false;
}

/** Generic load chips — clearly not from the user's logged history when used as padding only. */
function defaultBarbellLoadChips(unit: "kg" | "lb"): WorkoutChatSuggestionItem[] {
  const ladder =
    unit === "lb"
      ? WORKOUT_CHAT_SUGGEST_DEFAULT_LOAD_LB
      : WORKOUT_CHAT_SUGGEST_DEFAULT_LOAD_KG;
  return ladder.map((w) => {
    const tail = `${w}${unit}`;
    const insertText = ` @ ${tail}`;
    return {
      label: insertText.trim(),
      insertText,
      kind: "load" as const,
    };
  });
}

function defaultBodyweightLoadChips(): WorkoutChatSuggestionItem[] {
  return [
    {
      label: "@ BW",
      insertText: " @ BW",
      kind: "load",
    },
    {
      label: "@ bodyweight",
      insertText: " @ bodyweight",
      kind: "load",
    },
  ];
}

/**
 * History-ranked load chips first, then padded with generic ladders (or BW placeholders)
 * up to {@link WORKOUT_CHAT_SUGGEST_MAX_CHIPS}. Defaults never reorder history.
 */
function mergeHistoryAndDefaultLoadChips(
  lineTrimEnd: string,
  input: WorkoutChatSuggestInput,
): WorkoutChatSuggestionItem[] {
  const history = collectOrderedLoadSnippetItems(input, 64);
  const unit = input.unitHint === "lb" ? "lb" : "kg";
  const bw = catalogOrResolvedExerciseImpliesBodyweight(
    input.currentExerciseSlug ?? null,
    input.catalogExercises,
    lineTrimEnd,
  );
  const defaults = bw ? defaultBodyweightLoadChips() : defaultBarbellLoadChips(unit);

  const seenNorm = new Set<string>();
  const out: WorkoutChatSuggestionItem[] = [];

  for (const h of history) {
    if (out.length >= WORKOUT_CHAT_SUGGEST_MAX_CHIPS) return out;
    const k = normalizeLoadChipDedupeKey(h.insertText);
    if (seenNorm.has(k)) continue;
    seenNorm.add(k);
    out.push(h);
  }

  for (const d of defaults) {
    if (out.length >= WORKOUT_CHAT_SUGGEST_MAX_CHIPS) break;
    const k = normalizeLoadChipDedupeKey(d.insertText);
    if (seenNorm.has(k)) continue;
    seenNorm.add(k);
    out.push(d);
  }

  return out;
}

function mergeHistoryDefaultAndOneRmLoadChips(
  lineTrimEnd: string,
  lineLower: string,
  input: WorkoutChatSuggestInput,
): WorkoutChatSuggestionItem[] {
  const displayUnit =
    (input.weightUnit ?? input.unitHint ?? "kg") === "lb" ? "lb" : "kg";
  const resolvedSlug = resolveExerciseSlugForLoadPhase(
    lineTrimEnd,
    lineLower,
    input.catalogExercises,
    input.currentExerciseSlug,
  );

  const slugForBw = resolvedSlug ?? input.currentExerciseSlug ?? undefined;
  const bw = catalogOrResolvedExerciseImpliesBodyweight(
    slugForBw,
    input.catalogExercises,
    lineTrimEnd,
  );

  const oneRm = lookupEstimatedOneRmKgForSlug(resolvedSlug, input);

  if (bw || oneRm == null) {
    return mergeHistoryAndDefaultLoadChips(lineTrimEnd, input);
  }

  const oneRmChips = buildOneRmEightRepDerivedLoadChipItems(oneRm, displayUnit);
  const history = collectOrderedLoadSnippetItems(input, 64);
  const unit = displayUnit;
  const defaults = defaultBarbellLoadChips(unit);

  const seenNorm = new Set<string>();
  const out: WorkoutChatSuggestionItem[] = [];

  for (const c of oneRmChips) {
    if (out.length >= WORKOUT_CHAT_SUGGEST_MAX_CHIPS) return out;
    const k = normalizeLoadChipDedupeKey(c.insertText);
    if (seenNorm.has(k)) continue;
    seenNorm.add(k);
    out.push(c);
  }
  for (const h of history) {
    if (out.length >= WORKOUT_CHAT_SUGGEST_MAX_CHIPS) return out;
    const k = normalizeLoadChipDedupeKey(h.insertText);
    if (seenNorm.has(k)) continue;
    seenNorm.add(k);
    out.push(h);
  }
  for (const d of defaults) {
    if (out.length >= WORKOUT_CHAT_SUGGEST_MAX_CHIPS) break;
    const k = normalizeLoadChipDedupeKey(d.insertText);
    if (seenNorm.has(k)) continue;
    seenNorm.add(k);
    out.push(d);
  }
  return out;
}

function unitFixChip(input: WorkoutChatSuggestInput): WorkoutChatSuggestionItem | null {
  const unit = input.unitHint === "lb" ? "lb" : "kg";
  const insert = unit === "kg" ? "kg" : " lb";
  return { label: unit === "kg" ? "kg" : "lb", insertText: insert, kind: "load" };
}

/** When chat history has no parseable volume tokens (initial volume strip), generic chips. */
const FALLBACK_VOLUME_TEMPLATES = [
  "1",
  "5",
  "8",
  "10",
  "5×5",
  "3×8",
] as const;

/**
 * After `N reps` at EOL (still no `@`/kg fragment), prioritize set counts / `M×`
 * and combos that match reps — not another strip of lone rep digits.
 */
function afterRepsWordTailPivotChips(
  repDigits: string,
  texts: string[],
): WorkoutChatSuggestionItem[] {
  const combosFromTexts = extractVolumeTemplatesFromTexts(texts, 24).filter((t) =>
    t.includes("×"),
  );
  const legacyFallbackCombos = (["5×5", "3×8"] as const).filter((t) =>
    t.includes("×"),
  );
  const comboPool =
    combosFromTexts.length > 0 ? combosFromTexts : [...legacyFallbackCombos];
  const matchingCombos = comboPool.filter((c) => c.endsWith(`×${repDigits}`));

  const historySets = extractSetPresFromTexts(texts, 12);
  const out: WorkoutChatSuggestionItem[] = [];
  const seen = new Set<string>();
  function add(item: WorkoutChatSuggestionItem) {
    const k = normalizeLoadChipDedupeKey(item.insertText);
    if (seen.has(k)) return false;
    if (out.length >= WORKOUT_CHAT_SUGGEST_MAX_CHIPS) return false;
    seen.add(k);
    out.push(item);
    return true;
  }

  const setNumsSeen = new Set<string>();
  for (const s of historySets.slice(0, 3)) {
    add({ label: `${s} sets`, insertText: `${s} sets `, kind: "set" });
    setNumsSeen.add(s);
  }
  for (const d of ["1", "3", "4", "5"] as const) {
    if (setNumsSeen.has(d)) continue;
    add({ label: `${d} sets`, insertText: `${d} sets `, kind: "set" });
    setNumsSeen.add(d);
  }

  for (const t of matchingCombos) {
    add({ label: t, insertText: `${t} `, kind: "volume" });
  }

  for (const s of historySets.slice(0, 2)) {
    add({ label: `${s}×`, insertText: `${s}× `, kind: "set" });
  }
  for (const d of ["1", "3", "5"] as const) {
    if (historySets.some((h) => h === d)) continue;
    add({ label: `${d}×`, insertText: `${d}× `, kind: "set" });
  }

  return out.slice(0, WORKOUT_CHAT_SUGGEST_MAX_CHIPS);
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

  /**
   * Complete `sets×reps` **or** `… N sets` at EOL (after reps / × volume) without a load fragment — offer load chips.
   */
  const completeNlVolumeSansLoadTail =
    !hasLoadTailFragment(lineBeforeTrimEnd) &&
    (SETS_REPS_TAIL.test(lineBeforeTrimEnd) ||
      (TRAILING_SETS_WORD.test(lineBeforeTrimEnd) &&
        (hasNumericVolumeContext(lineBeforeTrimEnd) ||
          exerciseNameResolvedInLine(
            lineBeforeTrimEnd.toLowerCase(),
            input.catalogExercises,
          ))));

  if (completeNlVolumeSansLoadTail) {
    const loads = mergeHistoryDefaultAndOneRmLoadChips(
      lineBeforeTrimEnd,
      lineBeforeTrimEnd.toLowerCase(),
      input,
    );
    if (loads.length > 0) return { phase: "load", suggestions: loads };
  }

  const repsWordMatch = TRAILING_REPS_WORD.exec(lineBeforeTrimEnd);

  if (incompleteX) {
    const reps = extractRepSecondariesFromTexts(texts, 12);
    const repOrder = reps.includes("1") ? reps : ["1", ...reps];
    const chips: WorkoutChatSuggestionItem[] = repOrder
      .slice(0, WORKOUT_CHAT_SUGGEST_MAX_CHIPS)
      .map((r) => ({
        label: labelForBareRepDigit(r),
        insertText: `${r} reps `,
        kind: "rep" as const,
      }));
    if (chips.length > 0) return { phase: "volume", suggestions: chips };
  }

  if (repsWordMatch && !SETS_REPS_TAIL.test(lineBeforeTrimEnd)) {
    const suggestions = afterRepsWordTailPivotChips(repsWordMatch[1]!, texts);
    if (suggestions.length > 0) return { phase: "volume", suggestions };
  }

  return null;
}

function volumeTemplateChips(texts: string[]): WorkoutChatSuggestionItem[] {
  const raw = extractVolumeTemplatesFromTexts(texts, 24);
  const merged = raw.length > 0 ? raw : [...FALLBACK_VOLUME_TEMPLATES];
  const reps = merged.filter((t) => /^\d+$/.test(t));
  const combos = merged.filter((t) => t.includes("×"));
  reps.sort((a, b) => Number(a) - Number(b));
  const ordered = [...reps, ...combos];
  return ordered
    .slice(0, WORKOUT_CHAT_SUGGEST_MAX_CHIPS)
    .map((t) => {
      const { label, insertText } = volumeTemplateChipLabelsForInsert(t);
      return {
        label,
        insertText,
        kind: "volume" as const,
      };
    });
}

export function workoutChatSuggest(
  input: WorkoutChatSuggestInput,
): WorkoutChatSuggestOutput {
  if (input.skipSuggestions) {
    return { ghost: null, phase: "exercise", suggestions: [] };
  }

  const caret = Math.max(0, Math.min(input.caret, input.value.length));
  const { lineBefore } = splitLineAtCaret(input.value, caret);
  const lineTrimEnd = normalizeSuggestSpaces(lineBefore).replace(/\s+$/u, "");
  const lineLower = lineTrimEnd.toLowerCase();

  const resolved = exerciseContextResolved(
    lineTrimEnd,
    input.catalogExercises,
    input.currentExerciseSlug ?? null,
  );

  const liftedOnly =
    !hasNumericVolumeContext(lineTrimEnd) &&
    !endsWithAtWeightMissingUnit(lineTrimEnd);

  const trailingSpace = /\s$/u.test(normalizeSuggestSpaces(lineBefore));

  const lv = tryLoadAndVolumePhase(lineTrimEnd, input);
  if (lv && lv.suggestions.length > 0) {
    return { ghost: null, phase: lv.phase, suggestions: lv.suggestions };
  }

  const volumeAfterResolvedExercise =
    trailingSpace ||
    exactCatalogLineQualifiesForVolume(lineTrimEnd, input.catalogExercises);

  if (
    resolved &&
    liftedOnly &&
    exerciseNameResolvedInLine(lineLower, input.catalogExercises) &&
    volumeAfterResolvedExercise
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
