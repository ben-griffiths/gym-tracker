import type { ChatOptions } from "@mlc-ai/web-llm";
import { prefersLowResourceWebLLM } from "@/lib/webllm-capability";

/** Fixed WebLLM checkpoint (Hermes‑2 Mistral 7B). No env overrides — avoids drift between hosts */
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
 */
export function resolveWebLLMChatOptions(): ChatOptions | undefined {
  if (typeof window === "undefined") return undefined;
  if (!prefersLowResourceWebLLM()) return undefined;
  return { context_window_size: 2048 };
}

/** @deprecated use resolveWebLLMModelId */
export function getPublicWebLLMModelId(): string {
  return resolveWebLLMModelId();
}
