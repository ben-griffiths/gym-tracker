import type { ChatOptions } from "@mlc-ai/web-llm";
import { prefersLowResourceWebLLM } from "@/lib/webllm-capability";

/**
 * Single global WebLLM checkpoint. Pinned to **`Hermes-2-Pro-Mistral-7B-q4f16_1-MLC`** —
 * the smallest model in `@mlc-ai/web-llm`'s `functionCallingModelIds` set for this package
 * version, so `chat.completions.create` with `tools` (see `lib/chat-agent.ts`) keeps working.
 * **Product policy:** The same Hermes 7B ID ships on **desktop and mobile**. Dropping to a smaller
 * prebuilt requires either giving up **`tools`/function calling** until MLC lists that model ID, or a
 * second code path—not enabled here.
 */
export const WEBLLM_MODEL_ID = "Hermes-2-Pro-Mistral-7B-q4f16_1-MLC";

/** @deprecated use WEBLLM_MODEL_ID / resolveWebLLMModelId */
export const DEFAULT_WEBLLM_MODEL_ID_MOBILE = WEBLLM_MODEL_ID;
/** @deprecated use WEBLLM_MODEL_ID */
export const DEFAULT_WEBLLM_MODEL_ID_DESKTOP = WEBLLM_MODEL_ID;
/** @deprecated use WEBLLM_MODEL_ID */
export const DEFAULT_WEBLLM_MODEL_ID = WEBLLM_MODEL_ID;

/** Always returns {@link WEBLLM_MODEL_ID}. Invoke from browser codepaths only. */
export function resolveWebLLMModelId(): string {
  return WEBLLM_MODEL_ID;
}

/**
 * Tighter context on phones to reduce WebGPU memory (KV cache) after load.
 * Production builds use a smaller window than local dev: Vercel is a new origin
 * with a cold cache, so the first load is heavier; less KV helps avoid GPU OOM.
 */
export function resolveWebLLMChatOptions(): ChatOptions | undefined {
  if (typeof window === "undefined") return undefined;
  if (!prefersLowResourceWebLLM()) return undefined;
  const context_window_size =
    typeof process !== "undefined" && process.env.NODE_ENV === "production"
      ? 1024
      : 2048;
  return { context_window_size };
}

/** @deprecated use resolveWebLLMModelId */
export function getPublicWebLLMModelId(): string {
  return resolveWebLLMModelId();
}
