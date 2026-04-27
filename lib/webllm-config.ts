/**
 * Default model is one of WebLLM’s `functionCallingModelIds` (Hermes-2 Pro for tool calling).
 * Override with `NEXT_PUBLIC_WEBLLM_MODEL` (see README).
 */
export const DEFAULT_WEBLLM_MODEL_ID = "Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC";

export function getPublicWebLLMModelId(): string {
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_WEBLLM_MODEL &&
    process.env.NEXT_PUBLIC_WEBLLM_MODEL.trim() !== ""
  ) {
    return process.env.NEXT_PUBLIC_WEBLLM_MODEL.trim();
  }
  return DEFAULT_WEBLLM_MODEL_ID;
}
