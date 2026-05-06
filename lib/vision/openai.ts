import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return client;
}

export const OPENAI_VISION_MODEL =
  process.env.OPENAI_VISION_DESCRIBE_MODEL ?? "gpt-5.4";
/** Text-only: map free-text exercise ideas to catalog slugs. */
export const OPENAI_VISION_MATCH_MODEL =
  process.env.OPENAI_VISION_MATCH_MODEL ?? "gpt-4.1-mini";
