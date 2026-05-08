import { z } from "zod";
import {
  getExerciseBySlug,
  type ExerciseRank,
  type ExerciseRecord,
} from "@/lib/exercises";
import { weightLoadIncrement } from "@/lib/weight-increments";
import type {
  ChatContextSnapshot,
  ChatContextSnapshotBlock,
  ChatContextSet,
  ChatSetSuggestion,
  SetDetail,
  WeightUnit,
} from "@/lib/types/workout";
import { emptyChatSuggestion } from "@/lib/workout-chat/empty-suggestion";

export const MAX_WORKOUT_SET_ROWS = 20;

export type SetKindXml = "warmup" | "working" | "backoff" | "drop" | "unknown";

export type RawSetRow = {
  n?: number;
  kind: SetKindXml;
  r: number | null;
  w: number | null;
  u: WeightUnit | null;
  note?: string | null;
};

export type ParsedWorkoutXml = {
  exerciseAttr: string;
  rows: RawSetRow[];
};

const repairedSetRowSchema = z.object({
  n: z.number().int().min(1).max(MAX_WORKOUT_SET_ROWS),
  kind: z.enum(["warmup", "working", "backoff", "drop", "unknown"]),
  r: z.number().int().min(1).max(100).nullable(),
  w: z.number().min(0).max(1000).nullable(),
  u: z.enum(["kg", "lb"]).nullable(),
  note: z.string().nullable().optional(),
});

export type RepairedSetRow = z.infer<typeof repairedSetRowSchema>;

const repairedWorkoutSchema = z.object({
  exerciseSlug: z.string(),
  rows: z.array(repairedSetRowSchema).max(MAX_WORKOUT_SET_ROWS),
});

export type RepairedWorkout = z.infer<typeof repairedWorkoutSchema>;

/** Strip ```xml fences and leading / trailing noise from model output. */
export function stripMarkdownFences(raw: string): string {
  let s = raw.trim();
  const fence = /^```(?:xml)?\s*([\s\S]*?)```/im.exec(s);
  if (fence) s = fence[1]!.trim();
  return s.trim();
}

export function uniqueTruthy(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = (v ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** First `exercise="..."` on the workout root (for edit turns and allowlists). */
export function extractCurrentExerciseSlug(xml: string): string {
  const m = xml.match(/<workout\b[^>]*\bexercise="([^"]*)"/i);
  return (m?.[1] ?? "").trim();
}

/**
 * First complete `<workout>...</workout>` in model output (after stripping
 * common markdown fences). Prefer this name for new call sites.
 */
export function extractWorkoutXml(raw: string): string | null {
  const s = stripMarkdownFences(raw);
  const m = /<workout\b[^>]*>[\s\S]*?<\/workout>/i.exec(s);
  return m?.[0] ?? null;
}

/**
 * Recover a single workout document from noisy or truncated model output.
 * Appends `</workout>` when the root was opened but not closed.
 */
export function coerceModelWorkoutXmlFragment(raw: string): string | null {
  const s = stripMarkdownFences(raw);
  const closed = /<workout\b[^>]*>[\s\S]*?<\/workout>/i.exec(s);
  if (closed) return closed[0]!;

  const open = /<workout\b[^>]*>/i.exec(s);
  if (open?.index === undefined) return null;
  let frag = s.slice(open.index);
  if (!/<\/workout>/i.test(frag)) {
    frag = `${frag}\n</workout>`;
  }
  return frag;
}

/** Count `<s` set tags (coarse, for row-cap safety on previous vs model XML). */
export function countSetRowsInXml(xml: string): number {
  const m = xml.match(/<s\b/gi);
  return m?.length ?? 0;
}

/** @deprecated Use {@link extractWorkoutXml}; kept for existing imports. */
export function extractWorkoutElement(raw: string): string | null {
  return extractWorkoutXml(raw);
}

/** Deduped allowlist; caller orders hints (current exercise first). */
export function buildAllowedExerciseSlugs(orderedHints: string[]): string[] {
  return uniqueTruthy(orderedHints);
}

/** High-level hint only (prompt prep). Do not use to mutate XML in code. */
export function mightChangeExercise(message: string): boolean {
  const m = message.toLowerCase();
  return /\b(change|switch|swap|make it|replace|instead|do|start|set exercise|exercise|today|incline|decline|dumbbell|barbell|machine|cable)\b/.test(
    m,
  );
}

/** True when the message's leading lift phrase ranks a different exercise strongly. */
function namedLiftInMessageProbablyDiffersFromCurrent(
  message: string,
  currentExerciseSlug: string,
  ranks: ExerciseRank[],
): boolean {
  if (ranks.length === 0 || !currentExerciseSlug.trim()) return false;
  const top = ranks[0]!;
  if (top.exercise.slug === currentExerciseSlug) return false;

  const q = extractExerciseQueryFromMessage(message).trim();
  if (q.length < 3 || !/^[a-zA-Z]/.test(q)) return false;

  const firstTok = q.split(/\s+/)[0]!.toLowerCase();
  const stop = new Set([
    "a",
    "an",
    "the",
    "add",
    "put",
    "insert",
    "remove",
    "delete",
    "make",
    "set",
    "change",
    "do",
    "one",
    "two",
    "three",
    "four",
    "five",
    "another",
    "more",
    "warmup",
    "warm",
    "up",
    "just",
    "only",
    "last",
    "first",
    "second",
    "third",
  ]);
  if (stop.has(firstTok)) return false;

  const second = ranks[1]?.score ?? 0;
  const margin = top.score - second;
  if (top.score >= 800 && margin >= 40) return true;
  if (second > 0 && top.score >= 1.25 * second && margin >= 30) return true;
  return false;
}

/**
 * Allowed slug ordering: current XML exercise first; rank-based slugs when the
 * log is empty, the user may switch exercise, or the message likely names a
 * different lift than the active block.
 */
export function buildOrderedExerciseSlugHints(
  currentExerciseSlug: string,
  ranks: ExerciseRank[],
  hasExistingSets: boolean,
  message: string,
): string[] {
  const rankedSlugs = ranks.map((r) => r.exercise.slug).filter(Boolean);
  const ranked =
    !hasExistingSets ||
    mightChangeExercise(message) ||
    namedLiftInMessageProbablyDiffersFromCurrent(
      message,
      currentExerciseSlug,
      ranks,
    )
      ? rankedSlugs
      : [];
  return uniqueTruthy([currentExerciseSlug, ...ranked]).slice(0, 8);
}

function escapeXmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const SANITIZE_WEIGHT_RE = /^(?:\d+|\d*\.\d+)$/;

function sanitizeParseWeight(token: string | undefined): string | null {
  if (token == null || token === "") return null;
  if (!SANITIZE_WEIGHT_RE.test(token)) return null;
  const n = Number(token);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n);
}

export type SanitizeWorkoutXmlOptions = {
  allowedExerciseSlugs: string[];
  /** State before this message; used for row-cap safety. */
  previousXml?: string;
  /** When model clears root exercise, recover to this if it remains allowed. */
  preferredExerciseSlug?: string;
};

/**
 * Structural cleanup of model XML only: allowed root attr, allowed set attrs,
 * validated values. Does not interpret the user message.
 */
export function sanitizeWorkoutXml(
  rawModelOutput: string,
  opts: SanitizeWorkoutXmlOptions,
): string | null {
  const extracted = coerceModelWorkoutXmlFragment(rawModelOutput);
  if (!extracted) return null;

  const rootOpen = /<workout\b[^>]*>/i.exec(extracted)?.[0];
  if (!rootOpen) return null;

  const rootInner = /^<workout\b([^>]*)>/i.exec(rootOpen);
  const rootAttrs = parseAttributes(rootInner?.[1] ?? "");
  const rawExercise = (rootAttrs.exercise ?? "").trim();
  const allowed = new Set(opts.allowedExerciseSlugs);
  let exercise =
    rawExercise && allowed.has(rawExercise) ? rawExercise : "";
  if (
    exercise === "" &&
    opts.preferredExerciseSlug &&
    allowed.has(opts.preferredExerciseSlug)
  ) {
    exercise = opts.preferredExerciseSlug;
  }

  const allowedKinds = new Set(["warmup", "working", "backoff", "drop"]);
  const allowedUnits = new Set(["kg", "lb"]);

  type TagPiece = { index: number; attrStr: string };
  const tagPieces: TagPiece[] = [];
  for (const m of extracted.matchAll(/<s\b([^>]*)\/>/gi)) {
    tagPieces.push({ index: m.index ?? 0, attrStr: (m[1] ?? "").trim() });
  }
  for (const m of extracted.matchAll(/<s\b([^>]*)>\s*<\/s>/gi)) {
    tagPieces.push({ index: m.index ?? 0, attrStr: (m[1] ?? "").trim() });
  }
  tagPieces.sort((a, b) => a.index - b.index);

  const rows = tagPieces
    .map(({ attrStr }) => {
      const attrs = parseAttributes(attrStr);
      const kindRaw = (attrs.kind ?? "").toLowerCase().trim();
      if (!allowedKinds.has(kindRaw)) return null;

      const cleaned: Record<string, string> = { kind: kindRaw };

      if (attrs.r && /^[1-9]\d*$/.test(attrs.r)) {
        cleaned.r = String(Number(attrs.r));
      }

      const wSan = sanitizeParseWeight(attrs.w);
      if (wSan) cleaned.w = wSan;

      const uRaw = (attrs.u ?? "").toLowerCase();
      if (uRaw && allowedUnits.has(uRaw as WeightUnit)) {
        cleaned.u = uRaw;
      }

      if (attrs.n && /^[1-9]\d*$/.test(attrs.n)) {
        cleaned.n = String(Number(attrs.n));
      }

      const attrText = Object.entries(cleaned)
        .map(([key, value]) => `${key}="${escapeXmlAttr(value)}"`)
        .join(" ");

      return `  <s ${attrText}/>`;
    })
    .filter((row): row is string => Boolean(row));

  const prevCount = countSetRowsInXml(opts.previousXml ?? "");
  const maxRows = Math.max(12, prevCount + 12);
  if (rows.length > maxRows) return null;

  return [
    `<workout exercise="${escapeXmlAttr(exercise)}">`,
    ...rows,
    `</workout>`,
  ].join("\n");
}

function parseAttributes(attrString: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*"([^"]*)"|([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrString)) !== null) {
    const k = (m[1] ?? m[3])!;
    const v = (m[2] ?? m[4])!;
    out[k] = v;
  }
  return out;
}

function normalizeKind(token: string | undefined): SetKindXml {
  const k = (token ?? "working").toLowerCase().trim();
  if (k === "w" || k === "work") return "working";
  if (k === "m" || k === "wu") return "warmup";
  if (k === "b" || k === "bo") return "backoff";
  if (k === "d") return "drop";
  if (k === "warmup" || k === "working" || k === "backoff" || k === "drop")
    return k;
  if (k === "unknown") return "unknown";
  return "unknown";
}

function parseOptionalNumber(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function parseWorkoutXmlFragment(xml: string): ParsedWorkoutXml | null {
  const rootMatch = /<workout\b([^>]*)>([\s\S]*?)<\/workout>/i.exec(xml);
  if (!rootMatch) return null;
  const rootAttrs = parseAttributes(rootMatch[1] ?? "");
  const exerciseAttr = (rootAttrs.exercise ?? "").trim();
  const inner = rootMatch[2] ?? "";

  const rows: RawSetRow[] = [];
  const sTag =
    /<s\b([^/>]*)\/?>|<s\b([^>]*)><\/s>/gi;
  let m: RegExpExecArray | null;
  while ((m = sTag.exec(inner)) !== null) {
    const attrStr = (m[1] ?? m[2] ?? "").trim();
    const a = parseAttributes(attrStr);
    const kind = normalizeKind(a.kind);
    const r = parseOptionalNumber(a.r ?? a.reps);
    const w = parseOptionalNumber(a.w ?? a.weight);
    const uRaw = (a.u ?? a.unit ?? "").toLowerCase();
    const u: WeightUnit | null =
      uRaw === "kg" || uRaw === "lb" ? uRaw : null;
    rows.push({
      n: parseOptionalNumber(a.n) ?? undefined,
      kind,
      r,
      w,
      u,
      note: a.note?.trim() || null,
    });
  }

  return { exerciseAttr, rows };
}

function clampReps(r: number | null): number | null {
  if (r === null) return null;
  return Math.max(1, Math.min(100, Math.round(r)));
}

function clampWeight(w: number | null): number | null {
  if (w === null) return null;
  return Math.max(0, Math.min(1000, w));
}

/**
 * Fraction of the working set's weight for each warmup slot. Starts at 50% and
 * ramps up toward (but stays below) the working load. Single-warmup case lands
 * at 70% — a midpoint that's far enough from the working set to feel like a
 * warmup but close enough to prime the lift.
 */
function warmupRampFractions(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0.7];
  const start = 0.5;
  const end = 0.85;
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    out.push(start + (end - start) * t);
  }
  return out;
}

function fillInferWarmupLoads(rows: RepairedSetRow[]): void {
  let firstWorkingW: number | null = null;
  let firstWorkingU: WeightUnit = "kg";
  for (const row of rows) {
    if (row.kind === "working" && row.w != null) {
      firstWorkingW = row.w;
      firstWorkingU = row.u ?? "kg";
      break;
    }
  }
  if (firstWorkingW == null) return;

  // Indices of warmup rows missing a weight, in order. Skip warmups that
  // already carry an explicit weight — only fill blanks.
  const missingIndices: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (row.kind === "warmup" && row.w == null) missingIndices.push(i);
  }
  if (missingIndices.length === 0) return;

  const fractions = warmupRampFractions(missingIndices.length);
  // Working-weight increment governs rounding, matching the gym-coach
  // convention that warmups stay on whole-jump plates relative to the
  // working set rather than fine 2.5 kg micro-loads.
  const increment = weightLoadIncrement(firstWorkingW, firstWorkingU);

  let prevWeight = 0;
  for (let slot = 0; slot < missingIndices.length; slot += 1) {
    const idx = missingIndices[slot]!;
    const row = rows[idx]!;
    const fraction = fractions[slot]!;
    const target = firstWorkingW * fraction;
    let rounded = Math.round(target / increment) * increment;
    // Keep below the working set so warmups never tie or exceed it.
    if (rounded >= firstWorkingW) rounded = firstWorkingW - increment;
    // Don't go below the previous warmup once one's been set.
    if (rounded < prevWeight) rounded = prevWeight;
    rounded = Math.max(increment, Math.min(1000, rounded));
    row.w = rounded;
    prevWeight = rounded;

    const ratio = rounded / firstWorkingW;
    let reps = 5;
    if (ratio >= 0.85) reps = 1;
    else if (ratio >= 0.7) reps = 2;
    else if (ratio >= 0.55) reps = 3;
    row.r = row.r ?? reps;

    if (!row.u) row.u = firstWorkingU;
  }
}

export type RepairWorkoutRowsOptions = {
  fillMissingUnits?: boolean;
  inferWarmupLoads?: boolean;
};

/**
 * Normalises rows, renumbers, clamps, optionally fills heuristic warmup weights, caps count.
 * Does not resolve exercise slug (caller passes `exerciseSlug` after catalog check).
 */
export function repairWorkoutRows(
  rows: RawSetRow[],
  defaultUnit: WeightUnit,
  exerciseSlug: string,
  options?: RepairWorkoutRowsOptions,
): RepairedWorkout | null {
  const fillMissingUnits = options?.fillMissingUnits ?? true;
  const inferWarmupLoads = options?.inferWarmupLoads ?? true;
  const capped = rows.slice(0, MAX_WORKOUT_SET_ROWS);
  // Trust the XML/array order. Sorting by `n` here used to interleave newly
  // inserted warmups (which inherited position-based n=1,2) with existing
  // working rows that kept their original n=1..5 from the source XML.
  const repaired: RepairedSetRow[] = capped.map((raw, i) => {
    const u: WeightUnit | null = fillMissingUnits
      ? (raw.u ?? defaultUnit)
      : (raw.u ?? null);
    return {
      n: i + 1,
      kind: raw.kind === "unknown" ? "working" : raw.kind,
      r: clampReps(raw.r),
      w: clampWeight(raw.w),
      u,
      note: raw.note ?? undefined,
    };
  });

  if (inferWarmupLoads) {
    fillInferWarmupLoads(repaired);
  }

  const parsed = repairedWorkoutSchema.safeParse({
    exerciseSlug,
    rows: repaired,
  });
  return parsed.success ? parsed.data : null;
}

function contextSetsToRawRows(sets: ChatContextSet[]): RawSetRow[] {
  return sets.map((s) => ({
    n: s.setNumber,
    kind: s.isWarmup === true ? "warmup" : "working",
    r: s.reps,
    w: s.weight,
    u: s.weightUnit,
  }));
}

/** Canonical `<workout>` string after repair (order, n, warmup fill, clamps). */
export function repairedWorkoutToXml(repaired: RepairedWorkout): string {
  const lines: string[] = [
    `<workout exercise="${escapeAttr(repaired.exerciseSlug)}">`,
  ];
  for (const row of repaired.rows) {
    lines.push(
      `<s n="${row.n}" kind="${row.kind}" r="${row.r ?? ""}" w="${row.w ?? ""}" u="${row.u ?? ""}"/>`,
    );
  }
  lines.push(`</workout>`);
  return lines.join("\n");
}

/**
 * Slug of the most-recently-active block, if any. Used as a `LIKELY_EXERCISE`
 * hint passed alongside the `<workout>` XML so the LLM keeps exercise context
 * even when the active block has no sets and the XML opens as
 * `<workout exercise="">`.
 */
export function pickLikelyExerciseSlug(
  context: ChatContextSnapshot | undefined,
): string {
  const blocks = context?.blocks ?? [];
  if (blocks.length === 0) return (context?.exerciseSlug ?? "").trim();
  const active = blocks.find((b) => b.isActive);
  if (active?.exerciseSlug) return active.exerciseSlug;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const b = blocks[i]!;
    if (b.exerciseSlug) return b.exerciseSlug;
  }
  return (context?.exerciseSlug ?? "").trim();
}

/**
 * Same active block as {@link buildPreviousWorkoutXml}, but runs the same
 * repair/normalise path as model output so the LLM always sees cleaned XML.
 */
export function buildCleanPreviousWorkoutXml(
  context: ChatContextSnapshot | undefined,
  defaultUnit: WeightUnit,
): string {
  const blocks = context?.blocks ?? [];
  if (blocks.length === 0) return `<workout exercise=""></workout>`;

  const active =
    blocks.find((b) => b.isActive) ??
    [...blocks].reverse().find((b) => b.sets.length > 0) ??
    blocks[blocks.length - 1];

  if (!active) return `<workout exercise=""></workout>`;

  const rawRows = contextSetsToRawRows(active.sets);
  const repaired = repairWorkoutRows(rawRows, defaultUnit, active.exerciseSlug);
  if (!repaired) {
    return blockToWorkoutXml(active);
  }
  return repairedWorkoutToXml(repaired);
}

export function resolveExerciseSlug(params: {
  exerciseAttr: string;
  ranks: ExerciseRank[];
}): { slug: string; auto: ExerciseRecord | null; options: ExerciseRecord[] } {
  const { exerciseAttr, ranks } = params;
  const fromAttr = exerciseAttr.trim();
  if (fromAttr && getExerciseBySlug(fromAttr)) {
    return {
      slug: fromAttr,
      auto: getExerciseBySlug(fromAttr)!,
      options: [],
    };
  }

  const opts = ranks.map((r) => r.exercise);
  if (opts.length === 0) {
    return { slug: "", auto: null, options: [] };
  }

  if (opts.length === 1) {
    return { slug: opts[0]!.slug, auto: opts[0]!, options: [] };
  }

  const [a, b] = ranks;
  if (
    a!.score >= 9_000 ||
    (a!.score >= 1.3 * b!.score && a!.score - b!.score > 80)
  ) {
    return { slug: a!.exercise.slug, auto: a!.exercise, options: [] };
  }

  return { slug: "", auto: null, options: opts.slice(0, 5) };
}

export function blockToWorkoutXml(block: ChatContextSnapshotBlock): string {
  const slug = block.exerciseSlug;
  const lines: string[] = [`<workout exercise="${escapeAttr(slug)}">`];
  for (const s of block.sets) {
    const kind = inferKindFromContextSet(s);
    lines.push(
      `<s n="${s.setNumber}" kind="${kind}" r="${s.reps ?? ""}" w="${s.weight ?? ""}" u="${s.weightUnit}"/>`,
    );
  }
  lines.push(`</workout>`);
  return lines.join("\n");
}

function inferKindFromContextSet(s: ChatContextSet): SetKindXml {
  return s.isWarmup === true ? "warmup" : "working";
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function buildPreviousWorkoutXml(
  context: ChatContextSnapshot | undefined,
): string {
  const blocks = context?.blocks ?? [];
  if (blocks.length === 0) return `<workout exercise=""></workout>`;

  const active =
    blocks.find((b) => b.isActive) ?? [...blocks].reverse().find((b) => b.sets.length > 0) ?? blocks[blocks.length - 1];

  if (!active) return `<workout exercise=""></workout>`;
  return blockToWorkoutXml(active);
}

export function extractExerciseQueryFromMessage(message: string): string {
  const t = message.trim();
  const leading = t.match(/^([a-zA-Z][a-zA-Z\s\-']+?)(?=\s+\d|\s*\d|\s*$)/u);
  if (leading && leading[1]!.trim().length >= 2) return leading[1]!.trim();
  const words = t.split(/\s+/).filter(Boolean);
  return words.slice(0, Math.min(4, words.length)).join(" ");
}

/** True when `<workout>...</workout>` contains at least one `<s` set row. */
export function previousWorkoutXmlHasSets(xml: string): boolean {
  const m = /<workout\b[^>]*>([\s\S]*?)<\/workout>/i.exec(xml.trim());
  if (!m) return false;
  return /<s\b/i.test(m[1] ?? "");
}

function buildDeterministicLogNewXml(params: {
  sets: number;
  reps: number;
  weight: number | null;
  u: WeightUnit;
}): string {
  const { sets, reps, weight, u } = params;
  const lines: string[] = [`<workout exercise="">`];
  for (let i = 0; i < sets; i += 1) {
    const wAttr =
      weight != null && Number.isFinite(weight) ? ` w="${weight}"` : "";
    lines.push(`<s kind="working" r="${reps}"${wAttr} u="${u}"/>`);
  }
  lines.push(`</workout>`);
  return lines.join("\n");
}

/** Trivial `bench 5x5 100kg` or `bench 5×5` (weight optional) → XML (no WebLLM). */
export function tryDeterministicWorkoutXml(
  message: string,
  defaultUnit: WeightUnit = "kg",
): string | null {
  const t = message.trim();
  let m = t.match(
    /^(.+?)\s+(\d+)\s*[x×]\s*(\d+)\s+@\s*(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?\s*$/iu,
  );
  if (m) {
    const sets = Number(m[2]!);
    const reps = Number(m[3]!);
    const weight = Number(m[4]!);
    const u =
      (parseUnitToken(m[5]) as WeightUnit | undefined) ?? defaultUnit;
    if (!Number.isInteger(sets) || sets < 1 || sets > MAX_WORKOUT_SET_ROWS)
      return null;
    if (!Number.isInteger(reps) || reps < 1 || reps > 100) return null;
    if (!Number.isFinite(weight) || weight <= 0) return null;
    return buildDeterministicLogNewXml({ sets, reps, weight, u });
  }

  m = t.match(
    /^(.+?)\s+(\d+)\s*[x×]\s*(\d+)(?:\s+(\d+(?:\.\d+)?)\s*(kg|lb)?)?\s*$/iu,
  );
  if (m) {
    const sets = Number(m[2]!);
    const reps = Number(m[3]!);
    const weightRaw = m[4];
    const weight =
      weightRaw !== undefined && weightRaw !== "" ? Number(weightRaw) : null;
    const u = (m[5]?.toLowerCase() as WeightUnit | undefined) ?? defaultUnit;
    if (!Number.isInteger(sets) || sets < 1 || sets > MAX_WORKOUT_SET_ROWS)
      return null;
    if (!Number.isInteger(reps) || reps < 1 || reps > 100) return null;
    if (weight != null && (!Number.isFinite(weight) || weight < 0)) return null;
    return buildDeterministicLogNewXml({ sets, reps, weight, u });
  }

  // "bench 5 reps 3 sets @ 72.5kg" / "bench 5 reps 3 sets 72.5 kg"
  let mw = t.match(
    /^(.+?)\s+(\d+)\s*reps?\s+(\d+)\s*sets?\s+(?:@\s*)?(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?\s*$/iu,
  );
  if (mw) {
    const reps = Number(mw[2]!);
    const sets = Number(mw[3]!);
    const weight = Number(mw[4]!);
    const u =
      (parseUnitToken(mw[5]) as WeightUnit | undefined) ?? defaultUnit;
    if (!Number.isInteger(sets) || sets < 1 || sets > MAX_WORKOUT_SET_ROWS)
      return null;
    if (!Number.isInteger(reps) || reps < 1 || reps > 100) return null;
    if (!Number.isFinite(weight) || weight <= 0) return null;
    return buildDeterministicLogNewXml({ sets, reps, weight, u });
  }

  // "bench 3 sets 5 reps @ 72.5kg"
  mw = t.match(
    /^(.+?)\s+(\d+)\s*sets?\s+(\d+)\s*reps?\s+(?:@\s*)?(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?\s*$/iu,
  );
  if (mw) {
    const sets = Number(mw[2]!);
    const reps = Number(mw[3]!);
    const weight = Number(mw[4]!);
    const u =
      (parseUnitToken(mw[5]) as WeightUnit | undefined) ?? defaultUnit;
    if (!Number.isInteger(sets) || sets < 1 || sets > MAX_WORKOUT_SET_ROWS)
      return null;
    if (!Number.isInteger(reps) || reps < 1 || reps > 100) return null;
    if (!Number.isFinite(weight) || weight <= 0) return null;
    return buildDeterministicLogNewXml({ sets, reps, weight, u });
  }

  // "bench press 5 sets of 5" / "bench 3 sets of 12 @ 80kg" (weight optional; "reps" optional)
  mw = t.match(
    /^(.+?)\s+(\d+)\s*sets?\s+of\s+(\d+)(?:\s*reps?)?(?:\s+(?:@\s*)?(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?)?\s*$/iu,
  );
  if (mw) {
    const sets = Number(mw[2]!);
    const reps = Number(mw[3]!);
    const weightRaw = mw[4];
    const weight =
      weightRaw !== undefined && weightRaw !== "" ? Number(weightRaw) : null;
    const u = (parseUnitToken(mw[5]) as WeightUnit | undefined) ?? defaultUnit;
    if (!Number.isInteger(sets) || sets < 1 || sets > MAX_WORKOUT_SET_ROWS)
      return null;
    if (!Number.isInteger(reps) || reps < 1 || reps > 100) return null;
    if (weight != null && (!Number.isFinite(weight) || weight < 0)) return null;
    return buildDeterministicLogNewXml({ sets, reps, weight, u });
  }

  return null;
}

function parseUnitToken(token: string | undefined): WeightUnit | undefined {
  if (!token) return undefined;
  const x = token.toLowerCase();
  if (x === "kg" || x === "kgs") return "kg";
  if (x === "lb" || x === "lbs") return "lb";
  return undefined;
}

function repairedRowsToSetDetails(rows: RepairedSetRow[]): SetDetail[] {
  return rows.map((row) => ({
    setNumber: row.n,
    reps: row.r,
    weight: row.w,
    weightUnit: row.u,
    isWarmup: row.kind === "warmup",
  }));
}

export function workoutXmlToSuggestion(params: {
  rawModelOutput: string;
  userMessage: string;
  ranks: ExerciseRank[];
  defaultUnit: WeightUnit;
  /**
   * When true (default), fill missing units and infer warmup loads — e.g. cleaned context XML.
   * When false, keep partial rows from pre-sanitized LLM output.
   */
  fullRepair?: boolean;
}): ChatSetSuggestion {
  const { rawModelOutput, userMessage, ranks, defaultUnit } = params;
  const fullRepair = params.fullRepair ?? true;
  const repairOpts: RepairWorkoutRowsOptions = fullRepair
    ? { fillMissingUnits: true, inferWarmupLoads: true }
    : { fillMissingUnits: false, inferWarmupLoads: false };

  const frag = extractWorkoutXml(rawModelOutput);
  if (!frag) {
    return emptyChatSuggestion(
      userMessage,
      "I could not read a valid <workout> from the model. Try rephrasing your sets.",
    );
  }

  const parsed = parseWorkoutXmlFragment(frag);
  if (!parsed) {
    return emptyChatSuggestion(userMessage, "Workout XML could not be parsed.");
  }

  /** Repair rows using top candidate slug so prescription survives exercise disambiguation. */
  const slugForRepair = ranks[0]?.exercise.slug ?? "";
  const repairedPreview = repairWorkoutRows(
    parsed.rows,
    defaultUnit,
    slugForRepair,
    repairOpts,
  );
  const setsFromXml =
    repairedPreview && repairedPreview.rows.length > 0
      ? repairedRowsToSetDetails(repairedPreview.rows)
      : [];

  const resolved = resolveExerciseSlug({
    exerciseAttr: parsed.exerciseAttr,
    ranks,
  });

  if (resolved.options.length > 0 && !resolved.auto) {
    const base = emptyChatSuggestion(
      userMessage,
      setsFromXml.length > 0 ? null : "Which lift did you mean?",
    );
    return {
      ...base,
      exerciseOptions: resolved.options,
      sets: setsFromXml,
      resetActiveBlockSets: setsFromXml.length > 0,
    };
  }

  const slug =
    resolved.slug || resolved.auto?.slug || "";
  if (!slug || !getExerciseBySlug(slug)) {
    const base = emptyChatSuggestion(
      userMessage,
      ranks.length > 0
        ? setsFromXml.length > 0
          ? null
          : "Which lift did you mean?"
        : setsFromXml.length > 0
          ? null
          : "Name your lift (e.g. bench 5x5 100kg).",
    );
    return {
      ...base,
      exerciseOptions: ranks.slice(0, 5).map((r) => r.exercise),
      sets: setsFromXml,
      resetActiveBlockSets: setsFromXml.length > 0,
    };
  }

  const repaired = repairWorkoutRows(
    parsed.rows,
    defaultUnit,
    slug,
    repairOpts,
  );
  if (!repaired || repaired.rows.length === 0) {
    return emptyChatSuggestion(
      userMessage,
      "I parsed your workout but found no valid sets.",
    );
  }

  const exercise = getExerciseBySlug(slug)!;
  const sets = repairedRowsToSetDetails(repaired.rows);

  return {
    exerciseOptions: [],
    autoResolvedExercise: exercise,
    sets,
    additionalExercises: [],
    updates: [],
    blockOperations: [],
    resetActiveBlockSets: true,
    scaleActiveBlockReps: null,
    scaleActiveBlockWeights: null,
    suggestedCommonReps: [5, 8, 10, 12],
    suggestedCommonWeights: [20, 30, 40, 50],
    userMessage,
    reply: null,
    exerciseHelp: null,
  };
}

export function isGreetingOrChatOnly(message: string): boolean {
  const t = message.trim().toLowerCase();
  if (t.length === 0) return true;
  if (t.length > 80) return false;
  return (
    /^(hi|hello|hey|thanks|thank you|ok|okay|cool)\b/u.test(t) &&
    !/\d/.test(t)
  );
}
