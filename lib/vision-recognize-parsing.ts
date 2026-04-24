import { z } from "zod";
import { searchExercises } from "@/lib/exercises";

export const matchRowSchema = z.object({
  exerciseSlug: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional().default(""),
});

export type MatchRow = z.infer<typeof matchRowSchema>;

const JSON_SNIP = 160;

function exerciseNamesFromContext(query: string, limit = 6): string[] {
  return searchExercises(query.slice(0, JSON_SNIP), limit).map((e) => e.name);
}

/** OpenAI Responses API: text may be on `output_text` or under `output[].message.content`. */
export function extractTextFromOpenAIResponse(completion: unknown): string {
  if (!completion || typeof completion !== "object") return "";
  const c = completion as Record<string, unknown>;
  if (typeof c.output_text === "string" && c.output_text.trim()) {
    return c.output_text.trim();
  }
  const output = c.output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const typed = item as { type?: string; content?: unknown };
    if (typed.type !== "message") continue;
    if (!Array.isArray(typed.content)) continue;
    for (const block of typed.content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: string; text?: string };
      if (
        (b.type === "output_text" || b.type === "text") &&
        typeof b.text === "string"
      ) {
        parts.push(b.text);
      }
    }
  }
  return parts.join("").trim();
}

function stripMarkdownCodeFence(s: string): string {
  return s
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof v === "string" && v.trim()) {
    return v
      .split(/[,;]|\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Tolerates JSON (several key shapes), code fences, or plain prose. Uses
 * catalog search to backfill suggested names when the model omits a list.
 */
export function parseDescribeModelOutput(outText: string): {
  description: string;
  suggested: string[];
  ok: boolean;
} {
  const raw = stripMarkdownCodeFence(outText).trim();
  if (!raw) return { description: "", suggested: [], ok: false };

  let obj: Record<string, unknown> | null = null;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const i = raw.indexOf("{");
    const j = raw.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        obj = JSON.parse(raw.slice(i, j + 1)) as Record<string, unknown>;
      } catch {
        obj = null;
      }
    }
  }

  if (!obj) {
    const plain = raw.replace(/\n{3,}/g, "\n\n").trim();
    if (!plain) return { description: "", suggested: [], ok: false };
    const fromSearch = exerciseNamesFromContext(plain);
    return {
      description: plain,
      suggested: fromSearch.length > 0 ? fromSearch : ["strength training"],
      ok: true,
    };
  }

  const description = String(
    obj.description ??
      obj.scene ??
      obj.summary ??
      obj.sceneDescription ??
      obj.what_you_see ??
      obj.text ??
      "",
  ).trim();

  let suggested = asStringList(
    obj.suggestedExercises ??
      obj.exercises ??
      obj.suggested ??
      obj.plausibleExercises,
  );
  if (suggested.length === 0 && typeof obj.suggested_exercises === "string") {
    suggested = asStringList(obj.suggested_exercises);
  }
  if (description && suggested.length === 0) {
    suggested = exerciseNamesFromContext(description);
  }
  if (!description && suggested.length > 0) {
    return {
      description: `You could try: ${suggested.slice(0, 5).join(", ")}.`,
      suggested,
      ok: true,
    };
  }
  if (!description && suggested.length === 0) {
    return { description: "", suggested: [], ok: false };
  }
  if (suggested.length === 0) {
    suggested = exerciseNamesFromContext(description);
    if (suggested.length === 0) suggested = ["general gym exercise"];
  }
  return { description, suggested: suggested.slice(0, 12), ok: true };
}

const parseRowArray = (arr: unknown): MatchRow[] => {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((row) => matchRowSchema.safeParse(row))
    .filter((r) => r.success)
    .map((r) => r.data);
};

export function parseMatchModelOutput(outText: string): MatchRow[] {
  const raw = stripMarkdownCodeFence(outText).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parseRowArray(parsed);
    if (parsed && typeof parsed === "object" && "matches" in parsed) {
      return parseRowArray((parsed as { matches: unknown }).matches);
    }
    return parseRowArray((parsed as { rows?: unknown }).rows);
  } catch {
    const i = raw.indexOf("[");
    const j = raw.lastIndexOf("]");
    if (i < 0 || j <= i) return [];
    try {
      return parseRowArray(JSON.parse(raw.slice(i, j + 1)));
    } catch {
      return [];
    }
  }
}

/** When the matcher returns 0–8 rows, pad with nulls until `target` for downstream mapping. */
export function padMatchRows(
  modelRows: MatchRow[],
  target: number,
  modelMax: number,
): MatchRow[] {
  const base =
    modelRows.length > 0
      ? modelRows.slice(0, modelMax)
      : [{ exerciseSlug: null, confidence: 0, reasoning: "no_parse" as const }];
  const out = [...base];
  while (out.length < target) {
    out.push({ exerciseSlug: null, confidence: 0.2, reasoning: "pad" });
  }
  return out;
}
