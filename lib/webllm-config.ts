import type { ChatOptions } from "@mlc-ai/web-llm";
import { prefersLowResourceWebLLM } from "@/lib/webllm-capability";

/**
 * Single global WebLLM checkpoint. Pinned to **`Llama-3.2-1B-Instruct-q4f16_1-MLC`** —
 * a compact (~700 MB) prebuilt that's listed in `@mlc-ai/web-llm`'s `prebuiltAppConfig` for
 * the pinned package version. It is **not** in MLC's `functionCallingModelIds`, so
 * `chat.completions.create({ tools, tool_choice })` cannot be used; tool calls are emitted
 * via a manual JSON-output protocol — see `runChatAgentWebLLM` in `lib/workout-chat-webllm.ts`.
 * Same checkpoint on desktop and mobile.
 */
export const WEBLLM_MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

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
