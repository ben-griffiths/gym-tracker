import {
  MAX_WORKOUT_SET_ROWS,
  parseWorkoutXmlFragment,
  stripMarkdownFences,
  type RawSetRow,
  type SetKindXml,
} from "@/lib/workout-chat/workout-xml";

const INSERT_POSITIONS = new Set([
  "start",
  "end",
  "before-first-working",
  "after-last-working",
  "before-first-set",
  "after-last-set",
]);

const UPDATE_DELETE_TARGETS_PREFIX = new Set([
  "last-set",
  "first-set",
  "all-sets",
  "all-working",
  "all-warmup",
  "all-backoff",
  "all-drop",
]);

const INSERT_MAX_COUNT = 10;

function escapeXmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseTagAttributes(attrString: string): Record<string, string> {
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

const W_RE = /^(?:\d+|\d*\.\d+)$/;

function parsePositiveInt(s: string | undefined): number | null {
  if (s == null || s === "") return null;
  if (!/^[1-9]\d*$/.test(s)) return null;
  return Number(s);
}

function parseWeight(s: string | undefined): number | null {
  if (s == null || s === "") return null;
  if (!W_RE.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function isAllowedKind(k: string): k is SetKindXml {
  return k === "warmup" || k === "working" || k === "backoff" || k === "drop";
}

type ParsedEditOpBlock = { tag: string; index: number; html: string };

function parseEditInnerOpBlocks(inner: string): ParsedEditOpBlock[] {
  const opBlocks: ParsedEditOpBlock[] = [];
  const findAll = (re: RegExp, tag: string) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) {
      opBlocks.push({ tag, html: m[0]!, index: m.index });
    }
  };

  findAll(/<noop\s*\/>/gi, "noop");
  findAll(/<insert\b[^>]*>[\s\S]*?<\/insert>/gi, "insert");
  findAll(/<update\b[^/]*\/>/gi, "update");
  findAll(/<delete\b[^/]*\/>/gi, "delete");
  findAll(/<set-exercise\b[^/]*\/>/gi, "set-exercise");

  opBlocks.sort((a, b) => a.index - b.index);
  return opBlocks;
}

/**
 * Extract first `<edit>...</edit>` from model output; close truncated edit roots.
 */
export function extractEditXml(raw: string): string | null {
  const s = stripMarkdownFences(raw);
  const complete = /<edit\b[^>]*>[\s\S]*?<\/edit>/i.exec(s);
  if (complete) return complete[0]!;

  const partial = /<edit\b[^>]*>[\s\S]*/i.exec(s);
  if (partial) return `${partial[0]}</edit>`;

  return null;
}

function sanitizeSTemplate(attrStr: string): RawSetRow | null {
  const a = parseTagAttributes(attrStr.trim());
  const kindRaw = (a.kind ?? "").toLowerCase().trim();
  if (!kindRaw || !isAllowedKind(kindRaw)) return null;

  const row: RawSetRow = {
    kind: kindRaw,
    r: null,
    w: null,
    u: null,
  };

  const r = parsePositiveInt(a.r);
  if (r != null) row.r = r;

  const w = parseWeight(a.w);
  if (w != null) row.w = w;

  const u = (a.u ?? "").toLowerCase();
  if (u === "kg" || u === "lb") row.u = u;

  return row;
}

export type SanitizeEditXmlOptions = {
  allowedExerciseSlugs: string[];
};

function isValidUpdateTarget(target: string): boolean {
  if (UPDATE_DELETE_TARGETS_PREFIX.has(target)) return true;
  return /^set:[1-9]\d*$/.test(target);
}

function serializeSTag(row: RawSetRow): string {
  const parts: string[] = [`kind="${escapeXmlAttr(row.kind)}"`];
  if (row.r != null) parts.push(`r="${row.r}"`);
  if (row.w != null) parts.push(`w="${row.w}"`);
  if (row.u) parts.push(`u="${row.u}"`);
  return `<s ${parts.join(" ")}/>`;
}

function serializeSRowLine(row: RawSetRow): string {
  const parts: string[] = [`kind="${escapeXmlAttr(row.kind)}"`];
  if (row.n != null && Number.isFinite(row.n) && row.n >= 1) {
    parts.unshift(`n="${row.n}"`);
  }
  if (row.r != null) parts.push(`r="${row.r}"`);
  if (row.w != null) parts.push(`w="${row.w}"`);
  if (row.u) parts.push(`u="${row.u}"`);
  return `  <s ${parts.join(" ")}/>`;
}

function rowsToWorkoutXml(exercise: string, rows: RawSetRow[]): string {
  const lines: string[] = [`<workout exercise="${escapeXmlAttr(exercise)}">`];
  for (const row of rows) {
    lines.push(serializeSRowLine(row));
  }
  lines.push(`</workout>`);
  return lines.join("\n");
}

function cloneRow(r: RawSetRow): RawSetRow {
  const out: RawSetRow = {
    kind: r.kind,
    r: r.r,
    w: r.w,
    u: r.u,
    note: r.note,
  };
  if (r.n != null) out.n = r.n;
  return out;
}

function resolveTargetIndices(target: string, rows: RawSetRow[]): number[] {
  const n = rows.length;
  if (n === 0) return [];

  if (target === "last-set") return [n - 1];
  if (target === "first-set") return [0];
  if (target === "all-sets") return Array.from({ length: n }, (_, i) => i);

  if (target === "all-working") {
    return rows
      .map((r, i) => (r.kind === "working" ? i : -1))
      .filter((i) => i >= 0);
  }
  if (target === "all-warmup") {
    return rows
      .map((r, i) => (r.kind === "warmup" ? i : -1))
      .filter((i) => i >= 0);
  }
  if (target === "all-backoff") {
    return rows
      .map((r, i) => (r.kind === "backoff" ? i : -1))
      .filter((i) => i >= 0);
  }
  if (target === "all-drop") {
    return rows
      .map((r, i) => (r.kind === "drop" ? i : -1))
      .filter((i) => i >= 0);
  }

  const setM = /^set:([1-9]\d*)$/.exec(target);
  if (setM) {
    const idx = Number(setM[1]) - 1;
    if (idx >= 0 && idx < n) return [idx];
  }
  return [];
}

function insertIndex(position: string, rows: RawSetRow[]): number {
  const n = rows.length;
  switch (position) {
    case "start":
    case "before-first-set":
      return 0;
    case "end":
    case "after-last-set":
      return n;
    case "before-first-working": {
      const i = rows.findIndex((r) => r.kind === "working");
      return i === -1 ? 0 : i;
    }
    case "after-last-working": {
      let last = -1;
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i]!.kind === "working") last = i;
      }
      return last === -1 ? n : last + 1;
    }
    default:
      return n;
  }
}

/**
 * Structural validation only — does not interpret natural language.
 * Preserves operation order from the edit inner XML.
 */
export function sanitizeEditXml(
  editFragment: string,
  opts: SanitizeEditXmlOptions,
): string | null {
  const inner = /<edit\b[^>]*>([\s\S]*)<\/edit>/i.exec(editFragment)?.[1];
  if (inner === undefined) return null;

  const allowedSlugs = new Set(opts.allowedExerciseSlugs);
  const blocks = parseEditInnerOpBlocks(inner);
  const hasNonNoop = blocks.some((b) => b.tag !== "noop");

  const out: string[] = [];
  let noopAdded = false;

  for (const op of blocks) {
    if (op.tag === "noop") {
      if (hasNonNoop) continue;
      if (!noopAdded) {
        out.push("<noop/>");
        noopAdded = true;
      }
      continue;
    }

    if (op.tag === "insert") {
      const header = /<insert\b([^>]*)>/i.exec(op.html)?.[1] ?? "";
      const attrs = parseTagAttributes(header);
      const pos = (attrs.position ?? "").trim().toLowerCase();
      if (!INSERT_POSITIONS.has(pos)) continue;

      let count = parsePositiveInt(attrs.count) ?? 0;
      if (count < 1) continue;
      count = Math.min(count, INSERT_MAX_COUNT);

      const body = op.html
        .replace(/^[\s\S]*?<insert\b[^>]*>/i, "")
        .replace(/<\/insert>\s*$/i, "");
      const sSelf = /<s\b([^>]*)\/>/i.exec(body);
      const sPair = /<s\b([^>]*)>\s*<\/s>/i.exec(body);
      if (!sSelf && !sPair) continue;
      const tmpl = sanitizeSTemplate((sSelf?.[1] ?? sPair?.[1] ?? "").trim());
      if (!tmpl) continue;

      const sLine = serializeSTag(tmpl);
      out.push(
        `<insert position="${escapeXmlAttr(pos)}" count="${count}">\n  ${sLine}\n</insert>`,
      );
      continue;
    }

    if (op.tag === "update") {
      const attrs = parseTagAttributes(
        /<update\b([^/]*)\/>/i.exec(op.html)?.[1] ?? "",
      );
      const target = (attrs.target ?? "").trim().toLowerCase();
      if (!isValidUpdateTarget(target)) continue;

      const parts: string[] = [`target="${escapeXmlAttr(target)}"`];
      if (attrs.kind) {
        const k = attrs.kind.toLowerCase().trim();
        if (isAllowedKind(k)) parts.push(`kind="${escapeXmlAttr(k)}"`);
      }
      if (attrs.r && /^[1-9]\d*$/.test(attrs.r)) {
        parts.push(`r="${escapeXmlAttr(String(Number(attrs.r)))}"`);
      }
      const w = parseWeight(attrs.w);
      if (w != null) parts.push(`w="${escapeXmlAttr(String(w))}"`);
      const u = (attrs.u ?? "").toLowerCase();
      if (u === "kg" || u === "lb") parts.push(`u="${u}"`);

      if (parts.length < 2) continue;
      out.push(`<update ${parts.join(" ")}/>`);
      continue;
    }

    if (op.tag === "delete") {
      const attrs = parseTagAttributes(
        /<delete\b([^/]*)\/>/i.exec(op.html)?.[1] ?? "",
      );
      const target = (attrs.target ?? "").trim().toLowerCase();
      if (!isValidUpdateTarget(target)) continue;
      out.push(`<delete target="${escapeXmlAttr(target)}"/>`);
      continue;
    }

    if (op.tag === "set-exercise") {
      const attrs = parseTagAttributes(
        /<set-exercise\b([^/]*)\/>/i.exec(op.html)?.[1] ?? "",
      );
      const slug = (attrs.slug ?? "").trim();
      if (!slug || !allowedSlugs.has(slug)) continue;
      out.push(`<set-exercise slug="${escapeXmlAttr(slug)}"/>`);
    }
  }

  if (out.length === 0) return null;

  return `<edit>\n  ${out.join("\n  ")}\n</edit>`;
}

/**
 * Apply sanitized edit XML to the previous workout document. Does not read user text.
 */
export function applyWorkoutEditXml(opts: {
  previousXml: string;
  editXml: string;
  allowedExerciseSlugs: string[];
}): string | null {
  const { editXml, allowedExerciseSlugs } = opts;
  const allowed = new Set(allowedExerciseSlugs);

  const inner = /<edit\b[^>]*>([\s\S]*)<\/edit>/i.exec(editXml)?.[1];
  if (inner === undefined) return null;

  const opBlocks = parseEditInnerOpBlocks(inner);
  const nonNoop = opBlocks.filter((b) => b.tag !== "noop");

  if (nonNoop.length === 0) {
    return opts.previousXml.trim();
  }

  const parsedPrev = parseWorkoutXmlFragment(opts.previousXml);
  if (!parsedPrev) return null;

  let exercise = parsedPrev.exerciseAttr.trim();
  let rows = parsedPrev.rows.map(cloneRow);

  for (const op of opBlocks) {
    if (op.tag === "noop") continue;

    if (op.tag === "set-exercise") {
      const attrs = parseTagAttributes(
        /<set-exercise\b([^/]*)\/>/i.exec(op.html)?.[1] ?? "",
      );
      const slug = (attrs.slug ?? "").trim();
      if (slug && allowed.has(slug)) exercise = slug;
      continue;
    }

    if (op.tag === "insert") {
      const header = /<insert\b([^>]*)>/i.exec(op.html)?.[1] ?? "";
      const attrs = parseTagAttributes(header);
      const pos = (attrs.position ?? "").trim().toLowerCase();
      if (!INSERT_POSITIONS.has(pos)) continue;

      let count = parsePositiveInt(attrs.count) ?? 0;
      count = Math.min(Math.max(1, count), INSERT_MAX_COUNT);

      const body = op.html
        .replace(/^[\s\S]*?<insert\b[^>]*>/i, "")
        .replace(/<\/insert>\s*$/i, "");
      const sSelf = /<s\b([^>]*)\/>/i.exec(body);
      const sPair = /<s\b([^>]*)>\s*<\/s>/i.exec(body);
      const tmpl = sanitizeSTemplate((sSelf?.[1] ?? sPair?.[1] ?? "").trim());
      if (!tmpl) continue;

      const idx = insertIndex(pos, rows);
      const additions = Array.from({ length: count }, () => cloneRow(tmpl));
      rows.splice(idx, 0, ...additions);
      continue;
    }

    if (op.tag === "update") {
      const attrs = parseTagAttributes(
        /<update\b([^/]*)\/>/i.exec(op.html)?.[1] ?? "",
      );
      const target = (attrs.target ?? "").trim().toLowerCase();
      if (!isValidUpdateTarget(target)) continue;

      let touched = false;
      if (attrs.kind) {
        const k = attrs.kind.toLowerCase().trim();
        if (isAllowedKind(k)) touched = true;
      }
      if (attrs.r && /^[1-9]\d*$/.test(attrs.r)) touched = true;
      if (parseWeight(attrs.w) != null) touched = true;
      const u = (attrs.u ?? "").toLowerCase();
      if (u === "kg" || u === "lb") touched = true;
      if (!touched) continue;

      const indices = resolveTargetIndices(target, rows);
      for (const i of indices) {
        if (attrs.kind) {
          const k = attrs.kind.toLowerCase().trim();
          if (isAllowedKind(k)) rows[i]!.kind = k;
        }
        if (attrs.r && /^[1-9]\d*$/.test(attrs.r)) {
          rows[i]!.r = Number(attrs.r);
        }
        const w = parseWeight(attrs.w);
        if (w != null) rows[i]!.w = w;
        if (u === "kg" || u === "lb") rows[i]!.u = u;
      }
      continue;
    }

    if (op.tag === "delete") {
      const attrs = parseTagAttributes(
        /<delete\b([^/]*)\/>/i.exec(op.html)?.[1] ?? "",
      );
      const target = (attrs.target ?? "").trim().toLowerCase();
      if (!isValidUpdateTarget(target)) continue;

      const indices = resolveTargetIndices(target, rows);
      for (const i of [...new Set(indices)].sort((a, b) => b - a)) {
        if (i >= 0 && i < rows.length) rows.splice(i, 1);
      }
    }
  }

  if (rows.length > MAX_WORKOUT_SET_ROWS) return null;

  return rowsToWorkoutXml(exercise, rows);
}
