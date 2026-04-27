import { getExerciseByName, searchExercises } from "@/lib/exercises";
import {
  DEFAULT_WARMUP_START_PCT,
  hasWarmupRampPhrasing,
  parseWarmupHints,
} from "@/lib/warmup-hints";
import type {
  BlockOperation,
  ChatContext,
  ChatSetSuggestion,
  Effort,
  EffortFeel,
  ExerciseRecord,
  SetDetail,
  SetUpdate,
} from "@/lib/types/workout";

const COMMON_REPS = [5, 8, 10, 12];
const COMMON_WEIGHTS = [20, 30, 40, 50];

export function parseNumbers(input: string): number[] {
  return (input.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

export function inferWeightUnit(input: string): "kg" | "lb" {
  if (/(lbs?|pounds?)\b/i.test(input)) {
    return "lb";
  }
  return "kg";
}

/**
 * Parses "set 5 is 120kg, set 6 is 100kg" style lines into one SetUpdate
 * per set. Used to override a single `update_sets` call that would wrongly
 * apply one weight to every targetSetNumbers entry.
 */
export function parsePerSetFieldUpdates(
  message: string,
  context: ChatContext | undefined,
): SetUpdate[] {
  if (!context?.sets?.length) return [];
  const maxSet = Math.max(...context.sets.map((s) => s.setNumber), 0);
  const re =
    /\bset\s*#?\s*(\d+)\s+(?:is|to|at|should\s+be)\s+(\d+(?:\.\d+)?)\s*(kg|kgs?|lb|lbs?|pounds?)?/gi;
  const bySet = new Map<number, SetUpdate>();
  for (const m of message.matchAll(re)) {
    const n = Number(m[1]);
    const w = Number(m[2]);
    if (!Number.isInteger(n) || n < 1 || n > 100) continue;
    if (!Number.isFinite(w)) continue;
    if (n > maxSet) continue;
    const unitToken = m[3]?.toLowerCase() ?? "";
    const weightUnit: "kg" | "lb" = m[3]
      ? unitToken.startsWith("lb") || unitToken.includes("pound")
        ? "lb"
        : "kg"
      : inferWeightUnit(message);
    bySet.set(n, {
      targetSetNumbers: [n],
      weight: w,
      weightUnit,
    });
  }
  return Array.from(bySet.values()).sort(
    (a, b) => a.targetSetNumbers[0]! - b.targetSetNumbers[0]!,
  );
}

/**
 * Parse an optional effort rating out of a message.
 *
 * Supported phrasings:
 *  - RPE: "rpe 8", "rpe 8.5", "@rpe 7", "@8 rpe", "rpe of 9"
 *  - RIR: "2 rir", "rir 2", "2 reps in reserve", "rir of 3"
 *  - Feel: "felt easy", "felt hard", "easy set", "hard set", "medium", "moderate"
 *
 * Only fields that are explicitly mentioned are populated — an empty object
 * is returned if none match.
 */
export function parseEffort(input: string): Effort {
  const lower = input.toLowerCase();
  const effort: Effort = {};

  const rpeMatch =
    lower.match(/\brpe\s*(?:of\s+)?(\d{1,2}(?:\.\d)?)/) ??
    lower.match(/@\s*(\d{1,2}(?:\.\d)?)\s*rpe/) ??
    lower.match(/(\d{1,2}(?:\.\d)?)\s*rpe/);
  if (rpeMatch) {
    const value = Number(rpeMatch[1]);
    if (Number.isFinite(value) && value >= 1 && value <= 10) {
      effort.rpe = value;
    }
  }

  const rirMatch =
    lower.match(/\brir\s*(?:of\s+)?(\d{1,2})/) ??
    lower.match(/(\d{1,2})\s*rir\b/) ??
    lower.match(/(\d{1,2})\s*reps?\s*in\s*reserve/);
  if (rirMatch) {
    const value = Number(rirMatch[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 20) {
      effort.rir = value;
    }
  }

  const feelMatch = lower.match(
    /\b(?:felt\s+|was\s+)?(easy|light|medium|moderate|hard|tough|brutal)\b/,
  );
  if (feelMatch) {
    const token = feelMatch[1];
    const feel: EffortFeel | null =
      token === "easy" || token === "light"
        ? "easy"
        : token === "medium" || token === "moderate"
          ? "medium"
          : token === "hard" || token === "tough" || token === "brutal"
            ? "hard"
            : null;
    if (feel) effort.feel = feel;
  }

  return effort;
}

function hasEffort(effort: Effort): boolean {
  return (
    effort.rpe !== undefined ||
    effort.rir !== undefined ||
    effort.feel !== undefined
  );
}

export function extractExerciseQuery(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "";

  const nonNumeric = trimmed.replace(
    /\d+(?:\.\d+)?\s*(kg|kgs|lb|lbs|pounds?|reps?|sets?|x|×|@|at|\/|,|\+|-)?/gi,
    " ",
  );
  const remaining = nonNumeric.replace(/[^a-z]/gi, " ").trim();
  if (remaining.length < 2) return "";

  const EXCLUDED = new Set([
    "all",
    "also",
    "were",
    "was",
    "they",
    "same",
    "again",
    "actually",
    "each",
    "set",
    "sets",
    "rep",
    "reps",
    "of",
    "at",
    "and",
  ]);
  const tokens = remaining.toLowerCase().split(/\s+/);
  if (tokens.every((token) => EXCLUDED.has(token))) return "";

  const match = message.match(
    /([a-z][a-z\s-]{2,40})(?=\s+\d|\s+set|\s+reps?|\s+kg|\s+lb|$)/i,
  );
  return match?.[1]?.trim() ?? remaining;
}

const MAX_SETS = 50;
const WEIGHT_UNIT_PATTERN = "(?:kg|kgs|lb|lbs|pounds?|k)";

/**
 * Detects "NxM" / "N×M" shorthand — ALWAYS N sets of M reps. The second
 * number must not be followed by a weight unit (so "5x100kg" is excluded
 * here and handled as sets-with-weight by the caller).
 */
function detectSetsRepsPair(
  message: string,
): { sets: number; reps: number } | null {
  const pair = message.match(
    new RegExp(`(\\d+)\\s*[x×]\\s*(\\d+)\\b(?!\\s*${WEIGHT_UNIT_PATTERN}\\b)`, "i"),
  );
  if (!pair) return null;
  const sets = Number(pair[1]);
  const reps = Number(pair[2]);
  if (sets < 1 || sets > MAX_SETS) return null;
  if (reps < 1 || reps > 100) return null;
  return { sets, reps };
}

/**
 * Detects "N sets" / "N set" / "N x <not a digit>" where only the set
 * count is supplied. Reps/weight are inherited from context or elsewhere
 * in the message.
 */
function detectSetsOnly(message: string): number | null {
  const match = message.match(/(\d+)\s*(?:x|×|sets?)\b(?!\s*\d)/i);
  if (!match) return null;
  const count = Number(match[1]);
  return count >= 1 && count <= MAX_SETS ? count : null;
}

/**
 * Detects split warmup + working set counts in one sentence, e.g.:
 * - "2 warmup sets, 3 working sets at 5 reps"
 * - "3 working sets at 5 reps, 2 warm up sets"
 * - "two warmup + three working sets"
 *
 * Returns the TOTAL set count (warmup + working) so downstream logic can
 * apply a single per-set template (reps/weight may still be null). Both
 * counts are parsed via the shared warmup-hints helper so it also
 * handles word numbers ("two", "three", …).
 */
function detectWarmupWorkingSetCount(message: string): number | null {
  const { warmupSets, workingSets } = parseWarmupHints(message);
  if (workingSets === null || workingSets < 1) return null;
  const total = warmupSets + workingSets;
  return total >= 1 && total <= MAX_SETS ? total : null;
}

type WeightProgression = {
  start: number;
  step: number;
  target: number;
  ascending: boolean;
};

/**
 * Detects "ramp up" style messages where the user describes a weight
 * progression by giving a start, step size, and a target end weight.
 * Examples that should match:
 *  - "start at 60kg and work up 20kg at a time to 115kg"
 *  - "starting at 100kg increasing by 20kg until 200kg"
 *  - "from 60 to 115 by 20"
 *  - "multiple sets increasing by 20kg until 115kg" (start inferred
 *    from the first weighted set in context)
 *  - "go down 5kg each set from 100kg to 80kg"
 *
 * Returns null when the message doesn't unambiguously specify a
 * progression (we always require AT LEAST a step + target, and a start
 * must be either present in the message or recoverable from context).
 */
function detectWeightProgression(
  message: string,
  context?: ChatContext,
): WeightProgression | null {
  const lower = message.toLowerCase();

  const stepRegexes: RegExp[] = [
    /work(?:ing)?\s+up\s+by\s+(\d+(?:\.\d+)?)/,
    /work(?:ing)?\s+up\s+(\d+(?:\.\d+)?)\s*(?:kg|lb|lbs|kgs|pounds?|k)?\s*(?:at\s+a\s+time|each(?:\s+set)?|per\s+set)/,
    /(?:going\s+up|ramping?\s+up|step(?:ping)?\s+up|adding|increasing|increase|going\s+down|ramping?\s+down|step(?:ping)?\s+down|dropping|decreasing|decrease)\s+by\s+(\d+(?:\.\d+)?)/,
    /(?:in\s+)?(?:steps?|jumps?|increments?)\s+of\s+(\d+(?:\.\d+)?)/,
    /(\d+(?:\.\d+)?)\s*(?:kg|lb|lbs|kgs|pounds?|k)?\s+(?:at\s+a\s+time|each(?:\s+set)?|per\s+set)/,
    /\bby\s+(\d+(?:\.\d+)?)\s*(?:kg|lb|lbs|kgs|pounds?|k)\b/,
  ];
  let step: number | null = null;
  for (const regex of stepRegexes) {
    const match = lower.match(regex);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) {
        step = value;
        break;
      }
    }
  }
  if (step === null) return null;

  const ascendingHint =
    /\b(work(?:ing)?\s+up|ramp(?:ing)?\s+up|going\s+up|step(?:ping)?\s+up|adding|increasing|increase)\b/.test(
      lower,
    );
  const descendingHint =
    /\b(work(?:ing)?\s+down|ramp(?:ing)?\s+down|going\s+down|step(?:ping)?\s+down|dropping|decreasing|decrease)\b/.test(
      lower,
    );

  const targetRegexes: RegExp[] = [
    /(?:up\s+to|until|ending\s+(?:at|on)|down\s+to|to\s+(?:a\s+)?max(?:imum)?(?:\s+of)?)\s*(\d+(?:\.\d+)?)/,
    /\bto\s+(\d+(?:\.\d+)?)\s*(?:kg|lb|lbs|kgs|pounds?|k)\b/,
  ];
  let target: number | null = null;
  for (const regex of targetRegexes) {
    const match = lower.match(regex);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) {
        target = value;
        break;
      }
    }
  }
  if (target === null) return null;

  let start: number | null = null;
  const startMatch =
    lower.match(/start(?:ing)?\s+(?:at|with|from|on)?\s*(\d+(?:\.\d+)?)/) ??
    lower.match(/begin(?:ning)?\s+(?:at|with|from|on)?\s*(\d+(?:\.\d+)?)/) ??
    lower.match(/from\s+(\d+(?:\.\d+)?)/);
  if (startMatch) {
    const value = Number(startMatch[1]);
    if (Number.isFinite(value) && value > 0) start = value;
  }
  if (start === null) {
    const ctxSets =
      context?.sets ?? context?.blocks?.find((b) => b.isActive)?.sets ?? [];
    const firstWeighted = ctxSets.find(
      (entry): entry is typeof entry & { weight: number } => entry.weight !== null,
    );
    if (firstWeighted) start = firstWeighted.weight;
  }
  if (start === null) return null;
  if (start === target) return null;

  const ascending = descendingHint
    ? false
    : ascendingHint
      ? true
      : start < target;

  if (ascending && start > target) return null;
  if (!ascending && start < target) return null;

  const span = Math.abs(target - start);
  if (step >= span + 0.0001) {
    // The step would overshoot in a single jump — not really a progression.
    return null;
  }

  return { start, step, target, ascending };
}

function expandProgression(
  spec: WeightProgression,
  reps: number | null,
  unit: "kg" | "lb",
): SetDetail[] {
  const sets: SetDetail[] = [];
  const direction = spec.ascending ? 1 : -1;
  const tolerance = 0.0001;
  let value = spec.start;
  while (sets.length < MAX_SETS) {
    const reachedTarget = spec.ascending
      ? value >= spec.target - tolerance
      : value <= spec.target + tolerance;
    sets.push({
      setNumber: sets.length + 1,
      reps,
      weight: Math.round(value * 100) / 100,
      weightUnit: unit,
    });
    if (reachedTarget) break;
    const next = value + direction * spec.step;
    const overshoots = spec.ascending
      ? next > spec.target
      : next < spec.target;
    value = overshoots ? spec.target : next;
  }
  // Always pin the final set to exactly the target, even if a fractional
  // step put us slightly above/below.
  if (sets.length > 0) {
    sets[sets.length - 1] = {
      ...sets[sets.length - 1]!,
      weight: spec.target,
    };
  }
  return sets;
}

export function parseSets(
  message: string,
  context?: ChatContext,
): SetDetail[] {
  const unit = inferWeightUnit(message);
  const effort = parseEffort(message);
  const applyEffort = (set: SetDetail): SetDetail =>
    hasEffort(effort) ? { ...set, ...effort } : set;

  const repsMatch = message.match(/(\d+(?:\s*\/\s*\d+)*)\s*reps?/i)?.[1];
  // Accept "100kg", "100kgs", "100k", "100lb", "100lbs", "100 pounds"
  const weightMatch = message.match(
    new RegExp(
      `(\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*\\d+(?:\\.\\d+)?)*)\\s*${WEIGHT_UNIT_PATTERN}\\b`,
      "i",
    ),
  )?.[1];

  const reps = repsMatch
    ? repsMatch.split("/").map((value) => Number(value.trim()))
    : [];
  const weights = weightMatch
    ? weightMatch.split("/").map((value) => Number(value.trim()))
    : [];

  const lastCtxSet = context?.sets?.[context.sets.length - 1];

  // "10x10" / "3x5" / "4x8 at 60kg" — NxM shorthand. N is always the set
  // count, M is always reps per set. Weight (if any) applies to every set.
  const pair = detectSetsRepsPair(message);
  if (pair) {
    const weight = weights[0] ?? lastCtxSet?.weight ?? null;
    return Array.from({ length: pair.sets }, (_value, index) =>
      applyEffort({
        setNumber: index + 1,
        reps: pair.reps,
        weight,
        weightUnit: unit,
      }),
    );
  }

  // "5 sets at 20kg" / "5 set" — set count only; fill reps from explicit
  // reps token, then context, then null.
  const warmupWorkingTotal = detectWarmupWorkingSetCount(message);
  if (warmupWorkingTotal !== null) {
    const inheritedReps = reps[0] ?? lastCtxSet?.reps ?? null;
    const weight = weights[0] ?? lastCtxSet?.weight ?? null;
    return Array.from({ length: warmupWorkingTotal }, (_value, index) =>
      applyEffort({
        setNumber: index + 1,
        reps: inheritedReps,
        weight,
        weightUnit: unit,
      }),
    );
  }

  const setsOnly = detectSetsOnly(message);
  if (setsOnly !== null) {
    const inheritedReps = reps[0] ?? lastCtxSet?.reps ?? null;
    const weight = weights[0] ?? lastCtxSet?.weight ?? null;
    return Array.from({ length: setsOnly }, (_value, index) =>
      applyEffort({
        setNumber: index + 1,
        reps: inheritedReps,
        weight,
        weightUnit: unit,
      }),
    );
  }

  // "start at 60kg, work up 20kg at a time to 115kg" — expand into a
  // weight progression. We do this BEFORE the per-set list fallback so
  // explicit numbers in the message (60, 20, 115) don't get mistaken for
  // three discrete sets.
  const progression = detectWeightProgression(message, context);
  if (progression) {
    const inheritedReps = reps[0] ?? lastCtxSet?.reps ?? null;
    return expandProgression(progression, inheritedReps, unit).map(applyEffort);
  }

  // Per-set lists ("12/10/8 reps at 20/22.5/25kg") or a single "N reps W kg".
  const values = parseNumbers(message);
  const fallbackReps =
    reps.length > 0
      ? reps
      : values.filter((value) => Number.isInteger(value) && value <= 20);
  const fallbackWeights =
    weights.length > 0 ? weights : values.filter((value) => value > 20);

  if (fallbackReps.length === 0 && fallbackWeights.length === 0) {
    // If nothing else matches but the user did tag an effort (e.g. "that was
    // RPE 8") we still want to return a single lightweight set so the value
    // can be applied downstream by the active-block merger.
    if (hasEffort(effort)) {
      return [
        applyEffort({
          setNumber: 1,
          reps: null,
          weight: null,
          weightUnit: unit,
        }),
      ];
    }
    return [];
  }

  const setCount = Math.max(fallbackReps.length, fallbackWeights.length, 1);
  return Array.from({ length: setCount }, (_value, index) =>
    applyEffort({
      setNumber: index + 1,
      reps:
        fallbackReps[index] ?? fallbackReps[fallbackReps.length - 1] ?? null,
      weight:
        fallbackWeights[index] ??
        fallbackWeights[fallbackWeights.length - 1] ??
        null,
      weightUnit: unit,
    }),
  );
}

function detectUpdates(
  message: string,
  context?: ChatContext,
): SetUpdate[] {
  const contextSets = context?.sets ?? [];
  if (contextSets.length === 0) return [];

  const lower = message.toLowerCase();
  const retroactiveMarker = /(\ball\b|\bthey\s+were\b|\bthose\s+were\b|\beach\s+(?:set|of)\b|\bactually\b)/.test(
    lower,
  );
  if (!retroactiveMarker) return [];

  const repsMatch = lower.match(/(\d+)\s*reps?/)?.[1];
  const weightMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*(kg|kgs|lb|lbs|pounds?)/,
  )?.[1];
  const effort = parseEffort(message);
  const effortProvided = hasEffort(effort);

  if (!repsMatch && !weightMatch && !effortProvided) return [];

  const targets = contextSets
    .filter((set) => {
      if (repsMatch && set.reps === null) return true;
      if (weightMatch && set.weight === null) return true;
      if (effortProvided) {
        if (effort.rpe !== undefined && set.rpe == null) return true;
        if (effort.rir !== undefined && set.rir == null) return true;
        if (effort.feel !== undefined && set.feel == null) return true;
      }
      return false;
    })
    .map((set) => set.setNumber);

  const targetSetNumbers =
    targets.length > 0
      ? targets
      : contextSets.map((set) => set.setNumber);

  const update: SetUpdate = { targetSetNumbers };
  if (repsMatch) update.reps = Number(repsMatch);
  if (weightMatch) {
    update.weight = Number(weightMatch);
    update.weightUnit = inferWeightUnit(message);
  }
  if (effort.rpe !== undefined) update.rpe = effort.rpe;
  if (effort.rir !== undefined) update.rir = effort.rir;
  if (effort.feel !== undefined) update.feel = effort.feel;

  return [update];
}

function computeFallbackAutoResolved(
  message: string,
  query: string,
  firstOption: ExerciseRecord | null,
): ExerciseRecord | null {
  const lower = message.toLowerCase();

  if (query) {
    const exact = getExerciseByName(query);
    if (exact && lower.includes(exact.name.toLowerCase())) return exact;
  }

  const firstWord = message.trim().split(/\s+/)[0]?.toLowerCase();
  if (firstWord && firstWord.length >= 3) {
    const byWord = getExerciseByName(firstWord);
    if (byWord) return byWord;
  }

  if (firstOption && lower.includes(firstOption.name.toLowerCase())) {
    return firstOption;
  }

  // "bench …" colloquially means bench press; search ranks bench-press first, but
  // the user message may not include the full phrase "bench press".
  if (
    query === "bench" &&
    firstOption?.slug === "bench-press" &&
    /\bbench\b/.test(lower) &&
    !/\bdips?\b/.test(lower)
  ) {
    return firstOption;
  }

  return null;
}

/**
 * Heuristic fallback extractor for multi-exercise turns when the LLM is
 * unavailable or uncertain. Parses comma/and-separated clauses and resolves
 * each clause against the exercise catalog.
 */
function detectExercisesFromMessage(message: string): ExerciseRecord[] {
  const lower = message.toLowerCase();
  const parts = lower
    .split(/,|\band\b|\bthen\b/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);

  const seen = new Set<string>();
  const matches: ExerciseRecord[] = [];
  for (const part of parts) {
    // Skip obvious non-exercise clauses ("i want 3 working sets ...").
    if (/\b(?:set|sets|rep|reps|warmup|warm up|working|weight|rpe|rir)\b/.test(part)) {
      continue;
    }
    const query = extractExerciseQuery(part);
    if (!query) continue;
    const candidate = searchExercises(query, 1)[0] ?? null;
    if (!candidate || seen.has(candidate.slug)) continue;
    seen.add(candidate.slug);
    matches.push(candidate);
  }

  // Single-clause fallback for short direct names ("bench press").
  if (matches.length === 0) {
    const single = searchExercises(extractExerciseQuery(lower), 1)[0] ?? null;
    if (single) matches.push(single);
  }
  return matches;
}

/**
 * "okay im gonna start at 60kg…", "let's begin with 100kg…" — phrases that
 * imply the user wants a clean restart of the current lift's set list,
 * not a continuation. Returns true when the user signalled a fresh start
 * AND the active block already has at least one logged set (otherwise
 * "starting at X" is just the first set of an empty block and there's
 * nothing to reset).
 */
export function detectResetActiveBlockSets(
  message: string,
  context?: ChatContext,
): boolean {
  const lower = message.toLowerCase();
  const startPhrase =
    /\b(?:i(?:'|\u2019)?m\s+(?:gonna|going\s+to)\s+start|i(?:'|\u2019)?ll\s+start|let(?:'|\u2019)?s\s+(?:start|begin)|gonna\s+start|going\s+to\s+start|start(?:ing)?\s+(?:at|with|from|on|over|fresh|again)|begin(?:ning)?\s+(?:at|with|from|on)|restart\s+(?:at|with|from)?)\b/.test(
      lower,
    );
  // "not right" / "that's wrong" only counts as a reset when it appears
  // alongside a fresh progression / set list (the caller has already
  // confirmed sets > 0 before invoking us).
  const correctionPhrase =
    /\b(?:not\s+right|that(?:'|\u2019)?s\s+(?:not\s+right|wrong|incorrect)|no\s+that(?:'|\u2019)?s\s+wrong|wrong|nope)\b/.test(
      lower,
    );
  if (!startPhrase && !correctionPhrase) return false;

  const blocks = context?.blocks ?? [];
  const activeBlock = blocks.find((block) => block.isActive);
  if (activeBlock && activeBlock.sets.length > 0) return true;
  if (!activeBlock && (context?.sets?.length ?? 0) > 0) return true;
  return false;
}

function extractTargetRpe(lower: string): number {
  const rpeMatch =
    lower.match(/\brpe\s*(?:of\s+)?(\d{1,2}(?:\.\d)?)/) ??
    lower.match(/@\s*(?:rpe\s*)?(\d{1,2}(?:\.\d)?)\s*rpe?/) ??
    lower.match(/at\s+(\d{1,2}(?:\.\d)?)\s*(?:\/\s*10)?\b/);
  if (rpeMatch) {
    const value = Number(rpeMatch[1]);
    if (Number.isFinite(value) && value >= 1 && value <= 10) return value;
  }
  return 8;
}

/**
 * Detects "scale the reps for me" / "fill in the reps" / "auto-fill reps
 * at rpe 7" — the user wants the agent to populate rep counts on the
 * active block's existing sets using the same RPE-calibrated algorithm
 * that powers the suggestion chips.
 *
 * Returns the target RPE when the request fires, or null when the
 * message has no scale-reps intent. Defaults to RPE 8 (2 reps in
 * reserve) — the same target the chips use.
 */
export function detectScaleActiveBlockReps(
  message: string,
  context?: ChatContext,
): { targetRpe: number } | null {
  const lower = message.toLowerCase();

  // Phrasing must mention reps (so plain "scale the weight" / "scale me"
  // doesn't trigger) AND a verb that means "auto-fill / suggest / scale".
  const phrase =
    /\b(?:scale|fill\s+in|fill|auto[\s-]?fill|set|pick|choose|calculate|figure\s+out|work\s+out|suggest|recommend|do)\s+(?:the\s+|my\s+|all\s+)?(?:rep\s*counts?|reps?|repetitions?)(?:\s+for\s+(?:me|each\s+set|all\s+(?:the\s+)?sets|every\s+set))?\b/.test(
      lower,
    ) ||
    /\b(?:reps?|rep\s*counts?)\s+(?:for\s+)?(?:each|every|all)\s+set/.test(lower) ||
    /\bscale\s+(?:the\s+)?(?:rep\s*counts?|reps?|repetitions?)\b/.test(lower);

  if (!phrase) return null;

  // Need an active block with weighted sets that are missing reps —
  // there's nothing to populate otherwise.
  const blocks = context?.blocks ?? [];
  const activeSets =
    blocks.find((block) => block.isActive)?.sets ?? context?.sets ?? [];
  const hasFillableSet = activeSets.some(
    (set) => set.weight !== null && set.weight > 0,
  );
  if (!hasFillableSet) return null;

  return { targetRpe: extractTargetRpe(lower) };
}

export type ScaleWeightsIntent = {
  targetRpe: number;
  warmupSets?: number;
  warmupStartPct?: number;
};

/**
 * Mirror of `detectScaleActiveBlockReps` for the WEIGHT axis: triggered
 * by "you choose the weight" / "suggest the weights" / "fill in the
 * weights" / "pick weights for me at rpe 7", etc. Unlike scale-reps, we
 * also look at the sets being created in the same message — so
 * `bench 5x5 you choose the weight` correctly fires alongside the new
 * 5×5 sets.
 *
 * Also fires on pure warmup phrasing like
 * `"two warm up sets building up to 3 working sets"` — in that case the
 * returned object carries `warmupSets` / `warmupStartPct` so the client
 * never has to re-parse the user's message.
 */
export function detectScaleActiveBlockWeights(
  message: string,
  context?: ChatContext,
  pendingSets?: SetDetail[],
): ScaleWeightsIntent | null {
  const lower = message.toLowerCase();

  const explicitVerbPhrase =
    /\byou\s+(?:can\s+)?(?:pick|choose|decide|select|figure\s+out|work\s+out)\s+(?:the\s+|my\s+|all\s+)?(?:weights?|loads?|kg|lb|lbs)\b/.test(
      lower,
    ) ||
    /\b(?:scale|fill\s+in|fill|auto[\s-]?fill|set|pick|choose|calculate|figure\s+out|work\s+out|suggest|recommend|do)\s+(?:the\s+|my\s+|all\s+)?(?:weights?|loads?)(?:\s+for\s+(?:me|each\s+set|all\s+(?:the\s+)?sets|every\s+set))?\b/.test(
      lower,
    ) ||
    /\b(?:weights?|loads?)\s+(?:for\s+)?(?:each|every|all)\s+set/.test(lower);

  const warmupRampPhrase = hasWarmupRampPhrasing(message);

  if (!explicitVerbPhrase && !warmupRampPhrase) return null;

  const blocks = context?.blocks ?? [];
  const activeSets =
    blocks.find((block) => block.isActive)?.sets ?? context?.sets ?? [];
  const candidateSets: { reps: number | null; weight: number | null }[] = [
    ...activeSets,
    ...(pendingSets ?? []),
  ];
  const hasFillableSet = candidateSets.some(
    (set) =>
      set.reps !== null &&
      set.reps > 0 &&
      (set.weight === null || set.weight === 0),
  );
  if (!hasFillableSet) return null;

  const hints = parseWarmupHints(message);
  const intent: ScaleWeightsIntent = {
    targetRpe: extractTargetRpe(lower),
  };
  if (hints.warmupSets > 0) {
    intent.warmupSets = hints.warmupSets;
    intent.warmupStartPct = hints.warmupStartPct ?? DEFAULT_WARMUP_START_PCT;
  }
  return intent;
}

export type ScaleRepsHint = { targetRpe: number };
export type ScaleWeightsHint = ScaleWeightsIntent;
/** @deprecated Kept for backwards compatibility with old consumers. */
export type ScaleAxisHint = ScaleRepsHint;

function mergeWeightHints(
  primary: ScaleWeightsHint | null,
  secondary: ScaleWeightsHint | null,
): ScaleWeightsHint | null {
  if (!primary && !secondary) return null;
  const base = primary ?? secondary!;
  const other = primary ? secondary : null;
  return {
    targetRpe: base.targetRpe ?? other?.targetRpe ?? 8,
    ...(base.warmupSets !== undefined
      ? { warmupSets: base.warmupSets }
      : other?.warmupSets !== undefined
        ? { warmupSets: other.warmupSets }
        : {}),
    ...(base.warmupStartPct !== undefined
      ? { warmupStartPct: base.warmupStartPct }
      : other?.warmupStartPct !== undefined
        ? { warmupStartPct: other.warmupStartPct }
        : {}),
  };
}

/**
 * Merge LLM + fallback scale hints, then let the deterministic parser
 * break ties when the model picks the wrong axis (e.g. scale-reps for
 * "suggest the weights"). Warmup params from either source are
 * preserved onto the final weight-hint.
 */
export function mergeScaleSuggestions(
  message: string,
  context: ChatContext | undefined,
  pendingSets: SetDetail[] | undefined,
  options: {
    allowRepsThisTurn: boolean;
    allowWeightsThisTurn: boolean;
    llmReps: ScaleRepsHint | null | undefined;
    llmWeights: ScaleWeightsHint | null | undefined;
    fallbackReps: ScaleRepsHint | null;
    fallbackWeights: ScaleWeightsHint | null;
  },
): {
  scaleActiveBlockReps: ScaleRepsHint | null;
  scaleActiveBlockWeights: ScaleWeightsHint | null;
} {
  const {
    allowRepsThisTurn,
    allowWeightsThisTurn,
    llmReps,
    llmWeights,
    fallbackReps,
    fallbackWeights,
  } = options;

  let scaleReps: ScaleRepsHint | null = allowRepsThisTurn
    ? llmReps
      ? { targetRpe: llmReps.targetRpe ?? 8 }
      : fallbackReps
    : null;
  let scaleWeights: ScaleWeightsHint | null = allowWeightsThisTurn
    ? mergeWeightHints(llmWeights ?? null, fallbackWeights)
    : null;

  const parserWantsWeights = detectScaleActiveBlockWeights(
    message,
    context,
    pendingSets,
  );
  const parserWantsReps = detectScaleActiveBlockReps(message, context);

  if (parserWantsWeights && !parserWantsReps) {
    if (allowRepsThisTurn) scaleReps = null;
    if (allowWeightsThisTurn) {
      scaleWeights = mergeWeightHints(scaleWeights, parserWantsWeights);
    }
  }
  if (parserWantsReps && !parserWantsWeights) {
    if (allowWeightsThisTurn) scaleWeights = null;
    if (allowRepsThisTurn) {
      scaleReps = scaleReps ?? parserWantsReps;
    }
  }

  // Whenever we end up flagging a weight-scale, enrich it with any
  // warmup hints the user typed. The parser is the sole source of
  // truth for warmup counts / start pct.
  if (scaleWeights) {
    scaleWeights = mergeWeightHints(scaleWeights, parserWantsWeights);
  }

  return { scaleActiveBlockReps: scaleReps, scaleActiveBlockWeights: scaleWeights };
}

const REMOVE_VERBS = /\b(remove|delete|scrap|cancel|drop|trash|forget)\b/i;
const REPLACE_MARKERS =
  /\b(no|sorry|actually|i\s+meant|should\s+be|change|swap|rename|replace)\b/i;

function resolveSlugFromContext(
  token: string,
  context?: ChatContext,
): string | null {
  const blocks = context?.blocks ?? [];
  const lower = token.toLowerCase();
  const exact = blocks.find(
    (block) => block.exerciseName.toLowerCase() === lower,
  );
  if (exact) return exact.exerciseSlug;
  const partial = blocks.find((block) =>
    lower.includes(block.exerciseName.toLowerCase()),
  );
  return partial?.exerciseSlug ?? null;
}

function detectBlockOperations(
  message: string,
  context: ChatContext | undefined,
): BlockOperation[] {
  const blocks = context?.blocks ?? [];
  if (blocks.length === 0) return [];

  const lower = message.toLowerCase();

  // Remove patterns.
  if (REMOVE_VERBS.test(lower)) {
    for (const block of blocks) {
      if (lower.includes(block.exerciseName.toLowerCase())) {
        return [{ kind: "remove", exerciseSlug: block.exerciseSlug }];
      }
    }
    const active = blocks.find((block) => block.isActive);
    if (active) {
      return [{ kind: "remove", exerciseSlug: active.exerciseSlug }];
    }
  }

  // Replace patterns ("no I meant X", "actually X", "change A to B").
  if (REPLACE_MARKERS.test(lower)) {
    const changeMatch = lower.match(
      /(?:change|swap|rename|replace)\s+([a-z\s-]+?)\s+(?:to|with|for)\s+([a-z\s-]+)/i,
    );
    if (changeMatch) {
      const fromSlug = resolveSlugFromContext(changeMatch[1]!, context);
      const toMatch = searchExercises(changeMatch[2]!, 1)[0] ?? null;
      if (fromSlug && toMatch) {
        return [
          { kind: "replace", fromSlug, toSlug: toMatch.slug },
        ];
      }
    }

    // "no I meant <exercise>" — target active.
    const meantMatch = message.match(
      /\bmeant\s+(?:it\s+was\s+|to\s+be\s+)?([a-z][a-z\s-]+)/i,
    );
    const alt = meantMatch?.[1]?.trim();
    if (alt) {
      const active = blocks.find((block) => block.isActive) ?? blocks[blocks.length - 1];
      const candidate = searchExercises(alt, 1)[0] ?? null;
      if (active && candidate && candidate.slug !== active.exerciseSlug) {
        return [
          {
            kind: "replace",
            fromSlug: active.exerciseSlug,
            toSlug: candidate.slug,
          },
        ];
      }
    }
  }

  return [];
}

const PURE_GREETING_MAX_LEN = 56;

/**
 * Short stand-alone pleasantries with no digits and no workout intent.
 * Used when the in-browser LLM is unavailable so the client still gets `reply`.
 */
export function isPureGreetingMessage(message: string): boolean {
  const t = message.trim();
  if (t.length === 0 || t.length > PURE_GREETING_MAX_LEN) return false;
  if (/\d/.test(t)) return false;
  if (
    /\b(kg|lb|lbs?|reps?|sets?|x|×|bench|squat|dead|press|curl|row|pull|push|rdl|fly|dip|pullup|chin|leg|hack|smith|lat|hip|glute|cable|db|dumbbell|barbell)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  const normalized = t
    .replace(/[!?.…,]+$/g, "")
    .trim()
    .toLowerCase();
  if (/^(hi|hello|hey|hiya|howdy|yo|sup|thanks|thx|cheers)$/.test(normalized)) {
    return true;
  }
  if (/^(hi|hello|hey|hiya|howdy)\s+there$/.test(normalized)) return true;
  if (/^good\s+(morning|afternoon|evening|day)$/.test(normalized)) return true;
  if (/^thank you$/.test(normalized)) return true;
  return false;
}

export function parseFallbackSuggestion(
  message: string,
  context?: ChatContext,
): ChatSetSuggestion {
  const blockOperations = detectBlockOperations(message, context);
  if (blockOperations.length > 0) {
    return {
      exerciseOptions: [],
      autoResolvedExercise: null,
      sets: [],
      updates: [],
      blockOperations,
      suggestedCommonReps: COMMON_REPS,
      suggestedCommonWeights: COMMON_WEIGHTS,
      userMessage: message,
    };
  }

  if (isPureGreetingMessage(message)) {
    return {
      exerciseOptions: [],
      autoResolvedExercise: null,
      sets: [],
      updates: [],
      blockOperations: [],
      resetActiveBlockSets: false,
      scaleActiveBlockReps: null,
      scaleActiveBlockWeights: null,
      suggestedCommonReps: COMMON_REPS,
      suggestedCommonWeights: COMMON_WEIGHTS,
      userMessage: message,
      reply:
        "Hey! When you're ready, name a lift and your sets — or use the camera on your equipment.",
    };
  }

  // "Scale the reps for me" wins outright — it's a side-channel
  // command, not a logging action. Recognise it early so a stray
  // "rpe 7" later in the same message doesn't get turned into a
  // bogus single empty set via the effort-only fallback in parseSets.
  // Suppressed when the same message ALSO contains explicit logging
  // tokens (a weight, a reps count, a NxM pair) — explicit input wins.
  const hasExplicitLogging =
    new RegExp(`\\d+(?:\\.\\d+)?\\s*${WEIGHT_UNIT_PATTERN}\\b`, "i").test(
      message,
    ) ||
    /\b\d+\s*reps?\b/i.test(message) ||
    /\b\d+\s*[x×]\s*\d+\b/i.test(message);
  const scaleActiveBlockReps = hasExplicitLogging
    ? null
    : detectScaleActiveBlockReps(message, context);
  if (scaleActiveBlockReps) {
    return {
      exerciseOptions: [],
      autoResolvedExercise: null,
      sets: [],
      updates: [],
      blockOperations: [],
      resetActiveBlockSets: false,
      scaleActiveBlockReps,
      scaleActiveBlockWeights: null,
      suggestedCommonReps: COMMON_REPS,
      suggestedCommonWeights: COMMON_WEIGHTS,
      userMessage: message,
    };
  }

  const updates = detectUpdates(message, context);

  const sets = updates.length > 0 ? [] : parseSets(message, context);
  const query = extractExerciseQuery(message);
  const exerciseOptions = query ? searchExercises(query, 5) : [];
  const explicitExercises = detectExercisesFromMessage(message);
  const autoResolvedExercise =
    explicitExercises[0] ??
    computeFallbackAutoResolved(
    message,
    query,
    exerciseOptions[0] ?? null,
    );
  const additionalExercises =
    explicitExercises.length > 1 && sets.length > 0
      ? explicitExercises.slice(1).map((exercise) => ({
          exercise,
          sets: sets.map((set, index) => ({ ...set, setNumber: index + 1 })),
        }))
      : [];

  // Only flag a reset when we actually produced sets to replace with —
  // otherwise the active block would be wiped with nothing to fill it.
  const resetActiveBlockSets =
    sets.length > 0 && detectResetActiveBlockSets(message, context);

  // Scale-weights coexists with new sets (so "bench 5x5 you choose the
  // weight" works in one message). The detector includes both the
  // active block's sets AND any sets we just parsed, so it knows
  // whether there's anything missing weight to fill in.
  const scaleActiveBlockWeights = detectScaleActiveBlockWeights(
    message,
    context,
    sets,
  );

  return {
    exerciseOptions,
    autoResolvedExercise,
    sets,
    additionalExercises,
    updates,
    blockOperations: [],
    resetActiveBlockSets,
    scaleActiveBlockReps: null,
    scaleActiveBlockWeights,
    suggestedCommonReps: COMMON_REPS,
    suggestedCommonWeights: COMMON_WEIGHTS,
    userMessage: message,
  };
}
