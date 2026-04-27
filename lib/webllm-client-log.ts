/**
 * Client-only logging for WebLLM / Safari Web Inspector.
 *
 * Verbose logging (any build):
 *   localStorage.setItem("gym.webllm.log", "1"); location.reload();
 * Or set NEXT_PUBLIC_WEBLLM_LOG=1 and rebuild.
 *
 * In development, verbose is on by default.
 */

const LS_KEY = "gym.webllm.log";

export function isWebllmClientLogEnabled(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  if (
    typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_WEBLLM_LOG === "1" ||
      process.env.NEXT_PUBLIC_WEBLLM_LOG === "true")
  ) {
    return true;
  }
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
}

let lastProgressLogBucket = -1;
let lastProgressLogTime = 0;
const PROGRESS_LOG_MIN_MS = 1_200;

type LogData = Record<string, string | number | boolean | null | undefined>;

/**
 * Throttled init-progress lines so the console stays readable in Safari.
 */
export function webllmLogProgress(
  report: { progress: number; timeElapsed: number; text: string },
  gen: number,
): void {
  if (!isWebllmClientLogEnabled()) return;
  const now = Date.now();
  const bucket = Math.floor((report.progress || 0) * 20);
  if (bucket === lastProgressLogBucket && now - lastProgressLogTime < PROGRESS_LOG_MIN_MS) {
    return;
  }
  lastProgressLogBucket = bucket;
  lastProgressLogTime = now;
  const pct = Math.round((report.progress || 0) * 100);
  console.log(
    `[webllm] init progress ${pct}% (gen ${gen})`,
    (report.text || "").slice(0, 200),
  );
}

export function webllmLogResetProgressThrottle(): void {
  lastProgressLogBucket = -1;
  lastProgressLogTime = 0;
}

type WebllmLogOpts = { force?: boolean };

/**
 * @param event — short label; `data` is shown as a second console argument (Safari-friendly).
 * Use `opts.force` to log even when verbose is off (e.g. crash gate, errors).
 */
export function webllmLog(event: string, data?: LogData, opts?: WebllmLogOpts): void {
  if (opts?.force !== true && !isWebllmClientLogEnabled()) return;
  if (data && Object.keys(data).length) {
    console.log(`[webllm] ${event}`, data);
  } else {
    console.log(`[webllm] ${event}`);
  }
}

/** Shown for load failures even when verbose is off. */
export function webllmLogError(event: string, err: unknown, extra?: LogData): void {
  const message = err instanceof Error ? err.message : String(err);
  if (extra && Object.keys(extra).length) {
    console.error(`[webllm] ${event}`, { ...extra, errorMessage: message });
  } else {
    console.error(`[webllm] ${event}`, message);
  }
}
