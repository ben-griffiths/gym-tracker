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

import type { StorageBootstrapSnapshot } from "@/lib/webllm/storage-bootstrap";

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

/**
 * Logs workout-chat XML in a way that shows up reliably in Mobile Safari
 * (Develop → your device): a `console.warn` line with the full string, not
 * only a collapsible object from `console.log`.
 */
export function webllmLogRawWorkoutXml(
  event: string,
  xml: string,
  meta?: LogData,
): void {
  const trimmed = xml.trim();
  webllmLog(
    event,
    {
      ...meta,
      charLength: trimmed.length,
    },
    { force: true },
  );

  console.warn(`[webllm] ${event}\n${trimmed.length > 0 ? trimmed : "(empty)"}`);
}

/**
 * Full `chat.completions.create` payload — same visibility as {@link webllmLogRawWorkoutXml}
 * (`webllmLog` + `console.warn`) so Next dev / forward-logs shows it reliably.
 */
export function webllmLogChatCompletionsRequestFull(
  event: string,
  args: {
    stream: boolean;
    messages: ReadonlyArray<{ role: string; content: string }>;
    temperature: number;
    max_tokens: number;
  },
  meta?: LogData,
): void {
  const systemContent =
    args.messages.find((m) => m.role === "system")?.content ?? "";
  const userContent =
    args.messages.find((m) => m.role === "user")?.content ?? "";
  let json: string;
  try {
    json = JSON.stringify(args, null, 2);
  } catch (err) {
    json = `<stringify failed: ${String(err)}>`;
  }
  webllmLog(
    event,
    {
      ...meta,
      stream: args.stream,
      temperature: args.temperature,
      max_tokens: args.max_tokens,
      systemCharLength: systemContent.length,
      userCharLength: userContent.length,
    },
    { force: true },
  );
  console.warn(
    `[webllm] ${event}\n--- JSON (exact create args) ---\n${json}\n--- system ---\n${systemContent.length > 0 ? systemContent : "(empty)"}\n--- user ---\n${userContent.length > 0 ? userContent : "(empty)"}`,
  );
}

/**
 * Always visible: does not go through the verbose switch.
 * Use once at startup so you can tell if *any* console output works (Safari filters, etc.).
 */
export function webllmNotifyInspectorBoot(): void {
  if (typeof window === "undefined") return;
  // console.warn is shown when “Warnings” is enabled; harder to miss than .log

  console.warn(
    "[webllm] WebLLM client script running — you should see [webllm] logs here. " +
      "Silence: localStorage.setItem('gym.webllm.log','0'); location.reload()",
  );
}

/**
 * Single-line environment snapshot for mobile / Vercel debugging (storage, isolation, WebGPU).
 */
export async function webllmLogEnvironmentDebug(
  storage: StorageBootstrapSnapshot,
  opts?: { force?: boolean },
): Promise<void> {
  if (opts?.force !== true && !isWebllmClientLogEnabled()) return;
  if (typeof window === "undefined") return;

  const eff = (
    navigator as Navigator & {
      connection?: { effectiveType?: string };
    }
  ).connection?.effectiveType;

  let gpuAdapter: string | null = null;
  try {
    const navGpu = (
      navigator as Navigator & {
        gpu?: { requestAdapter?: () => Promise<unknown> };
      }
    ).gpu;
    if (navGpu) {
      const ad = await navGpu.requestAdapter?.();
      if (ad && typeof ad === "object") {
        const withInfo = ad as {
          requestAdapterInfo?: () => Promise<{ device?: string }>;
        };
        if (typeof withInfo.requestAdapterInfo === "function") {
          const info = await withInfo.requestAdapterInfo();
          gpuAdapter = info?.device ?? "unknown";
        } else {
          gpuAdapter = "adapter";
        }
      }
    }
  } catch {
    gpuAdapter = null;
  }

  const data: LogData = {
    crossOriginIsolated: window.crossOriginIsolated,
    webgpu: !!(
      navigator as Navigator & {
        gpu?: unknown;
      }
    ).gpu,
    storagePersistAlready: storage.persistedAlready,
    storagePersisted: storage.persisted,
    storageUsageMB: storage.usageMB,
    storageQuotaMB: storage.quotaMB,
    effectiveType: eff ?? null,
    standalonePWA: window.matchMedia("(display-mode: standalone)").matches,
    gpuAdapter,
  };

  console.log(`[webllm] environment (pre-load)`, data);
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

/** Client-only support context lines to paste into bug reports. */
function supportContextLines(): string[] {
  if (typeof window === "undefined") {
    return [`Time: ${new Date().toISOString()}`];
  }
  return [
    `Time: ${new Date().toISOString()}`,
    `Page: ${window.location.href}`,
    `User-Agent: ${navigator.userAgent}`,
    `WebGPU: ${"gpu" in navigator && navigator.gpu ? "yes" : "no"}`,
  ];
}

/**
 * Turn any thrown value into a short one-line summary plus a multi-line block
 * suitable for screenshots or "Copy details" for the app developer.
 */
export function formatWebllmLoadError(err: unknown): {
  summary: string;
  detail: string;
} {
  const footer = ["", "---", "Support context:", ...supportContextLines()].join("\n");

  if (err instanceof Error) {
    const body = [`${err.name}: ${err.message}`];
    if (err.stack) {
      body.push("", "Stack trace:", err.stack);
    }
    const cause = err.cause;
    if (cause !== undefined && cause !== null) {
      body.push("", "Cause:");
      if (cause instanceof Error) {
        body.push(`${cause.name}: ${cause.message}`);
        if (cause.stack) body.push(cause.stack);
      } else {
        body.push(String(cause));
      }
    }
    const summary =
      err.message.trim() ||
      err.name ||
      "Something went wrong while loading the on-device model.";
    return {
      summary,
      detail: body.join("\n") + footer,
    };
  }

  if (typeof err === "string") {
    const s = err.trim() || "(empty error string)";
    return {
      summary: s.length > 200 ? `${s.slice(0, 197)}…` : s,
      detail: s + footer,
    };
  }

  try {
    const json = JSON.stringify(err, null, 2);
    return {
      summary: json.slice(0, 160) + (json.length > 160 ? "…" : ""),
      detail: json + footer,
    };
  } catch {
    const s = String(err);
    return { summary: s, detail: s + footer };
  }
}
