import { classifyWebllmInitProgressPhase } from "@/lib/webllm-progress-phase";

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
