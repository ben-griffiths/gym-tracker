import type { MLCEngineInterface, ResponseFormat } from "@mlc-ai/web-llm";
import { chatCompletion } from "@/lib/webllm/chat-text";
import {
  validatePrimitive,
  type Primitive,
} from "@/lib/workout-chat/primitive-builders";

export type DecomposerOutput = { primitives: Primitive[] };

const SYSTEM = `You convert a user's gym chat message into a list of primitive intents.

Output ONLY valid JSON matching the schema. No prose. No markdown. No code fences.

The shape is { "primitives": [Primitive, ...] }. Each Primitive is one of:

{ "type": "log_new", "lift": "<word(s)>", "sets": <int 1..20>, "reps": <int 1..100>, "weight": <number, optional>, "unit": "kg"|"lb" optional }
{ "type": "append_more", "count": <int 1..10>, "weight": <number, optional>, "unit": "kg"|"lb" optional }
{ "type": "add_warmups", "count": <int 1..10> }
{ "type": "update_last_set", "reps": <optional>, "weight": <optional>, "unit": <optional> }
{ "type": "update_set", "index": <int 1..20>, "reps": <optional>, "weight": <optional>, "unit": <optional> }
{ "type": "delete_last" }
{ "type": "delete_set", "index": <int 1..20> }
{ "type": "switch_exercise", "slug": "<one of ALLOWED_SLUGS>" }
{ "type": "noop" }

Rules:
- Decompose composite messages into MULTIPLE primitives in order.
- Do NOT invent reps, weights, units, set counts, or warmup loads. Omit unknown fields.
- "set:N" / "the second set" / "first set" map to update_set.index / delete_set.index. The index counts ALL set rows from the top, including warmups.
- "switch_exercise" slug MUST appear in ALLOWED_SLUGS. If unsure, emit "noop" instead.
- If the message is purely conversational (greeting, question, "make it heavier" with no number), emit one "noop".
- Output is one JSON object — never an array at the top, never any prose.`;

const FEW_SHOTS: Array<{ user: string; assistant: string }> = [
  {
    user: 'CURRENT_XML\n<workout exercise=""></workout>\n\nLIKELY_EXERCISE\n(none)\n\nALLOWED_SLUGS\nbench-press\n\nUSER_MESSAGE\nbench 5x5 100kg',
    assistant:
      '{"primitives":[{"type":"log_new","lift":"bench","sets":5,"reps":5,"weight":100,"unit":"kg"}]}',
  },
  {
    user: 'CURRENT_XML\n<workout exercise=""></workout>\n\nLIKELY_EXERCISE\n(none)\n\nALLOWED_SLUGS\nbench-press\n\nUSER_MESSAGE\nbench 5x5 100kg 2 warmup sets',
    assistant:
      '{"primitives":[{"type":"log_new","lift":"bench","sets":5,"reps":5,"weight":100,"unit":"kg"},{"type":"add_warmups","count":2}]}',
  },
  {
    user: 'CURRENT_XML\n<workout exercise="bench-press"><s n="1" kind="working" r="5" w="100" u="kg"/></workout>\n\nLIKELY_EXERCISE\nbench-press\n\nALLOWED_SLUGS\nbench-press\n\nUSER_MESSAGE\none more @ 105',
    assistant:
      '{"primitives":[{"type":"append_more","count":1,"weight":105,"unit":"kg"}]}',
  },
  {
    user: 'CURRENT_XML\n<workout exercise="bench-press"><s n="1" kind="working" r="5" w="100" u="kg"/></workout>\n\nLIKELY_EXERCISE\nbench-press\n\nALLOWED_SLUGS\nbench-press\n\nUSER_MESSAGE\nmake that 102.5 actually',
    assistant:
      '{"primitives":[{"type":"update_last_set","weight":102.5,"unit":"kg"}]}',
  },
  {
    user: 'CURRENT_XML\n<workout exercise="bench-press"><s n="1" kind="working" r="5" w="100" u="kg"/><s n="2" kind="working" r="5" w="100" u="kg"/></workout>\n\nLIKELY_EXERCISE\nbench-press\n\nALLOWED_SLUGS\nbench-press\n\nUSER_MESSAGE\nscrap the last set',
    assistant: '{"primitives":[{"type":"delete_last"}]}',
  },
  {
    user: 'CURRENT_XML\n<workout exercise="bench-press"><s n="1" kind="working" r="5" w="100" u="kg"/></workout>\n\nLIKELY_EXERCISE\nbench-press\n\nALLOWED_SLUGS\nbench-press\nincline-dumbbell-bench-press\n\nUSER_MESSAGE\nswitch to incline dumbbell bench press',
    assistant:
      '{"primitives":[{"type":"switch_exercise","slug":"incline-dumbbell-bench-press"}]}',
  },
  {
    user: 'CURRENT_XML\n<workout exercise="bench-press"><s n="1" kind="working" r="5" w="100" u="kg"/></workout>\n\nLIKELY_EXERCISE\nbench-press\n\nALLOWED_SLUGS\nbench-press\n\nUSER_MESSAGE\nadd a warmup and bump the last set to 110',
    assistant:
      '{"primitives":[{"type":"add_warmups","count":1},{"type":"update_last_set","weight":110,"unit":"kg"}]}',
  },
  {
    user: 'CURRENT_XML\n<workout exercise="bench-press"><s n="1" kind="working" r="5" w="100" u="kg"/></workout>\n\nLIKELY_EXERCISE\nbench-press\n\nALLOWED_SLUGS\nbench-press\n\nUSER_MESSAGE\nmake it heavier',
    assistant: '{"primitives":[{"type":"noop"}]}',
  },
];

const PRIMITIVES_JSON_SCHEMA = JSON.stringify({
  type: "object",
  required: ["primitives"],
  additionalProperties: false,
  properties: {
    primitives: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        required: ["type"],
        properties: {
          type: {
            type: "string",
            enum: [
              "log_new",
              "append_more",
              "add_warmups",
              "update_last_set",
              "update_set",
              "delete_last",
              "delete_set",
              "switch_exercise",
              "noop",
            ],
          },
          lift: { type: "string" },
          sets: { type: "integer", minimum: 1, maximum: 20 },
          reps: { type: "integer", minimum: 1, maximum: 100 },
          count: { type: "integer", minimum: 1, maximum: 10 },
          index: { type: "integer", minimum: 1, maximum: 20 },
          weight: { type: "number", minimum: 0, maximum: 1000 },
          unit: { type: "string", enum: ["kg", "lb"] },
          slug: { type: "string" },
        },
      },
    },
  },
});

const RESPONSE_FORMAT: ResponseFormat = {
  type: "json_object",
  schema: PRIMITIVES_JSON_SCHEMA,
};

function buildUserPayload(parts: {
  message: string;
  previousXml: string;
  likelyExerciseSlug: string;
  allowedSlugs: string[];
}): string {
  return [
    "CURRENT_XML",
    parts.previousXml,
    "",
    "LIKELY_EXERCISE",
    parts.likelyExerciseSlug || "(none)",
    "",
    "ALLOWED_SLUGS",
    parts.allowedSlugs.length > 0 ? parts.allowedSlugs.join("\n") : "(none)",
    "",
    "USER_MESSAGE",
    parts.message,
  ].join("\n");
}

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip code fences if the model leaked them despite the prompt.
  const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(trimmed);
  const body = fenced ? fenced[1]!.trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    // Try to recover: take the first balanced top-level object.
    const start = body.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < body.length; i += 1) {
      const c = body[i]!;
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(body.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

/**
 * Run the LLM decomposer once. Returns a validated list of primitives or
 * `null` if the model fails to produce anything we can use. The caller
 * decides whether to fall back (e.g. to a single `noop` suggestion).
 */
export async function decomposeUserMessage(params: {
  engine: MLCEngineInterface;
  message: string;
  previousXml: string;
  likelyExerciseSlug: string;
  allowedSlugs: string[];
}): Promise<DecomposerOutput | null> {
  const userPayload = buildUserPayload({
    message: params.message,
    previousXml: params.previousXml,
    likelyExerciseSlug: params.likelyExerciseSlug,
    allowedSlugs: params.allowedSlugs,
  });

  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: SYSTEM },
    ...FEW_SHOTS.flatMap((shot) => [
      { role: "user" as const, content: shot.user },
      { role: "assistant" as const, content: shot.assistant },
    ]),
    { role: "user", content: userPayload },
  ];

  const completion = await chatCompletion({
    engine: params.engine,
    messages,
    maxTokens: 256,
    temperature: 0,
    responseFormat: RESPONSE_FORMAT,
    omitPayloadLog: false,
  });

  if (!completion.text.trim()) return null;
  const parsed = tryParseJson(completion.text);
  if (parsed === null || typeof parsed !== "object") return null;

  const primitivesRaw = (parsed as { primitives?: unknown }).primitives;
  if (!Array.isArray(primitivesRaw)) return null;

  const allowedSet = new Set(params.allowedSlugs);
  const primitives: Primitive[] = [];
  for (const raw of primitivesRaw) {
    const validated = validatePrimitive(raw, allowedSet);
    if (validated) primitives.push(validated);
  }
  if (primitives.length === 0) return null;
  return { primitives };
}
