import { NextResponse } from "next/server";
import { z } from "zod";
import { getOpenAIClient, OPENAI_VISION_MODEL } from "@/lib/ai";
import {
  EXERCISES,
  getExerciseBySlug,
  searchExercises,
} from "@/lib/exercises";
import { requireSupabaseUser } from "@/lib/supabase/auth";
import { visionRecognizeSchema } from "@/lib/validators/workout";
import type {
  ExerciseRecord,
  ExerciseWeightCandidate,
} from "@/lib/types/workout";

export const dynamic = "force-dynamic";

const rawVisionCandidateSchema = z.object({
  exerciseSlug: z.string().optional().default(""),
  exerciseQuery: z.string().optional().default(""),
  weight: z.number().nullable().optional(),
  weightUnit: z.enum(["kg", "lb"]).default("kg"),
  confidence: z.number().min(0).max(1).default(0.5),
  reasoning: z.string().optional(),
});

const visionResponseSchema = z.object({
  candidates: z.array(rawVisionCandidateSchema).min(1).max(5),
});

function buildVisionPrompt() {
  const catalog = EXERCISES.map((entry) => `${entry.slug}:${entry.name}`).join(
    "\n",
  );
  return [
    "You identify gym exercises from an image.",
    "Return valid JSON only without markdown.",
    "Always choose exercises from the provided catalog — never invent new ones.",
    "For each candidate pick an exerciseSlug from the catalog. Include exerciseQuery as a fallback guess only if no slug fits.",
    "Response shape:",
    `{"candidates":[{"exerciseSlug":"<slug>","exerciseQuery":"","weight":<number|null>,"weightUnit":"kg"|"lb","confidence":<0..1>,"reasoning":"<short>"}]}`,
    "Include 1-5 candidates ordered by confidence.",
    "",
    "Catalog (slug:name):",
    catalog,
  ].join("\n");
}

function resolveCandidate(
  raw: z.infer<typeof rawVisionCandidateSchema>,
): ExerciseRecord | null {
  if (raw.exerciseSlug) {
    const direct = getExerciseBySlug(raw.exerciseSlug);
    if (direct) return direct;
  }
  const query = raw.exerciseQuery || raw.exerciseSlug.replace(/-/g, " ");
  const match = searchExercises(query, 1)[0];
  return match ?? null;
}

function fallbackCandidates(): ExerciseWeightCandidate[] {
  const preferredSlugs = ["bench-press", "squat", "deadlift"];
  return preferredSlugs
    .map((slug) => getExerciseBySlug(slug))
    .filter((value): value is ExerciseRecord => value !== null)
    .map((exercise, index) => ({
      exercise,
      weight: null,
      weightUnit: "kg" as const,
      confidence: Math.max(0.1, 0.4 - index * 0.1),
      reasoning: "Fallback suggestion",
    }));
}

export async function POST(request: Request) {
  const auth = await requireSupabaseUser();
  if ("response" in auth) return auth.response;

  const payload = await request.json();
  const parsed = visionRecognizeSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid image payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let candidates: ExerciseWeightCandidate[] = fallbackCandidates();
  let rawResponse: unknown = null;
  const openai = getOpenAIClient();

  if (openai) {
    try {
      const completion = await openai.responses.create({
        model: OPENAI_VISION_MODEL,
        input: [
          { role: "system", content: buildVisionPrompt() },
          {
            role: "user",
            content: [
              { type: "input_text", text: "Analyze this gym set image." },
              {
                type: "input_image",
                image_url: `data:${parsed.data.mimeType};base64,${parsed.data.imageBase64}`,
                detail: "auto",
              },
            ],
          },
        ],
      });

      rawResponse = completion;
      const parsedJson = JSON.parse(completion.output_text.trim());
      const body = visionResponseSchema.parse(parsedJson);

      const resolved: ExerciseWeightCandidate[] = [];
      const seen = new Set<string>();
      for (const raw of body.candidates) {
        const exercise = resolveCandidate(raw);
        if (!exercise || seen.has(exercise.slug)) continue;
        seen.add(exercise.slug);
        resolved.push({
          exercise,
          weight: raw.weight ?? null,
          weightUnit: raw.weightUnit,
          confidence: raw.confidence,
          reasoning: raw.reasoning,
        });
      }

      if (resolved.length > 0) {
        candidates = resolved.slice(0, 5);
      }
    } catch {
      candidates = fallbackCandidates();
    }
  }

  const best = candidates[0];
  let detectionLogged = true;
  try {
    const { error } = await auth.client.from("vision_detections").insert({
      user_id: auth.userId,
      session_exercise_id: parsed.data.sessionExerciseId ?? null,
      image_base64: parsed.data.imageBase64,
      candidates,
      selected_exercise: best?.exercise.name ?? null,
      selected_weight: best?.weight ?? null,
      selected_weight_unit: best?.weightUnit ?? "kg",
      confidence: best?.confidence ?? null,
      model: openai ? OPENAI_VISION_MODEL : "fallback",
      raw_response: rawResponse ?? null,
    });
    if (error) {
      detectionLogged = false;
    }
  } catch {
    detectionLogged = false;
  }

  return NextResponse.json({
    candidates,
    detectionLogged,
  });
}
