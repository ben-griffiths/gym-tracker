import { getOpenAIClient, OPENAI_VISION_MODEL, OPENAI_VISION_MATCH_MODEL } from "@/lib/vision/openai";
import { requireSupabaseUser } from "@/lib/supabase/auth";
import { createVisionPostHandler } from "@/lib/vision/recognize-post";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return createVisionPostHandler({
    openai: getOpenAIClient(),
    requireSupabaseUser,
    visionModel: OPENAI_VISION_MODEL,
    matchModel: OPENAI_VISION_MATCH_MODEL,
  })(request);
}
