import type { ChatOptions } from "@mlc-ai/web-llm";
import { prefersLowResourceWebLLM } from "@/lib/webllm-capability";

/**
 * Default desktop: Hermes-2 Pro 8B (tool calling). ~5GB VRAM.
 * Default mobile: Hermes-2 Pro Mistral 7B q4f16 — still in `functionCallingModelIds`, lower VRAM.
 * Override with `NEXT_PUBLIC_WEBLLM_MODEL` (see README).
 */
export const DEFAULT_WEBLLM_MODEL_ID_DESKTOP =
  "Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC";
export const DEFAULT_WEBLLM_MODEL_ID_MOBILE =
  "Hermes-2-Pro-Mistral-7B-q4f16_1-MLC";

/** @deprecated use resolveWebLLMModelId in browser; kept for bundle string search */
export const DEFAULT_WEBLLM_MODEL_ID = DEFAULT_WEBLLM_MODEL_ID_DESKTOP;

function envModelId(): string | null {
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_WEBLLM_MODEL &&
    process.env.NEXT_PUBLIC_WEBLLM_MODEL.trim() !== ""
  ) {
    return process.env.NEXT_PUBLIC_WEBLLM_MODEL.trim();
  }
  return null;
}

/**
 * Picks the model at runtime. Call only from the client (workout + provider).
 */
export function resolveWebLLMModelId(): string {
  const fromEnv = envModelId();
  if (fromEnv) return fromEnv;
  if (typeof window === "undefined") return DEFAULT_WEBLLM_MODEL_ID_DESKTOP;
  return prefersLowResourceWebLLM()
    ? DEFAULT_WEBLLM_MODEL_ID_MOBILE
    : DEFAULT_WEBLLM_MODEL_ID_DESKTOP;
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
