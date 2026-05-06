import type { MLCEngineInterface, ResponseFormat } from "@mlc-ai/web-llm";
import { webllmLog, webllmLogChatCompletionsRequestFull } from "@/lib/webllm/client-log";

export type TextChatParams = {
  engine: MLCEngineInterface;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  /**
   * When true, skip full payload log (caller already logged the same object).
   */
  omitPayloadLog?: boolean;
};

export type ChatMessagesParams = {
  engine: MLCEngineInterface;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  maxTokens: number;
  temperature?: number;
  /** If the engine ignores unknown fields, this is harmless. */
  stop?: string[];
  /**
   * Optional structured-output constraint (e.g. grammar EBNF). On runtime
   * grammar errors the call retries once without `response_format` so a
   * model/runtime mismatch never breaks a chat turn.
   */
  responseFormat?: ResponseFormat;
  /**
   * Sample logprobs on this call. The engine returns top-N logprobs per
   * token in `choices[0].logprobs`; we surface them via the return value.
   */
  logprobs?: boolean;
  topLogprobs?: number;
  omitPayloadLog?: boolean;
};

type CompletionCreateArgs = {
  stream: false;
  messages: ChatMessagesParams["messages"];
  temperature: number;
  max_tokens: number;
  stop?: string[];
  response_format?: ResponseFormat;
  logprobs?: boolean;
  top_logprobs?: number;
};

export type ChatCompletionResult = {
  /** Trimmed assistant message content. Empty string on failure. */
  text: string;
  /** Mean token logprob (lower = less confident). null if not requested or unavailable. */
  meanLogprob: number | null;
  /** True when the call retried without grammar constraint after a runtime error. */
  grammarFallback: boolean;
};

function getCompletionText(completion: unknown): string {
  return (
    (completion as { choices?: Array<{ message?: { content?: string | null } }> })
      .choices?.[0]?.message?.content ?? ""
  ).trim();
}

function getMeanLogprob(completion: unknown): number | null {
  type LogprobEntry = { logprob?: number | null };
  const choice = (completion as {
    choices?: Array<{ logprobs?: { content?: LogprobEntry[] | null } | null }>;
  }).choices?.[0];
  const entries = choice?.logprobs?.content;
  if (!entries || entries.length === 0) return null;
  let sum = 0;
  let count = 0;
  for (const entry of entries) {
    if (typeof entry.logprob === "number" && Number.isFinite(entry.logprob)) {
      sum += entry.logprob;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

/**
 * Multi-turn chat completion (few-shot + user). Returns full result with
 * grammar-fallback signal and mean logprob for accuracy telemetry.
 */
export async function chatCompletion(
  params: ChatMessagesParams,
): Promise<ChatCompletionResult> {
  const {
    engine,
    messages,
    maxTokens,
    temperature = 0.7,
    stop,
    responseFormat,
    logprobs,
    topLogprobs,
    omitPayloadLog = false,
  } = params;

  const baseArgs: CompletionCreateArgs = {
    stream: false,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(stop && stop.length > 0 ? { stop } : {}),
    ...(logprobs ? { logprobs: true, top_logprobs: topLogprobs ?? 5 } : {}),
  };

  const argsWithFormat: CompletionCreateArgs = responseFormat
    ? { ...baseArgs, response_format: responseFormat }
    : baseArgs;

  if (!omitPayloadLog) {
    webllmLogChatCompletionsRequestFull(
      "chatCompletion: LLM request",
      argsWithFormat,
    );
  } else {
    webllmLog(
      "chatCompletion: invoking engine (full request logged earlier this turn)",
      {},
      { force: true },
    );
    console.warn(
      "[webllm] chatCompletion: invoking engine.chat.completions.create — see earlier workout-chat log",
    );
  }

  const callEngine = async (
    args: CompletionCreateArgs,
  ): Promise<ChatCompletionResult> => {
    const completion = await engine.chat.completions.create(
      args as Parameters<
        MLCEngineInterface["chat"]["completions"]["create"]
      >[0],
    );
    return {
      text: getCompletionText(completion),
      meanLogprob: logprobs ? getMeanLogprob(completion) : null,
      grammarFallback: false,
    };
  };

  try {
    return await callEngine(argsWithFormat);
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError";
    const message = err instanceof Error ? err.message : String(err);
    webllmLog(
      "chatCompletion: error",
      { name, message: message.slice(0, 200) },
      { force: true },
    );

    if (responseFormat) {
      try {
        const fallback = await callEngine(baseArgs);
        webllmLog(
          "chatCompletion: grammar fallback succeeded",
          { name },
          { force: true },
        );
        return { ...fallback, grammarFallback: true };
      } catch (fallbackErr) {
        const fbName = fallbackErr instanceof Error ? fallbackErr.name : "UnknownError";
        const fbMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        webllmLog(
          "chatCompletion: fallback error",
          { name: fbName, message: fbMessage.slice(0, 200) },
          { force: true },
        );
      }
    }
    return { text: "", meanLogprob: null, grammarFallback: false };
  }
}

/**
 * Multi-turn chat completion that returns just the trimmed string. Kept for
 * call sites that don't need logprobs / grammar telemetry.
 */
export async function chatCompletionText(
  params: ChatMessagesParams,
): Promise<string> {
  const result = await chatCompletion(params);
  return result.text;
}

/**
 * Free-text call — no schema, just a plain assistant reply.
 */
export async function chatText(params: TextChatParams): Promise<string> {
  const { engine, system, user, maxTokens, temperature = 0.7, omitPayloadLog = false } =
    params;
  return chatCompletionText({
    engine,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens,
    temperature,
    omitPayloadLog,
  });
}
