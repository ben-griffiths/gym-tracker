import { webllmLog } from "@/lib/webllm-client-log";

/**
 * Stops the Safari "this webpage was reloaded" death loop: if the tab crashes
 * during CreateMLCEngine, `gym.webllm.inflight` is never cleared. On the next
 * load we see it and must not auto-start WebLLM again until the user opts in.
 */
const KEY_INFLIGHT = "gym.webllm.inflight";
const KEY_SKIP = "gym.webllm.skip_autoload";
const KEY_INFLIGHT_TOKEN = "gym.webllm.inflight_token";

/** Shown after a crash gate or when autoload is skipped (same as `consumeLoadCrashIfAny` message). */
export const WEBLLM_LOAD_GATE_MESSAGE =
  "The on-device model hit a browser crash (often on mobile). Chat uses offline parsing until you try again.";

const CRASH_COPY = WEBLLM_LOAD_GATE_MESSAGE;

/**
 * If the last page life ended mid-load, clear storage and return an error
 * message for the UI. Returns null when the user is fine to (try to) load.
 */
export function consumeLoadCrashIfAny(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  const inflight = sessionStorage.getItem(KEY_INFLIGHT);
  if (inflight === "1") {
    webllmLog(
      "session: last page died during CreateMLCEngine (inflight) — gating autoload",
      { inflight: "1" },
      { force: true },
    );
    sessionStorage.removeItem(KEY_INFLIGHT);
    sessionStorage.setItem(KEY_SKIP, "1");
    return CRASH_COPY;
  }
  return null;
}

export function isAutoloadSkipped(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(KEY_SKIP) === "1";
}

export function allowAutoloadAgain(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(KEY_SKIP);
  sessionStorage.removeItem(KEY_INFLIGHT);
  sessionStorage.removeItem(KEY_INFLIGHT_TOKEN);
  webllmLog("session: allowAutoloadAgain (user retry or new load tap)");
}

/**
 * Set immediately before `await CreateMLCEngine` (sync). Cleared in `finally`
 * when the JS run completes, or left set if the GPU process is killed.
 */
export function setInflightBeforeEngineCreate(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(KEY_INFLIGHT, "1");
  sessionStorage.setItem(
    KEY_INFLIGHT_TOKEN,
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  webllmLog("session: set inflight=1 (about to call CreateMLCEngine)");
}

export function clearInflightAfterEngineCreate(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(KEY_INFLIGHT);
  sessionStorage.removeItem(KEY_INFLIGHT_TOKEN);
  webllmLog("session: cleared inflight (CreateMLCEngine await finished in JS)");
}

/** True if the last navigation ended mid-`CreateMLCEngine` (tab crash or kill). */
export function isInflightLoad(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(KEY_INFLIGHT) === "1";
}

export function getInflightToken(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem(KEY_INFLIGHT_TOKEN);
}
