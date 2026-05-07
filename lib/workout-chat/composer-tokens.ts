import { EXERCISES } from "@/lib/exercises";

export type ComposerTokenKind =
  | "weight"
  | "bodyweight"
  | "setsReps"
  | "repsWord"
  | "setsWord"
  | "exercise";

export type ComposerTokenSpan = {
  start: number;
  end: number;
  kind: ComposerTokenKind;
};

export type ComposerDecorSegment =
  | { kind: "plain"; text: string }
  | { kind: "token"; text: string; token: ComposerTokenKind };

const WEIGHT_RE = /^@?\s*\d+(?:\.\d+)?\s*(?:kg|lb)/i;
/** Matches suggest chips: `@ BW`, `@ bodyweight` (insertText in suggest.ts). Requires `@`. */
const BODYWEIGHT_RE = /^@\s*(?:bw|bodyweight)\b/i;
const SETS_REPS_RE = /^\d+\s*[×x\u00D7]\s*\d+/i;
const REPS_WORD_RE = /^\d+\s+reps\b/i;
const SETS_WORD_RE = /^\d+\s+sets\b/i;

let cachedExercisePhrases: string[] | null = null;

/** Display names and slug phrases (hyphens → spaces), longest first, deduped. */
export function getComposerExercisePhrases(): string[] {
  if (cachedExercisePhrases) return cachedExercisePhrases;
  const seen = new Set<string>();
  const list: string[] = [];
  for (const e of EXERCISES) {
    const name = e.name.trim();
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      list.push(name);
    }
    const slugWords = e.slug.replace(/-/g, " ").trim();
    if (slugWords && !seen.has(slugWords.toLowerCase())) {
      seen.add(slugWords.toLowerCase());
      list.push(slugWords);
    }
  }
  list.sort((a, b) => b.length - a.length);
  cachedExercisePhrases = list;
  return cachedExercisePhrases;
}

function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[\p{L}\p{N}]/u.test(ch);
}

function wordBoundaryBefore(line: string, i: number): boolean {
  return i === 0 || !isWordChar(line[i - 1]);
}

function wordBoundaryAfter(line: string, end: number): boolean {
  return end >= line.length || !isWordChar(line[end]);
}

function regexMatchLen(re: RegExp, slice: string): number {
  const m = re.exec(slice);
  return m?.[0]?.length ?? 0;
}

function bestExerciseEnd(
  line: string,
  i: number,
  phrases: readonly string[],
): number {
  const slice = line.slice(i);
  if (!slice.length) return i;
  const first = slice[0]?.toLowerCase() ?? "";
  let best = i;
  for (const phrase of phrases) {
    if (!phrase.length) continue;
    if (phrase[0].toLowerCase() !== first) continue;
    const L = phrase.length;
    if (slice.length < L) continue;
    if (slice.slice(0, L).toLowerCase() !== phrase.toLowerCase()) continue;
    if (!wordBoundaryBefore(line, i)) continue;
    if (!wordBoundaryAfter(line, i + L)) continue;
    const end = i + L;
    if (end > best) best = end;
  }
  return best;
}

/**
 * Left-to-right greedy tokenization: at each index, take the longest span among
 * weight, bodyweight (@ BW / @ bodyweight), sets×reps, reps/sets words,
 * and catalog exercises (if phrases provided).
 */
export function findComposerTokenSpans(
  line: string,
  options?: { exercisePhrases?: readonly string[] },
): ComposerTokenSpan[] {
  const phrases = options?.exercisePhrases ?? getComposerExercisePhrases();
  const spans: ComposerTokenSpan[] = [];
  let i = 0;
  const n = line.length;

  while (i < n) {
    const slice = line.slice(i);
    let bestEnd = i;
    let bestKind: ComposerTokenKind | null = null;

    const wLen = regexMatchLen(WEIGHT_RE, slice);
    if (wLen > 0 && i + wLen > bestEnd) {
      bestEnd = i + wLen;
      bestKind = "weight";
    }

    const bwLen = regexMatchLen(BODYWEIGHT_RE, slice);
    if (
      bwLen > 0 &&
      wordBoundaryBefore(line, i) &&
      i + bwLen > bestEnd
    ) {
      bestEnd = i + bwLen;
      bestKind = "bodyweight";
    }

    const srLen = regexMatchLen(SETS_REPS_RE, slice);
    if (srLen > 0 && i + srLen > bestEnd) {
      bestEnd = i + srLen;
      bestKind = "setsReps";
    }

    const rLen = regexMatchLen(REPS_WORD_RE, slice);
    if (rLen > 0 && i + rLen > bestEnd) {
      bestEnd = i + rLen;
      bestKind = "repsWord";
    }

    const sLen = regexMatchLen(SETS_WORD_RE, slice);
    if (sLen > 0 && i + sLen > bestEnd) {
      bestEnd = i + sLen;
      bestKind = "setsWord";
    }

    const exEnd = bestExerciseEnd(line, i, phrases);
    if (exEnd > bestEnd) {
      bestEnd = exEnd;
      bestKind = "exercise";
    }

    if (bestKind && bestEnd > i) {
      spans.push({ start: i, end: bestEnd, kind: bestKind });
      i = bestEnd;
    } else {
      i += 1;
    }
  }

  return spans;
}

export function segmentComposerLine(
  line: string,
  options?: { exercisePhrases?: readonly string[] },
): ComposerDecorSegment[] {
  const spans = findComposerTokenSpans(line, options);
  if (spans.length === 0) {
    return line.length ? [{ kind: "plain", text: line }] : [];
  }
  const out: ComposerDecorSegment[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (cursor < s.start) {
      out.push({ kind: "plain", text: line.slice(cursor, s.start) });
    }
    out.push({
      kind: "token",
      text: line.slice(s.start, s.end),
      token: s.kind,
    });
    cursor = s.end;
  }
  if (cursor < line.length) {
    out.push({ kind: "plain", text: line.slice(cursor) });
  }
  return out;
}
