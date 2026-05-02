import { ZodError } from "zod";
import type { ChatCompletionRequest, MLCEngineInterface } from "@mlc-ai/web-llm";
import {
  assembleSuggestion,
  buildSystemPrompt,
  buildWebLLMToolProtocolPrompt,
  extractToolCallsFromContent,
  parseFallbackSuggestion,
  summariseContext,
} from "@/lib/chat-agent";
import type { ChatContext, ChatSetSuggestion } from "@/lib/types/workout";

/**
 * In-browser chat path: WebLLM Chat Completions + shared assembleSuggestion / fallbacks.
 *
 * The pinned model (Llama-3.2-1B-Instruct) is NOT in MLC's `functionCallingModelIds`,
 * so we cannot use `tools`/`tool_choice`. Instead we describe the available tools in
 * the system prompt using Meta's documented zero-shot JSON tool-calling format and
 * parse the assistant content with `extractToolCallsFromContent`. We also try to
 * constrain output to JSON via WebLLM's `response_format`, falling back to plain
 * decoding if the engine rejects it. Errors fall through to the deterministic local
 * parser (`parseFallbackSuggestion`).
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

  // Llama 3.2's chat template wraps a single `system` header — concatenate our
  // domain rules, the Meta-format tool spec, and the chat-context summary into
  // one system message so the rendered template stays canonical.
  const systemContent = [
    buildSystemPrompt(),
    "",
    buildWebLLMToolProtocolPrompt(),
    "",
    `Chat context:\n${summariseContext(context)}`,
  ].join("\n");

  const baseRequest: ChatCompletionRequest = {
    stream: false,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: message },
    ],
    temperature: 0,
    top_p: 1,
    max_tokens: 512,
  };

  try {
    let completion: unknown;
    try {
      completion = await engine.chat.completions.create({
        ...baseRequest,
        response_format: { type: "json_object" },
      });
    } catch {
      // Some wasm builds don't ship the JSON-grammar runtime. Retry without it.
      completion = await engine.chat.completions.create(baseRequest);
    }

    const first = (completion as { choices?: unknown[] }).choices?.[0] as
      | { message?: { content?: string | null } }
      | undefined;
    const content = first?.message?.content ?? "";
    const toolCalls = extractToolCallsFromContent(content);

    if (toolCalls.length === 0) {
      const freeform = content.trim();
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
