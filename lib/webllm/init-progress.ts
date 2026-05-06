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

/**
 * `@mlc-ai/web-llm` reports distinct copy for **downloading shards into Cache Storage**
 * (`Fetching param cache[…]` + `…MB fetched`) vs **reading cached shards onto WebGPU**
 * (`Loading model from cache[…]` + `…MB loaded`). Use this to decide when a full-screen
 * blocking overlay is appropriate.
 *
 * See `ArtifactCacheInstaller.fetchTensorCacheInternal` in the web-llm bundle (~`Fetching param cache`).
 */
export function webllmProgressIndicatesNetworkParamFetch(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^fetching param cache\[/i.test(t)) return true;
  // Download branch uses "fetched"; cache read branch uses "loaded".
  if (/\d+MB fetched\./i.test(t)) return true;
  return false;
}

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

/** Last raw init line survives until next load or consume (sessionStorage survives short tab flicker worse than localStorage; use session). */
const SS_KEY_LAST = "gym.webllm.last_init_progress_v1";

export type LastWebllmInitProgress = {
  progress: number;
  timeElapsed: number;
  text: string;
  t: number;
  phase: ReturnType<typeof classifyWebllmInitProgressPhase>;
};

/** Writes on every callback (unthrottled) so kills mid-step still have the last label. */
export function recordLastWebllmInitProgress(report: {
  progress: number;
  timeElapsed: number;
  text: string;
}): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const snapshot: LastWebllmInitProgress = {
      ...report,
      t: Date.now(),
      phase: classifyWebllmInitProgressPhase(report.text || ""),
    };
    sessionStorage.setItem(SS_KEY_LAST, JSON.stringify(snapshot));
  } catch {
    // Quota or private mode
  }
}

export function clearLastWebllmInitProgress(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(SS_KEY_LAST);
  } catch {
    // ignore
  }
}

export function readLastWebllmInitProgress(): LastWebllmInitProgress | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SS_KEY_LAST);
    if (!raw) return null;
    const o = JSON.parse(raw) as LastWebllmInitProgress;
    if (typeof o.progress !== "number" || typeof o.text !== "string") return null;
    return o;
  } catch {
    return null;
  }
}
