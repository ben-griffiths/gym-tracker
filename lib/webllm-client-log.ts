/**
 * Client-only logging for WebLLM / Safari Web Inspector.
 *
 * **Verbose logs default to ON** in the browser so you see `[webllm]` lines in
 * Mobile Safari (Mac → Develop → your device) without extra setup.
 *
 * Silence: `localStorage.setItem("gym.webllm.log", "0"); location.reload();`
 *
 * Also: `NEXT_PUBLIC_WEBLLM_LOG=0` build-time off, or `1` to force on.
 */

const LS_KEY = "gym.webllm.log";

export function isWebllmClientLogEnabled(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const pl = process.env.NEXT_PUBLIC_WEBLLM_LOG;
  if (pl === "0" || pl === "false") return false;
  if (pl === "1" || pl === "true") return true;
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage?.getItem(LS_KEY);
    if (v === "0") return false;
  } catch {
    // Private mode or storage blocked: keep logging on so you still see *something* in the console.
    return true;
  }
  // Default: verbose on (set gym.webllm.log to 0 to silence)
  return true;
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
  // eslint-disable-next-line no-console -- intentional client debug channel
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
    // eslint-disable-next-line no-console -- intentional client debug channel
    console.log(`[webllm] ${event}`, data);
  } else {
    // eslint-disable-next-line no-console -- intentional client debug channel
    console.log(`[webllm] ${event}`);
  }
}

/**
 * Always visible: does not go through the verbose switch.
 * Use once at startup so you can tell if *any* console output works (Safari filters, etc.).
 */
export function webllmNotifyInspectorBoot(): void {
  if (typeof window === "undefined") return;
  // console.warn is shown when “Warnings” is enabled; harder to miss than .log
  // eslint-disable-next-line no-console -- intentional client debug channel
  console.warn(
    "[webllm] WebLLM client script running — you should see [webllm] logs here. " +
      "Silence: localStorage.setItem('gym.webllm.log','0'); location.reload()",
  );
}

/** Shown for load failures even when verbose is off. */
export function webllmLogError(event: string, err: unknown, extra?: LogData): void {
  const message = err instanceof Error ? err.message : String(err);
  if (extra && Object.keys(extra).length) {
    // eslint-disable-next-line no-console -- intentional client debug channel
    console.error(`[webllm] ${event}`, { ...extra, errorMessage: message });
  } else {
    // eslint-disable-next-line no-console -- intentional client debug channel
    console.error(`[webllm] ${event}`, message);
  }
}
