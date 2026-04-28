/**
 * Best-effort labels for [`InitProgressReport.text`](https://webllm.mlc.ai/) from WebLLM.
 * Used when diagnosing silent tab kills (~33%) where JS never throws — compare last line to MLC internals.
 */

export type WebllmInitProgressPhase =
  | "fetch_cache"
  | "compile_gpu"
  | "weight_load"
  | "finalize"
  | "unknown";

const lower = (s: string) => s.toLowerCase();

/** Map latest progress line to a coarse phase bucket (not stable across `@mlc-ai/web-llm` versions). */
export function classifyWebllmInitProgressPhase(text: string): WebllmInitProgressPhase {
  const t = lower(text.trim());
  if (!t) return "unknown";

  if (/complete|finish|successful|already loaded|reload done/i.test(t)) {
    return "finalize";
  }
  if (/\bcompile\b|relax| tvm|wasm|kernels|attention|sampler|embedding|executable/i.test(t)) {
    return "compile_gpu";
  }
  if (/weight|ndarray|param|loading.*model/i.test(t)) {
    return "weight_load";
  }
  if (/fetch|download|cached|shard|megabyte|percent completed|tokenizer/i.test(t)) {
    return "fetch_cache";
  }
  return "unknown";
}
