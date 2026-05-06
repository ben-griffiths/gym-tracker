import { NextResponse } from "next/server";
import type OpenAI from "openai";
import { z } from "zod";
import { EXERCISES, getExerciseBySlug, searchExercises } from "@/lib/exercises";
import { requireSupabaseUser } from "@/lib/supabase/auth";
import { visionRecognizeSchema } from "@/lib/validators/workout";
import type {
  ExerciseRecord,
  ExerciseWeightCandidate,
  VisionPrimarySource,
} from "@/lib/types/workout";

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
const VISION_RECOGNIZE_DEBUG =
  process.env.VISION_RECOGNIZE_DEBUG === "1" || process.env.VISION_RECOGNIZE_DEBUG === "true";

const isVisionDevLog = () => process.env.NODE_ENV === "development" || VISION_RECOGNIZE_DEBUG;

function logVision(event: string, data?: Record<string, string | number | boolean | null | undefined>) {
  if (!isVisionDevLog()) return;
  if (data && Object.keys(data).length) console.log(`[vision/recognize] ${event}`, data);
  else console.log(`[vision/recognize] ${event}`);
}

const SUGGESTION_TARGET = 5;
const MATCH_MODEL_ROW_CAP = 8;
const CATALOG_PADDED_CONFIDENCE = 0.5;

function buildCatalogText(): string {
  return EXERCISES.map((e) => `${e.slug}:${e.name}`).join("\n");
}

function buildDescribeSystemPrompt() {
  return [
    "You are looking at a gym or workout image.",
    "Return valid JSON only, no markdown.",
    "You must name what you see in plain English. Do not use internal IDs, kebab slugs, or codes.",
    "suggestedExercises is a list of 3–8 short human-readable exercise names the person could realistically do with or on this equipment (e.g. \"incline dumbbell press\", not \"incline-dumbbell-press\").",
    "If the image is not gym-related, describe it honestly and set suggestedExercises to best-effort still.",
    "Shape:",
    '{"description":"<string>","suggestedExercises":["<string>",...]}',
  ].join("\n");
}

function buildMatchSystemPrompt() {
  return [
    "You map free-text exercise ideas to a fixed exercise catalog.",
    "Return valid JSON only, no markdown.",
    "You will be given: (1) a scene description, (2) a list of suggested exercise phrases, (3) a catalog in lines `slug:Human Name`.",
    "Return a JSON array of exactly 5 objects, best match first, each:",
    `{"exerciseSlug":"<slug from catalog or null>","confidence":<0-1>,"reasoning":"<brief>"}`,
    "exerciseSlug must be copied exactly from the catalog line (before the colon), or null if there is no reasonable match. Never invent slugs.",
    "Prefer the closest catalog name to each suggested exercise; the order should put the most relevant lifts first for this scene.",
  ].join("\n");
}

function catalogExercisesInRotatedOrder(seed: string): ExerciseRecord[] {
  if (EXERCISES.length === 0) return [];
  let h = 2166136261;
  for (let i = 0; i < Math.min(seed.length, 200); i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const start = h % EXERCISES.length;
  return start === 0
    ? [...EXERCISES]
    : [...EXERCISES.slice(start), ...EXERCISES.slice(0, start)];
}

function padToTarget(
  fromMatcher: ExerciseWeightCandidate[],
  description: string,
  suggested: string[],
  imageSeed: string,
): ExerciseWeightCandidate[] {
  const seen = new Set(fromMatcher.map((c) => c.exercise.slug));
  const out: ExerciseWeightCandidate[] = [...fromMatcher];

  const takeSearch = (query: string) => {
    for (const ex of searchExercises(query, 6)) {
      if (out.length >= SUGGESTION_TARGET) break;
      if (seen.has(ex.slug)) continue;
      seen.add(ex.slug);
      out.push({
        exercise: ex,
        weight: null,
        weightUnit: "kg",
        confidence: CATALOG_PADDED_CONFIDENCE,
        reasoning: "Search",
      });
    }
  };

  for (const line of suggested) {
    if (out.length >= SUGGESTION_TARGET) break;
    takeSearch(line);
  }
  if (out.length < SUGGESTION_TARGET && description.trim()) takeSearch(description);
  if (out.length < SUGGESTION_TARGET) {
    for (const ex of catalogExercisesInRotatedOrder(imageSeed)) {
      if (out.length >= SUGGESTION_TARGET) break;
      if (seen.has(ex.slug)) continue;
      seen.add(ex.slug);
      out.push({
        exercise: ex,
        weight: null,
        weightUnit: "kg",
        confidence: CATALOG_PADDED_CONFIDENCE,
        reasoning: "Catalog",
      });
    }
  }
  return out.slice(0, SUGGESTION_TARGET);
}

function rowsToCandidates(rows: MatchRow[]): ExerciseWeightCandidate[] {
  const out: ExerciseWeightCandidate[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.exerciseSlug === null || !row.exerciseSlug.trim()) continue;
    const slug = row.exerciseSlug.trim().toLowerCase();
    if (seen.has(slug)) continue;
    const exercise = getExerciseBySlug(slug);
    if (!exercise) continue;
    seen.add(slug);
    out.push({
      exercise,
      weight: null,
      weightUnit: "kg",
      confidence: row.confidence,
      reasoning: row.reasoning,
    });
  }
  return out;
}

function primaryFromCandidates(top: ExerciseWeightCandidate | undefined): VisionPrimarySource {
  if (!top) return "equipment_catalog";
  if (top.reasoning !== "Search" && top.reasoning !== "Catalog") return "vision_model";
  return "equipment_catalog";
}

function fallbackFromSearchOnly(
  imageSeed: string,
  userFacingDescription: string,
): {
  description: string;
  suggested: string[];
  candidates: ExerciseWeightCandidate[];
} {
  return {
    description: userFacingDescription,
    suggested: [],
    candidates: padToTarget([], userFacingDescription, [], imageSeed),
  };
}

function normalizeClientCopy(
  description: string,
  suggestedInNaturalLanguage: string[],
  flags: { describeFailed: boolean; hasOpenai: boolean },
): { description: string; suggestedInNaturalLanguage: string[] } {
  const s = description.trim();
  if (s) return { description: s, suggestedInNaturalLanguage };
  if (suggestedInNaturalLanguage.length > 0) {
    return {
      description: `Exercises you might do here: ${suggestedInNaturalLanguage.join(", ")}.`,
      suggestedInNaturalLanguage,
    };
  }
  if (!flags.hasOpenai) {
    return {
      description:
        "Set OPENAI_API_KEY to get a written description of your photo. You can still pick an exercise from the list below.",
      suggestedInNaturalLanguage: [],
    };
  }
  if (flags.describeFailed) {
    return {
      description:
        "We could not read a description for this image. Try another photo, or pick a lift from the list below.",
      suggestedInNaturalLanguage: [],
    };
  }
  return {
    description: "Gym or workout image — pick the lift you are doing below.",
    suggestedInNaturalLanguage: [],
  };
}

function warnVision(phase: string, err: unknown) {
  console.warn(`[vision/recognize] ${phase}`, err instanceof Error ? err.message : err);
}

export type VisionPostDeps = {
  openai: OpenAI | null;
  requireSupabaseUser: typeof requireSupabaseUser;
  visionModel: string;
  matchModel: string;
};

/** Factored for tests — not a Next.js route export. */
export function createVisionPostHandler(deps: VisionPostDeps) {
  return async function handler(request: Request): Promise<Response> {
    const auth = await deps.requireSupabaseUser();
    if ("response" in auth) return auth.response;

    const payload = await request.json();
    const parsed = visionRecognizeSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid image payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { imageBase64, mimeType, sessionExerciseId } = parsed.data;
    const { openai, visionModel, matchModel } = deps;

    const requestStarted = Date.now();
    const imageBytesApprox = Math.floor((imageBase64.length * 3) / 4);
    const imageSeed = imageBase64.length > 0 ? imageBase64.slice(0, 512) : "static";

    let description = "";
    let suggestedInNaturalLanguage: string[] = [];
    let candidates: ExerciseWeightCandidate[] = [];
    let primarySource: VisionPrimarySource = "equipment_catalog";
    const catalogText = buildCatalogText();
    const rawBlobs: { describe?: unknown; match?: unknown } = {};
    let describeFailed = true;

    if (openai) {
      logVision("request", { mimeType, imageBytesApprox });

      let describeResult: { description: string; suggested: string[] } | null = null;
      try {
        const t0 = Date.now();
        const describeCompletion = await openai.responses.create({
          model: visionModel,
          input: [
            { role: "system", content: buildDescribeSystemPrompt() },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "Describe the scene and list plausible exercise names the user could log.",
                },
                {
                  type: "input_image",
                  image_url: `data:${mimeType};base64,${imageBase64}`,
                  detail: "auto",
                },
              ],
            },
          ],
        });

        rawBlobs.describe = describeCompletion;
        const outText = extractTextFromOpenAIResponse(describeCompletion);
        const described = parseDescribeModelOutput(outText);
        if (described.ok) {
          const desc = described.description.trim();
          const sugg = described.suggested.map((s) => s.trim()).filter(Boolean);
          if (desc) {
            describeResult = { description: desc, suggested: sugg };
            describeFailed = false;
          }
        }
        logVision("describe", {
          model: visionModel,
          ms: Date.now() - t0,
          outputChars: outText.length,
          parseOk: described.ok,
          hasDescription: Boolean(describeResult),
          descriptionPreview: describeResult ? describeResult.description.slice(0, 120) : null,
          suggestedCount: describeResult?.suggested.length ?? 0,
        });
      } catch (e) {
        warnVision("describe threw", e);
        describeResult = null;
      }

      if (describeResult) {
        description = describeResult.description;
        suggestedInNaturalLanguage = describeResult.suggested;
        const userMatchPayload = [
          "Scene description:",
          description,
          "",
          "Suggested exercise phrases:",
          JSON.stringify(suggestedInNaturalLanguage),
          "",
          "Catalog (slug:name):",
          catalogText,
        ].join("\n");

        try {
          const t0 = Date.now();
          const matchCompletion = await openai.responses.create({
            model: matchModel,
            input: [
              { role: "system", content: buildMatchSystemPrompt() },
              {
                role: "user",
                content: [{ type: "input_text", text: userMatchPayload }],
              },
            ],
          });

          rawBlobs.match = matchCompletion;
          const matchText = extractTextFromOpenAIResponse(matchCompletion);
          const modelRows = parseMatchModelOutput(matchText);
          const padded = padMatchRows(modelRows, SUGGESTION_TARGET, MATCH_MODEL_ROW_CAP);
          const forRows = padded.slice(0, SUGGESTION_TARGET);
          const matched = rowsToCandidates(forRows);
          candidates = padToTarget(matched, description, suggestedInNaturalLanguage, imageSeed);
          if (candidates[0]) primarySource = primaryFromCandidates(candidates[0]);
          logVision("match", {
            model: matchModel,
            ms: Date.now() - t0,
            outputChars: matchText.length,
            rowsFromModel: modelRows.length,
            candidateCount: candidates.length,
            topSlug: candidates[0]?.exercise.slug ?? null,
            primarySource,
          });
        } catch (e) {
          warnVision("match threw (search padding)", e);
          candidates = padToTarget([], description, suggestedInNaturalLanguage, imageSeed);
          logVision("match_fallback", { candidateCount: candidates.length });
        }
      } else {
        logVision("describe_unusable", { usingSearchFallback: true });
        const fb = fallbackFromSearchOnly(imageSeed, "");
        description = fb.description;
        suggestedInNaturalLanguage = fb.suggested;
        candidates = fb.candidates;
      }
    } else {
      logVision("no_openai", { usingSearchFallback: true });
      const fb = fallbackFromSearchOnly(imageSeed, "");
      description = fb.description;
      suggestedInNaturalLanguage = fb.suggested;
      candidates = fb.candidates;
    }

    const normalized = normalizeClientCopy(description, suggestedInNaturalLanguage, {
      describeFailed,
      hasOpenai: Boolean(openai),
    });
    description = normalized.description;
    suggestedInNaturalLanguage = normalized.suggestedInNaturalLanguage;

    const rawResponse = { ...rawBlobs, describeOut: { description, suggestedInNaturalLanguage } };
    const best = candidates[0];
    let detectionLogged = true;
    try {
      const { error } = await auth.client.from("vision_detections").insert({
        user_id: auth.userId,
        session_exercise_id: sessionExerciseId ?? null,
        image_base64: imageBase64,
        candidates,
        selected_exercise: best?.exercise.name ?? null,
        selected_weight: best?.weight ?? null,
        selected_weight_unit: best?.weightUnit ?? "kg",
        confidence: best?.confidence ?? null,
        model: openai ? `${visionModel}+${matchModel}` : "fallback",
        raw_response: rawResponse,
      });
      if (error) detectionLogged = false;
    } catch {
      detectionLogged = false;
    }

    logVision("done", {
      totalMs: Date.now() - requestStarted,
      describeFailed,
      candidateCount: candidates.length,
      topSlug: candidates[0]?.exercise.slug ?? null,
      detectionLogged,
    });

    return NextResponse.json({
      candidates,
      primarySource,
      equipmentHint: description,
      description,
      suggestedInNaturalLanguage,
      detectionLogged,
    });
  };
}
