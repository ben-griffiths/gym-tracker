import { ZodError } from "zod";
import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import {
  assembleSuggestion,
  buildSystemPrompt,
  extractToolCallsFromChatCompletion,
  getChatCompletionsTools,
  parseFallbackSuggestion,
  summariseContext,
} from "@/lib/chat-agent";
import type { ChatContext, ChatSetSuggestion } from "@/lib/types/workout";

/**
 * In-browser chat path: WebLLM Chat Completions + shared assembleSuggestion / fallbacks.
 */
export async function runChatAgentWebLLM(
  engine: MLCEngineInterface,
  input: { message: string; context: ChatContext | undefined },
): Promise<{
  suggestion: ChatSetSuggestion;
  source: "webllm" | "fallback";
  detail?: unknown;
}> {
  const { message, context } = input;
  const fallback = parseFallbackSuggestion(message, context);

  try {
    const completion = await engine.chat.completions.create({
      stream: false,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "system",
          content: `Chat context:\n${summariseContext(context)}`,
        },
        { role: "user", content: message },
      ],
      tools: getChatCompletionsTools(),
      tool_choice: "auto",
    });

    const toolCalls = extractToolCallsFromChatCompletion(completion);
    if (toolCalls.length === 0) {
      const first = (completion as { choices?: unknown[] }).choices?.[0] as
        | { message?: { content?: string | null } }
        | undefined;
      const freeform = first?.message?.content?.trim();
      if (freeform) {
        return {
          suggestion: { ...fallback, reply: freeform },
          source: "webllm",
        };
      }
      return { suggestion: fallback, source: "fallback" };
    }

    const suggestion = assembleSuggestion({
      message,
      context,
      toolCalls,
      fallback,
    });
    return { suggestion, source: "webllm" };
  } catch (error) {
    const detail =
      error instanceof ZodError
        ? error.flatten()
        : "LLM parse failed, fallback used";
    return { suggestion: fallback, source: "fallback", detail };
  }
}
