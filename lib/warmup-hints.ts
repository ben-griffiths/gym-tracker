/**
 * Parse warmup hints out of free-text. Single source of truth for every
 * place that wants to know:
 *
 *  - How many warmup sets did the user ask for? ("two warm up sets", "3 warmups")
 *  - What percentage of 1RM should the first warmup start at? (defaults to 30%)
 *
 * Every surface that needs this info — the fallback parser, the chat agent
 * post-processor, and the client workout page — calls the same function so
 * the three of them can never disagree.
 */

export const DEFAULT_WARMUP_START_PCT = 0.3;

const WORD_TO_NUMBER: Record<string, number> = {
  zero: 0,
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
};

export type WarmupHints = {
  /** Number of warmup sets requested (0 when absent or zero). */
  warmupSets: number;
  /** Fraction (0..1) to start the first warmup at. Defaults to 0.3. */
  warmupStartPct: number;
  /** Number of explicitly-named working sets if one was supplied. */
  workingSets: number | null;
};

/**
 * Detect phrasings like:
 *  - "2 warmup sets"
 *  - "two warm up sets"
 *  - "a couple of warmups"
 *  - "one warm-up set"
 *
 * Returns 0 when nothing matches.
 */
function detectWarmupSetCount(lower: string): number {
  const digitMatch = lower.match(
    /(\d+)\s*(?:warmups?|warm[\s-]?up(?:\s+sets?)?)/,
  );
  if (digitMatch) {
    const value = Number(digitMatch[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 20) return value;
  }

  const wordMatch = lower.match(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:warmups?|warm[\s-]?up(?:\s+sets?)?)\b/,
  );
  if (wordMatch) {
    const value = WORD_TO_NUMBER[wordMatch[1]!];
    if (typeof value === "number") return value;
  }

  // "a couple (of) warmup sets" -> 2, "a few" -> 3 (informal conventions).
  if (/\ba\s+couple(?:\s+of)?\s+warm[\s-]?up/.test(lower)) return 2;
  if (/\ba\s+few\s+warm[\s-]?up/.test(lower)) return 3;

  return 0;
}

function detectWorkingSetCount(lower: string): number | null {
  const digitMatch = lower.match(/(\d+)\s*working\s+sets?/);
  if (digitMatch) {
    const value = Number(digitMatch[1]);
    if (Number.isFinite(value) && value >= 1 && value <= 20) return value;
  }

  const wordMatch = lower.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+working\s+sets?\b/,
  );
  if (wordMatch) {
    const value = WORD_TO_NUMBER[wordMatch[1]!];
    if (typeof value === "number") return value;
  }
  return null;
}

function detectWarmupStartPct(lower: string): number {
  const pctMatch = lower.match(/(?:less\s+than\s+)?(\d+(?:\.\d+)?)\s*%/);
  if (!pctMatch) return DEFAULT_WARMUP_START_PCT;
  const value = Number(pctMatch[1]) / 100;
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    return DEFAULT_WARMUP_START_PCT;
  }
  return value;
}

export function parseWarmupHints(message: string | null | undefined): WarmupHints {
  const lower = (message ?? "").toLowerCase();
  return {
    warmupSets: detectWarmupSetCount(lower),
    warmupStartPct: detectWarmupStartPct(lower),
    workingSets: detectWorkingSetCount(lower),
  };
}

/**
 * Does the message look like the user wants the agent to ramp weights
 * even if they never said "choose the weights" explicitly? e.g.
 * "two warmup sets with increasing weight to 3 working sets".
 *
 * True when the user mentioned warmups AND implied a weight ramp.
 */
export function hasWarmupRampPhrasing(message: string): boolean {
  const lower = message.toLowerCase();
  if (!/\bwarm[\s-]?up/.test(lower)) return false;
  return (
    /\b(?:increasing|increase|increases|ramp(?:ing|s|ed)?|build(?:ing|s|\s+up)?|working\s+up|work\s+up|step(?:ping)?\s+up)\b/.test(
      lower,
    ) || /\bwarm[\s-]?up\s+sets?\b[^.]*\bworking\s+sets?\b/.test(lower)
  );
}
