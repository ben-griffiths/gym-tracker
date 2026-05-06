import type { WeightUnit } from "@/lib/types/workout";
import { getExerciseBySlug } from "@/lib/exercises";
import { suggestWarmupRepsBeforeWorking } from "@/lib/rep-percentages";
import {
  parseWorkoutXmlFragment,
  type RawSetRow,
} from "@/lib/workout-chat/workout-xml";

/**
 * Typed primitive intents emitted by the deterministic regex layer or the
 * LLM decomposer. Each primitive describes ONE narrow user action so the
 * downstream XML builders are trivial and testable in isolation.
 */
export type Primitive =
  | {
      type: "log_new";
      lift: string;
      sets: number;
      reps: number;
      weight?: number;
      unit?: WeightUnit;
    }
  | {
      type: "append_more";
      count: number;
      weight?: number;
      unit?: WeightUnit;
    }
  | { type: "add_warmups"; count: number }
  | {
      type: "update_last_set";
      reps?: number;
      weight?: number;
      unit?: WeightUnit;
    }
  | {
      type: "update_set";
      index: number;
      reps?: number;
      weight?: number;
      unit?: WeightUnit;
    }
  | { type: "delete_last" }
  | { type: "delete_set"; index: number }
  | { type: "switch_exercise"; slug: string }
  | { type: "noop" };

const MAX_COUNT = 10;
const MAX_REPS = 100;
const MAX_WEIGHT = 1000;
const MAX_SETS_PER_LOG = 20;
const MAX_INDEX = 20;

function clampInt(n: unknown, min: number, max: number): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const r = Math.round(n);
  if (r < min || r > max) return null;
  return r;
}

function clampWeight(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n <= 0 || n > MAX_WEIGHT) return null;
  return n;
}

function isUnit(u: unknown): u is WeightUnit {
  return u === "kg" || u === "lb";
}

/**
 * Runtime validator for a single Primitive. Returns the cleaned primitive or
 * `null` if it can't be repaired into something safe to apply.
 *
 * `allowedSlugs` is enforced for `switch_exercise`. The decomposer may
 * return slugs the catalog doesn't have, or that aren't in the current
 * conversation's hint list — those become `null`.
 */
export function validatePrimitive(
  raw: unknown,
  allowedSlugs: ReadonlySet<string>,
): Primitive | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== "string") return null;

  switch (type) {
    case "log_new": {
      const lift = typeof obj.lift === "string" ? obj.lift.trim() : "";
      const sets = clampInt(obj.sets, 1, MAX_SETS_PER_LOG);
      const reps = clampInt(obj.reps, 1, MAX_REPS);
      if (!lift || sets == null || reps == null) return null;
      const weight = obj.weight === undefined ? undefined : clampWeight(obj.weight);
      const unit = obj.unit === undefined ? undefined : (isUnit(obj.unit) ? obj.unit : undefined);
      const out: Primitive = { type: "log_new", lift, sets, reps };
      if (weight != null) (out as { weight?: number }).weight = weight;
      if (unit) (out as { unit?: WeightUnit }).unit = unit;
      return out;
    }
    case "append_more": {
      const count = clampInt(obj.count, 1, MAX_COUNT);
      if (count == null) return null;
      const weight = obj.weight === undefined ? undefined : clampWeight(obj.weight);
      const unit = obj.unit === undefined ? undefined : (isUnit(obj.unit) ? obj.unit : undefined);
      const out: Primitive = { type: "append_more", count };
      if (weight != null) (out as { weight?: number }).weight = weight;
      if (unit) (out as { unit?: WeightUnit }).unit = unit;
      return out;
    }
    case "add_warmups": {
      const count = clampInt(obj.count, 1, MAX_COUNT);
      if (count == null) return null;
      return { type: "add_warmups", count };
    }
    case "update_last_set": {
      const reps = obj.reps === undefined ? undefined : clampInt(obj.reps, 1, MAX_REPS);
      const weight = obj.weight === undefined ? undefined : clampWeight(obj.weight);
      const unit = obj.unit === undefined ? undefined : (isUnit(obj.unit) ? obj.unit : undefined);
      if (reps == null && weight == null && !unit) return null;
      const out: Primitive = { type: "update_last_set" };
      if (reps != null) (out as { reps?: number }).reps = reps;
      if (weight != null) (out as { weight?: number }).weight = weight;
      if (unit) (out as { unit?: WeightUnit }).unit = unit;
      return out;
    }
    case "update_set": {
      const index = clampInt(obj.index, 1, MAX_INDEX);
      if (index == null) return null;
      const reps = obj.reps === undefined ? undefined : clampInt(obj.reps, 1, MAX_REPS);
      const weight = obj.weight === undefined ? undefined : clampWeight(obj.weight);
      const unit = obj.unit === undefined ? undefined : (isUnit(obj.unit) ? obj.unit : undefined);
      if (reps == null && weight == null && !unit) return null;
      const out: Primitive = { type: "update_set", index };
      if (reps != null) (out as { reps?: number }).reps = reps;
      if (weight != null) (out as { weight?: number }).weight = weight;
      if (unit) (out as { unit?: WeightUnit }).unit = unit;
      return out;
    }
    case "delete_last":
      return { type: "delete_last" };
    case "delete_set": {
      const index = clampInt(obj.index, 1, MAX_INDEX);
      if (index == null) return null;
      return { type: "delete_set", index };
    }
    case "switch_exercise": {
      const slug = typeof obj.slug === "string" ? obj.slug.trim() : "";
      if (!slug) return null;
      if (!allowedSlugs.has(slug) && !getExerciseBySlug(slug)) return null;
      return { type: "switch_exercise", slug };
    }
    case "noop":
      return { type: "noop" };
    default:
      return null;
  }
}

function lastWorkingRow(rows: RawSetRow[]): RawSetRow | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i]!.kind === "working") return rows[i]!;
  }
  return null;
}

function buildWorkoutXmlForLog(p: Extract<Primitive, { type: "log_new" }>, defaultUnit: WeightUnit): string {
  const unit = p.unit ?? defaultUnit;
  const lines: string[] = [`<workout exercise="">`];
  for (let i = 0; i < p.sets; i += 1) {
    const wAttr = p.weight != null ? ` w="${p.weight}"` : "";
    lines.push(`<s kind="working" r="${p.reps}"${wAttr} u="${unit}"/>`);
  }
  lines.push(`</workout>`);
  return lines.join("\n");
}

function buildEditOpForAppendMore(
  p: Extract<Primitive, { type: "append_more" }>,
  previousXml: string,
  defaultUnit: WeightUnit,
): string | null {
  const rows = parseWorkoutXmlFragment(previousXml)?.rows ?? [];
  const last = lastWorkingRow(rows);
  if (!last) return null;
  const reps = last.r;
  const weight = p.weight ?? last.w;
  const unit = p.unit ?? last.u ?? defaultUnit;
  if (reps == null) return null;
  const parts = [`kind="working"`, `r="${reps}"`];
  if (weight != null) parts.push(`w="${weight}"`);
  parts.push(`u="${unit}"`);
  return `<insert position="end" count="${p.count}">
    <s ${parts.join(" ")}/>
  </insert>`;
}

function buildEditOpForAddWarmups(
  p: Extract<Primitive, { type: "add_warmups" }>,
  previousXml: string,
): string {
  const rows = parseWorkoutXmlFragment(previousXml)?.rows ?? [];
  const firstWorking = rows.find((r) => r.kind === "working");
  const workingReps = firstWorking?.r ?? null;

  if (workingReps == null) {
    return `<insert position="before-first-working" count="${p.count}">
    <s kind="warmup"/>
  </insert>`;
  }

  // Gym-coach style rep ramp: heavier early warmups carry more reps, last
  // warmup is closest to the working set. Insert each row separately so
  // each warmup keeps its own rep count. Insert in REVERSE order so that
  // the first warmup ends up at the top.
  const repsSchedule = suggestWarmupRepsBeforeWorking(workingReps, p.count);
  const inserts: string[] = [];
  for (let i = repsSchedule.length - 1; i >= 0; i -= 1) {
    inserts.push(
      `<insert position="before-first-working" count="1">
    <s kind="warmup" r="${repsSchedule[i]}"/>
  </insert>`,
    );
  }
  return inserts.join("\n  ");
}

function buildUpdateOp(target: string, attrs: { reps?: number; weight?: number; unit?: WeightUnit }): string {
  const parts: string[] = [`target="${target}"`];
  if (attrs.reps != null) parts.push(`r="${attrs.reps}"`);
  if (attrs.weight != null) parts.push(`w="${attrs.weight}"`);
  if (attrs.unit) parts.push(`u="${attrs.unit}"`);
  return `<update ${parts.join(" ")}/>`;
}

function buildEditOpForPrimitive(
  p: Primitive,
  previousXml: string,
  defaultUnit: WeightUnit,
): string | null {
  switch (p.type) {
    case "append_more":
      return buildEditOpForAppendMore(p, previousXml, defaultUnit);
    case "add_warmups":
      return buildEditOpForAddWarmups(p, previousXml);
    case "update_last_set":
      return buildUpdateOp("last-set", p);
    case "update_set":
      return buildUpdateOp(`set:${p.index}`, p);
    case "delete_last":
      return `<delete target="last-set"/>`;
    case "delete_set":
      return `<delete target="set:${p.index}"/>`;
    case "switch_exercise":
      return `<set-exercise slug="${p.slug}"/>`;
    case "noop":
    case "log_new":
      return null;
    default: {
      const _exhaustive: never = p;
      void _exhaustive;
      return null;
    }
  }
}

export type PrimitiveBuildResult = {
  /** Optional fresh `<workout>` produced by a `log_new` primitive. Apply this BEFORE the edit. */
  workoutXml: string | null;
  /** Combined `<edit>...</edit>` containing every non-log primitive's op, in order. Empty when no edits. */
  editXml: string | null;
};

/**
 * Convert a list of primitives (in order) into an apply-ready pair of XML
 * documents. The caller must apply `workoutXml` first (which typically
 * resets/creates the active block) and then run `editXml` against that
 * merged document.
 */
export function primitivesToXml(
  primitives: Primitive[],
  ctx: { previousXml: string; defaultUnit: WeightUnit },
): PrimitiveBuildResult {
  let workoutXml: string | null = null;
  const editOps: string[] = [];

  // The previousXml grows as we synthesise log_new — append-more / add-warmups
  // that follow a log_new should target the freshly-logged workout, not the
  // pre-turn state. We track that via a running cursor.
  let cursorXml = ctx.previousXml;

  for (const p of primitives) {
    if (p.type === "noop") continue;
    if (p.type === "log_new") {
      const newWorkout = buildWorkoutXmlForLog(p, ctx.defaultUnit);
      workoutXml = newWorkout;
      cursorXml = newWorkout;
      continue;
    }
    const op = buildEditOpForPrimitive(p, cursorXml, ctx.defaultUnit);
    if (op) editOps.push(op);
  }

  if (editOps.length === 0) {
    return { workoutXml, editXml: null };
  }

  const editXml = `<edit>
  ${editOps.join("\n  ")}
</edit>`;
  return { workoutXml, editXml };
}
