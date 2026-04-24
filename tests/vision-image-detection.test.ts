import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getExerciseBySlug, searchExercises } from "@/lib/exercises";

type FixtureExpectation = {
  file: string;
  mimeType: string;
  topSlug: string;
};

const FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures/vision");

/**
 * For each test image, five valid catalog slugs the mocked match step will return
 * (top candidate first, used for "alternatives" shape assertions).
 */
const FIVE_SLUGS_BY_FILE: Record<string, string[]> = {
  "multi-gym-seated-press.png": [
    "chest-press",
    "lat-pulldown",
    "cable-bicep-curl",
    "tricep-pushdown",
    "seated-cable-row",
  ],
  "functional-trainer-cable-rack.png": [
    "lat-pulldown",
    "seated-cable-row",
    "cable-fly",
    "face-pull",
    "cable-bicep-curl",
  ],
  "adjustable-bench.png": [
    "bench-press",
    "dumbbell-bench-press",
    "incline-bench-press",
    "dumbbell-fly",
    "arnold-press",
  ],
  "adjustable-bench-source.avif": [
    "bench-press",
    "dumbbell-bench-press",
    "incline-bench-press",
    "dumbbell-fly",
    "arnold-press",
  ],
  "squat-rack-squat.png": [
    "squat",
    "front-squat",
    "deadlift",
    "romanian-deadlift",
    "military-press",
  ],
  "leg-press-machine.png": [
    "horizontal-leg-press",
    "sled-leg-press",
    "vertical-leg-press",
    "single-leg-press",
    "hack-squat",
  ],
};

const FIXTURE_CASES: FixtureExpectation[] = [
  { file: "multi-gym-seated-press.png", mimeType: "image/png", topSlug: "chest-press" },
  { file: "functional-trainer-cable-rack.png", mimeType: "image/png", topSlug: "lat-pulldown" },
  { file: "adjustable-bench.png", mimeType: "image/png", topSlug: "bench-press" },
  { file: "adjustable-bench-source.avif", mimeType: "image/avif", topSlug: "bench-press" },
  { file: "squat-rack-squat.png", mimeType: "image/png", topSlug: "squat" },
  { file: "leg-press-machine.png", mimeType: "image/png", topSlug: "horizontal-leg-press" },
];

const modelByChecksum = new Map<string, { topSlug: string; file: string; fiveSlugs: string[] }>();

vi.mock("@/lib/supabase/auth", () => ({
  requireSupabaseUser: async () => ({
    userId: "test-user",
    client: {
      from: () => ({
        insert: async () => ({ error: null }),
      }),
    },
  }),
}));

vi.mock("@/lib/ai", () => {
  const state = { lastDescribeChecksum: "" };
  return {
    OPENAI_VISION_MODEL: "test-vision-model",
    OPENAI_VISION_MATCH_MODEL: "test-match-model",
    getOpenAIClient: () => ({
      responses: {
        create: async ({ input }: { input: unknown }) => {
          const entries = input as Array<{
            role: string;
            content: Array<{
              type: string;
              text?: string;
              image_url?: string;
            }>;
          }>;
          const userEntry = entries.find((entry) => entry.role === "user");
          const imageUrl =
            userEntry?.content.find((item) => item.type === "input_image")
              ?.image_url ?? "";
          const base64 = imageUrl.split(",")[1] ?? "";
          if (imageUrl && base64) {
            const cs = createHash("sha1").update(base64).digest("hex");
            state.lastDescribeChecksum = cs;
          }
          const checksum = imageUrl
            ? createHash("sha1").update(base64).digest("hex")
            : state.lastDescribeChecksum;
          const spec = modelByChecksum.get(checksum);
          if (!spec) {
            throw new Error(`No fixture expectation for checksum ${checksum}`);
          }

          if (imageUrl) {
            const nameLike = (slug: string) =>
              getExerciseBySlug(slug)?.name ?? slug.replace(/-/g, " ");
            return {
              output_text: JSON.stringify({
                description: `Fixture equipment for ${spec.file}.`,
                suggestedExercises: spec.fiveSlugs.map((slug) => nameLike(slug)),
              }),
            };
          }

          const rows = spec.fiveSlugs.map((slug, i) => ({
            exerciseSlug: slug,
            confidence: 0.92 - i * 0.01,
            reasoning: "fixture match",
          }));
          return {
            output_text: JSON.stringify(rows),
          };
        },
      },
    }),
  };
});

function collectSlugs(terms: string[]): Set<string> {
  const out = new Set<string>();
  for (const term of terms) {
    for (const exercise of searchExercises(term, 5)) {
      out.add(exercise.slug);
    }
  }
  return out;
}

const BENCH_ALLOWED = collectSlugs([
  "bench press",
  "dumbbell bench press",
  "incline bench press",
  "decline bench press",
  "incline dumbbell press",
  "decline dumbbell press",
  "close grip bench press",
  "floor press",
  "dumbbell fly",
  "dumbbell pullover",
  "seated dumbbell shoulder press",
  "arnold press",
  "dumbbell row",
  "single arm dumbbell row",
  "hip thrust",
  "bulgarian split squat",
]);

const RACK_ALLOWED = collectSlugs([
  "back squat",
  "front squat",
  "barbell squat",
  "zercher squat",
  "paused squat",
  "romanian deadlift",
  "deadlift",
  "conventional deadlift",
  "sumo deadlift",
  "barbell lunge",
  "good morning",
  "hip thrust",
  "overhead press",
  "barbell row",
  "bent over row",
  "squat",
  "military press",
  "romanian deadlift",
]);

beforeAll(() => {
  for (const [file, slugs] of Object.entries(FIVE_SLUGS_BY_FILE)) {
    for (const slug of slugs) {
      if (!getExerciseBySlug(slug)) {
        throw new Error(
          `Invalid slug in FIVE_SLUGS_BY_FILE[${file}]: ${slug}`,
        );
      }
    }
  }
});

describe("vision route image fixtures", () => {
  let post: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    for (const fixture of FIXTURE_CASES) {
      const data = await readFile(path.join(FIXTURES_DIR, fixture.file));
      const base64 = data.toString("base64");
      const checksum = createHash("sha1").update(base64).digest("hex");
      const fiveSlugs = FIVE_SLUGS_BY_FILE[fixture.file];
      if (!fiveSlugs) throw new Error(`Missing FIVE for ${fixture.file}`);
      modelByChecksum.set(checksum, {
        topSlug: fixture.topSlug,
        file: fixture.file,
        fiveSlugs,
      });
    }

    const route = await import("@/app/api/vision/recognize/route");
    post = route.POST;
  });

  it.each(FIXTURE_CASES)(
    "returns top-5 suggestions for $file (two-phase describe + match)",
    async ({ file, mimeType, topSlug }) => {
      const buffer = await readFile(path.join(FIXTURES_DIR, file));
      const imageBase64 = buffer.toString("base64");

      const response = await post(
        new Request("http://localhost/api/vision/recognize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64, mimeType }),
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        candidates: Array<{ exercise: { slug: string } }>;
        primarySource: "vision_model" | "equipment_catalog";
        description: string;
        suggestedInNaturalLanguage: string[];
      };
      expect(body.candidates).toHaveLength(5);
      expect(body.candidates[0]?.exercise.slug).toBe(topSlug);
      expect(body.description.length).toBeGreaterThan(0);
      expect(body.suggestedInNaturalLanguage.length).toBeGreaterThan(0);
    },
  );

  it("keeps bench-only alternatives for bench fixture", async () => {
    const fixture = FIXTURE_CASES.find((item) => item.file === "adjustable-bench.png");
    if (!fixture) throw new Error("Missing bench fixture");
    const buffer = await readFile(path.join(FIXTURES_DIR, fixture.file));
    const imageBase64 = buffer.toString("base64");
    const response = await post(
      new Request("http://localhost/api/vision/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mimeType: fixture.mimeType }),
      }),
    );
    const body = (await response.json()) as {
      candidates: Array<{ exercise: { slug: string } }>;
    };
    const alternativeSlugs = body.candidates.slice(1).map((c) => c.exercise.slug);
    expect(alternativeSlugs.every((slug) => BENCH_ALLOWED.has(slug))).toBe(true);
  });

  it("keeps rack-only alternatives for rack fixture", async () => {
    const fixture = FIXTURE_CASES.find((item) => item.file === "squat-rack-squat.png");
    if (!fixture) throw new Error("Missing rack fixture");
    const buffer = await readFile(path.join(FIXTURES_DIR, fixture.file));
    const imageBase64 = buffer.toString("base64");
    const response = await post(
      new Request("http://localhost/api/vision/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mimeType: fixture.mimeType }),
      }),
    );
    const body = (await response.json()) as {
      candidates: Array<{ exercise: { slug: string } }>;
    };
    const alternativeSlugs = body.candidates.slice(1).map((c) => c.exercise.slug);
    expect(alternativeSlugs.every((slug) => RACK_ALLOWED.has(slug))).toBe(true);
  });
});
