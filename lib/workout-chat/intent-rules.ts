import {
  rankExercisesForQuery,
  getExerciseBySlug,
} from "@/lib/exercises";
import type { WeightUnit } from "@/lib/types/workout";
import {
  parseWorkoutXmlFragment,
  tryDeterministicWorkoutXml,
  type RawSetRow,
} from "@/lib/workout-chat/workout-xml";

/**
 * Result of the deterministic intent layer.
 *
 * - `kind: "edit"` returns an `<edit>...</edit>` to feed into `applyWorkoutEditXml`.
 * - `kind: "workout"` returns a fresh `<workout>...</workout>` to feed straight
 *   into `workoutXmlToSuggestion`.
 */
export type DeterministicTurnResult =
  | { kind: "edit"; editXml: string; ruleId: string }
  | { kind: "workout"; workoutXml: string; ruleId: string };

export type DeterministicTurnInput = {
  message: string;
  previousXml: string;
  hasActiveBlock: boolean;
  currentExerciseSlug: string;
  defaultUnit: WeightUnit;
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  another: 1,
  a: 1,
  an: 1,
};

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

function parseUnit(token: string | undefined | null): WeightUnit | null {
  if (!token) return null;
  const t = token.toLowerCase();
  if (t === "kg" || t === "kgs" || t === "kilo" || t === "kilos") return "kg";
  if (t === "lb" || t === "lbs" || t === "pound" || t === "pounds") return "lb";
  return null;
}

function lastWorkingRow(rows: RawSetRow[]): RawSetRow | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i]!.kind === "working") return rows[i]!;
  }
  return null;
}

function lastSetRow(rows: RawSetRow[]): RawSetRow | null {
  return rows.length > 0 ? rows[rows.length - 1]! : null;
}

function rowsFromPrev(previousXml: string): RawSetRow[] {
  return parseWorkoutXmlFragment(previousXml)?.rows ?? [];
}

function hasNumber(message: string): boolean {
  return /\d/.test(message);
}

function buildEditXmlInsertWorking(
  reps: number,
  weight: number | null,
  unit: WeightUnit,
  count = 1,
): string {
  const parts = [`kind="working"`, `r="${reps}"`];
  if (weight != null) parts.push(`w="${weight}"`);
  parts.push(`u="${unit}"`);
  return `<edit>
  <insert position="end" count="${count}">
    <s ${parts.join(" ")}/>
  </insert>
</edit>`;
}

function buildEditXmlAddWarmups(count: number): string {
  return `<edit>
  <insert position="before-first-working" count="${count}">
    <s kind="warmup"/>
  </insert>
</edit>`;
}

function buildEditXmlUpdateLastWeight(weight: number, unit: WeightUnit): string {
  return `<edit>
  <update target="last-set" w="${weight}" u="${unit}"/>
</edit>`;
}

function buildEditXmlUpdateReps(target: string, reps: number): string {
  return `<edit>
  <update target="${target}" r="${reps}"/>
</edit>`;
}

function buildEditXmlDelete(target: string): string {
  return `<edit>
  <delete target="${target}"/>
</edit>`;
}

function buildEditXmlSetExercise(slug: string): string {
  return `<edit>
  <set-exercise slug="${slug}"/>
</edit>`;
}

/** "100kg x 5", "5 @ 100", "5 reps at 100kg", "100 x 5", "5 x 100" — single set on active block. */
function tryParseSingleSetReps(
  message: string,
  defaultUnit: WeightUnit,
  fallbackUnit: WeightUnit | null,
): { reps: number; weight: number | null; unit: WeightUnit } | null {
  const t = message.trim().toLowerCase();
  // "5 reps at 100kg" / "5 reps 100" / "5 reps @ 100kg"
  let m = t.match(
    /^(\d+)\s*reps?\s*(?:at|@)?\s*(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?$/iu,
  );
  if (m) {
    const reps = Number(m[1]);
    const weight = Number(m[2]);
    const unit = parseUnit(m[3]) ?? fallbackUnit ?? defaultUnit;
    if (reps >= 1 && reps <= 100 && weight > 0) return { reps, weight, unit };
  }
  // "5 @ 100kg" / "5 @ 100"
  m = t.match(/^(\d+)\s*@\s*(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?$/iu);
  if (m) {
    const reps = Number(m[1]);
    const weight = Number(m[2]);
    const unit = parseUnit(m[3]) ?? fallbackUnit ?? defaultUnit;
    if (reps >= 1 && reps <= 100 && weight > 0) return { reps, weight, unit };
  }
  // "100kg x 5" / "100 x 5" / "100kg for 5"
  m = t.match(
    /^(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?\s*(?:x|×|for)\s*(\d+)\s*(?:reps?)?$/iu,
  );
  if (m) {
    const weight = Number(m[1]);
    const reps = Number(m[3]);
    const unit = parseUnit(m[2]) ?? fallbackUnit ?? defaultUnit;
    // Disambiguate "5 x 100" vs "100 x 5": when the first token has no unit
    // and is a clean integer ≤ 30 *and* the second token is > 30, treat the
    // first as reps and second as weight.
    const firstIsInt = !m[1]!.includes(".");
    const noUnit = !m[2];
    if (firstIsInt && noUnit && weight <= 30 && reps > 30) {
      return { reps: weight, weight: reps, unit };
    }
    if (reps >= 1 && reps <= 100 && weight > 0) return { reps, weight, unit };
  }
  // "5x100" / "5x100kg"
  m = t.match(/^(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?$/iu);
  if (m) {
    const reps = Number(m[1]);
    const weight = Number(m[2]);
    const unit = parseUnit(m[3]) ?? fallbackUnit ?? defaultUnit;
    if (reps >= 1 && reps <= 30 && weight > 0) return { reps, weight, unit };
  }
  return null;
}

/** "one more", "another set", "two more sets", "1 more @ 105". */
function tryParseAppendMore(
  message: string,
): {
  count: number;
  overrideWeight: number | null;
  overrideUnit: WeightUnit | null;
} | null {
  const t = message.trim().toLowerCase();
  // "one more @ 105" / "another set at 105kg"
  const withWeight = t.match(
    /^(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten|another|a|an)\s+)?(?:more|another)(?:\s+sets?)?(?:\s*(?:at|@)\s*(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?)?$/iu,
  );
  if (withWeight) {
    const numTok = withWeight[1];
    let count = 1;
    if (numTok) {
      const asNum = Number(numTok);
      if (Number.isInteger(asNum) && asNum >= 1) count = asNum;
      else if (NUMBER_WORDS[numTok] !== undefined) count = NUMBER_WORDS[numTok]!;
    }
    if (count < 1 || count > 10) return null;
    const overrideWeight = withWeight[2] ? Number(withWeight[2]) : null;
    const overrideUnit = parseUnit(withWeight[3]);
    return { count, overrideWeight, overrideUnit };
  }
  // "do one more set", "one more set"
  const bare = t.match(
    /^(?:do\s+|i\s+did\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|another|a|an)\s+more\s+sets?$/iu,
  );
  if (bare) {
    const numTok = bare[1]!;
    const asNum = Number(numTok);
    let count = 1;
    if (Number.isInteger(asNum) && asNum >= 1) count = asNum;
    else if (NUMBER_WORDS[numTok.toLowerCase()] !== undefined) count = NUMBER_WORDS[numTok.toLowerCase()]!;
    if (count < 1 || count > 10) return null;
    return { count, overrideWeight: null, overrideUnit: null };
  }
  return null;
}

/** "actually 102.5", "make that 105", "should be 95kg" — weight-only correction. */
function tryParseWeightOnlyCorrection(
  message: string,
  defaultUnit: WeightUnit,
  fallbackUnit: WeightUnit | null,
): { weight: number; unit: WeightUnit } | null {
  const t = message.trim().toLowerCase();
  // Reject if the message contains rep words; that'd be an edit involving reps.
  if (/\breps?\b/.test(t)) return null;
  // Reject set-count phrasing — handled by tryParseSetCountTrimRequest.
  if (/\bsets?\b/.test(t) && !/last\s+set/.test(t)) return null;

  const patterns = [
    /^actually\s+(?:it\s+(?:was|is)\s+)?(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?$/iu,
    /^(?:make|set|change|put)\s+(?:that|it|the\s+last(?:\s+set)?)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?$/iu,
    /^(?:should|that\s+should)\s+be\s+(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?$/iu,
    /^(?:that\s+was|it\s+was)\s+(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)?$/iu,
    /^(\d+(?:\.\d+)?)\s*(kg|lb|kgs|lbs)\s+(?:not|instead\s+of)\s+\d+(?:\.\d+)?\s*(?:kg|lb|kgs|lbs)?$/iu,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const weight = Number(m[1]);
    const unit = parseUnit(m[2]) ?? fallbackUnit ?? defaultUnit;
    if (weight > 0 && weight <= 1000) return { weight, unit };
  }
  return null;
}

/** "make the last set 8", "last set 6 reps", "second set 6 reps", "first set 10". */
function tryParseRepsOnlyUpdate(
  message: string,
): { target: string; reps: number } | null {
  const t = message.trim().toLowerCase();
  // "make the last set 8 reps" / "last set 8 reps" / "make last set 8"
  let m = t.match(
    /^(?:make|change|set)?\s*(?:the\s+)?last\s+set\s+(?:to\s+)?(\d+)\s*(?:reps?)?$/iu,
  );
  if (m) {
    const reps = Number(m[1]);
    if (reps >= 1 && reps <= 100) return { target: "last-set", reps };
  }
  // "first set 10 reps"
  m = t.match(
    /^(?:make|change|set)?\s*(?:the\s+)?first\s+set\s+(?:to\s+)?(\d+)\s*(?:reps?)?$/iu,
  );
  if (m) {
    const reps = Number(m[1]);
    if (reps >= 1 && reps <= 100) return { target: "first-set", reps };
  }
  // "second set 6 reps", "set 2 6 reps", "set 2 to 6"
  m = t.match(
    /^(?:make|change|set)?\s*(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+set\s+(?:to\s+)?(\d+)\s*(?:reps?)?$/iu,
  );
  if (m) {
    const ord = ORDINAL_WORDS[m[1]!.toLowerCase()];
    const reps = Number(m[2]);
    if (ord && reps >= 1 && reps <= 100) {
      return { target: `set:${ord}`, reps };
    }
  }
  m = t.match(/^set\s+(\d+)\s+(?:to\s+)?(\d+)\s*reps?$/iu);
  if (m) {
    const setN = Number(m[1]);
    const reps = Number(m[2]);
    if (setN >= 1 && setN <= 20 && reps >= 1 && reps <= 100) {
      return { target: `set:${setN}`, reps };
    }
  }
  return null;
}

/** "remove the last set", "delete set 2", "scrap the last one". */
function tryParseDelete(message: string): { target: string } | null {
  const t = message.trim().toLowerCase();
  if (/^(?:remove|delete|drop|scrap|undo)\s+(?:the\s+)?last(?:\s+(?:set|one))?$/.test(t)) {
    return { target: "last-set" };
  }
  if (/^(?:remove|delete|drop|scrap)\s+(?:the\s+)?first(?:\s+set)?$/.test(t)) {
    return { target: "first-set" };
  }
  let m = t.match(
    /^(?:remove|delete|drop|scrap)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+set$/iu,
  );
  if (m) {
    const ord = ORDINAL_WORDS[m[1]!.toLowerCase()];
    if (ord) return { target: `set:${ord}` };
  }
  m = t.match(/^(?:remove|delete|drop|scrap)\s+set\s+(\d+)$/iu);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 20) return { target: `set:${n}` };
  }
  return null;
}

/**
 * "2 warmups", "add a warmup", "add 2 warmup sets", "add 2 warmup set",
 * "two warm-ups", "warmup set", "warm up set".
 */
function tryParseAddWarmups(message: string): { count: number } | null {
  const t = message.trim().toLowerCase();
  // Optional leading verb, optional count word, "warmup"/"warm-up"/"warm up",
  // optional trailing "set"/"sets". Handles "warmup" as either noun or
  // adjective for "set(s)".
  const m = t.match(
    /^(?:add\s+|put\s+in\s+|insert\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)?\s*warm[-\s]?up(?:s)?(?:\s+sets?)?$/iu,
  );
  if (!m) return null;
  const tok = (m[1] ?? "").toLowerCase();
  let count = 1; // default when no count word is present (e.g. "add warmup")
  if (tok) {
    const asNum = Number(tok);
    if (Number.isInteger(asNum) && asNum >= 1) count = asNum;
    else if (NUMBER_WORDS[tok] !== undefined) count = NUMBER_WORDS[tok]!;
    else return null;
  }
  if (count < 1 || count > 10) return null;
  return { count };
}

/** "switch to incline dumbbell press", "swap to dumbbells", "change to ohp". */
function tryParseSwitchExercise(message: string): { phrase: string } | null {
  const t = message.trim();
  const m = t.match(
    /^(?:switch|swap|change|set\s+exercise|set\s+lift)\s+(?:to|over\s+to)\s+(.+?)\s*$/iu,
  );
  if (!m) return null;
  const phrase = m[1]!.trim();
  if (phrase.length < 2) return null;
  return { phrase };
}

function resolveExerciseFromPhrase(phrase: string): {
  slug: string;
  margin: number;
} | null {
  const ranks = rankExercisesForQuery(phrase, 3);
  if (ranks.length === 0) return null;
  const top = ranks[0]!;
  const second = ranks[1]?.score ?? 0;
  const margin = top.score - second;
  // High-confidence gate: exact match, or ≥2× over rank 2, or absolute lead.
  if (top.score >= 9_000) return { slug: top.exercise.slug, margin };
  if (top.score > 0 && top.score >= 2 * second && margin >= 100) {
    return { slug: top.exercise.slug, margin };
  }
  return null;
}

/**
 * Try to map a user message to an unambiguous workout edit / log without
 * touching the LLM. Order matters: most-specific patterns first.
 */
export function tryDeterministicChatTurn(
  input: DeterministicTurnInput,
): DeterministicTurnResult | null {
  const { message, previousXml, hasActiveBlock, defaultUnit } = input;
  const trimmed = message.trim();
  if (trimmed.length === 0) return null;

  const prevRows = rowsFromPrev(previousXml);
  const lastWorking = lastWorkingRow(prevRows);
  const lastAny = lastSetRow(prevRows);
  const fallbackUnit: WeightUnit | null =
    (lastWorking?.u ?? lastAny?.u) ?? null;

  // 1) Lift + sets×reps + optional weight ("bench 5x5 100kg")
  const detWorkout = tryDeterministicWorkoutXml(trimmed, defaultUnit);
  if (detWorkout) {
    return { kind: "workout", workoutXml: detWorkout, ruleId: "log-new" };
  }

  // 2) Add warmups ("2 warmups", "add a warmup")
  const addWu = tryParseAddWarmups(trimmed);
  if (addWu) {
    return {
      kind: "edit",
      editXml: buildEditXmlAddWarmups(addWu.count),
      ruleId: "add-warmups",
    };
  }

  // 3) Delete ("remove the last set", "delete set 2")
  const del = tryParseDelete(trimmed);
  if (del) {
    return {
      kind: "edit",
      editXml: buildEditXmlDelete(del.target),
      ruleId: "delete",
    };
  }

  // 4) Reps-only update ("make the last set 8", "second set 6 reps")
  const repsUpd = tryParseRepsOnlyUpdate(trimmed);
  if (repsUpd) {
    return {
      kind: "edit",
      editXml: buildEditXmlUpdateReps(repsUpd.target, repsUpd.reps),
      ruleId: "reps-update",
    };
  }

  // 5) Weight-only correction ("actually 105", "make that 102.5")
  const weightUpd = tryParseWeightOnlyCorrection(
    trimmed,
    defaultUnit,
    fallbackUnit,
  );
  if (weightUpd && hasActiveBlock && lastAny) {
    return {
      kind: "edit",
      editXml: buildEditXmlUpdateLastWeight(weightUpd.weight, weightUpd.unit),
      ruleId: "weight-update",
    };
  }

  // 6) Append more ("one more", "two more sets", "another set @ 105")
  const more = tryParseAppendMore(trimmed);
  if (more && hasActiveBlock && lastWorking) {
    const reps = lastWorking.r;
    const weight = more.overrideWeight ?? lastWorking.w;
    const unit = more.overrideUnit ?? lastWorking.u ?? fallbackUnit ?? defaultUnit;
    if (reps != null) {
      return {
        kind: "edit",
        editXml: buildEditXmlInsertWorking(reps, weight, unit, more.count),
        ruleId: "append-more",
      };
    }
  }

  // 7) Single-set reps×weight on active block ("100kg x 5", "5 @ 100")
  if (hasActiveBlock) {
    const single = tryParseSingleSetReps(trimmed, defaultUnit, fallbackUnit);
    if (single) {
      return {
        kind: "edit",
        editXml: buildEditXmlInsertWorking(
          single.reps,
          single.weight,
          single.unit,
          1,
        ),
        ruleId: "log-single-set",
      };
    }
  }

  // 8) Switch exercise ("switch to incline dumbbell press")
  const sw = tryParseSwitchExercise(trimmed);
  if (sw) {
    const resolved = resolveExerciseFromPhrase(sw.phrase);
    if (resolved && getExerciseBySlug(resolved.slug)) {
      return {
        kind: "edit",
        editXml: buildEditXmlSetExercise(resolved.slug),
        ruleId: "switch-exercise",
      };
    }
  }

  // No deterministic match — fall through to LLM.
  if (hasNumber(trimmed)) {
    // Numbers without a recognised pattern: let the LLM try.
    return null;
  }
  return null;
}
