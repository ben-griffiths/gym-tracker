"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import {
  isWebGPUSupported,
  prefersLowResourceWebLLM,
  requiresIOSPWAInstallForWebLLM,
} from "@/lib/webllm-capability";
import {
  resolveWebLLMChatOptions,
  resolveWebLLMModelId,
} from "@/lib/webllm-config";
import { clearLastWebllmInitProgress, recordLastWebllmInitProgress } from "@/lib/webllm-init-progress-last";
import { loadPreferredWebllmEngine } from "@/lib/webllm-engine-loader";
import { bootstrapWebLLMStorage } from "@/lib/webllm-storage-bootstrap";
import {
  classifyWebllmInitProgressPhase,
} from "@/lib/webllm-progress-phase";
import {
  allowAutoloadAgain,
  clearInflightAfterEngineCreate,
  consumeLoadCrashIfAny,
  getInflightToken,
  isAutoloadSkipped,
  setInflightBeforeEngineCreate,
  WEBLLM_LOAD_GATE_MESSAGE,
} from "@/lib/webllm-load-session";
import {
  webllmLog,
  webllmLogEnvironmentDebug,
  webllmLogError,
  webllmLogProgress,
  webllmLogResetProgressThrottle,
  webllmNotifyInspectorBoot,
} from "@/lib/webllm-client-log";
import {
  webllmDiagBeginLoad,
  webllmDiagOnLoadEnd,
  webllmDiagProgress,
  webllmDiagSetPreloadContext,
  webllmDiagUploadIfInflightOnBoot,
  webllmDiagUploadJsError,
} from "@/lib/webllm-diagnostics";
import { formatWebllmLoadError } from "@/lib/webllm-format-error";

export type WebllmLoadStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unsupported"
  | "error"
  /** User must tap to start (avoids auto GPU crash + reload loop on many phones) */
  | "awaiting_tap"
  /**
   * iOS Safari outside an installed PWA: the per-origin Cache API quota
   * (~1.3–1.5 GB) is too small for the 7B model (~4 GB) and the tab is silently
   * killed around 33%. Installed PWAs get persistent storage and load fine.
   */
  | "requires_pwa_install";

type InitProgress = {
  progress: number;
  timeElapsed: number;
  text: string;
};

type WebllmContextValue = {
  status: WebllmLoadStatus;
  progress: InitProgress | null;
  errorMessage: string | null;
  /** Copy-paste diagnostics (multi-line stack, URL, UA) when status is `"error"`. */
  errorDetail: string | null;
  /** True when the user cannot send chat (model loading, or load error before retry). */
  chatSendBlocked: boolean;
  getEngine: () => MLCEngineInterface | null;
  /** Await WebLLM before chat; triggers deferred load when status is idle. */
  ensureEngineForChat: () => Promise<MLCEngineInterface | null>;
  retry: () => void;
  /** Start the download+compile (awaiting_tap / idle prefetch) */
  startModelLoad: () => void;
};

const WebllmContext = createContext<WebllmContextValue | null>(null);

function readInitialState(): {
  status: WebllmLoadStatus;
  error: string | null;
} {
  if (typeof window === "undefined") {
    return { status: "idle", error: null };
  }
  const crash = consumeLoadCrashIfAny();
  if (crash) {
    return { status: "error", error: crash };
  }
  if (isAutoloadSkipped()) {
    return { status: "error", error: WEBLLM_LOAD_GATE_MESSAGE };
  }
  if (!isWebGPUSupported()) {
    return { status: "unsupported", error: null };
  }
  if (requiresIOSPWAInstallForWebLLM()) {
    return { status: "requires_pwa_install", error: null };
  }
  // Auto-install on first paint regardless of device class — the smaller 1B
  // model fits comfortably on mobile, and the user shouldn't have to tap
  // "Load model" before chat works. Crash recovery still applies above
  // (consumeLoadCrashIfAny / isAutoloadSkipped).
  return { status: "idle", error: null };
}

export function WebllmProvider({ children }: { children: ReactNode }) {
  // Always start in `"idle"` so the SSR HTML and the first client render match
  // exactly (avoids hydration mismatches in the footer status banners that
  // wrap `<Composer>`). The real status is computed in a `useLayoutEffect`
  // below — `readInitialState()` reads `sessionStorage` and `navigator.gpu`,
  // both of which are client-only and would otherwise diverge from SSR.
  const [status, setStatus] = useState<WebllmLoadStatus>("idle");
  const [progress, setProgress] = useState<InitProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);
  const engineRef = useRef<MLCEngineInterface | null>(null);
  const loadGenRef = useRef(0);
  const statusRef = useRef<WebllmLoadStatus>(status);

  const setTrackedStatus = useCallback((next: WebllmLoadStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  /** Serialized ensureEngine callers. */
  const ensureChainRef = useRef<Promise<MLCEngineInterface | null> | null>(
    null,
  );
  const loadWaitersRef = useRef<(() => void)[]>([]);

  function flushLoadWaiters() {
    const w = loadWaitersRef.current.splice(0);
    w.forEach((fn) => fn());
  }

  // SessionStorage + UA are client-only: apply once after mount so server HTML matches first paint, then we correct.
  useLayoutEffect(() => {
    webllmNotifyInspectorBoot();
    webllmDiagUploadIfInflightOnBoot();
    const next = readInitialState();
    webllmLog("mount: client gate", {
      status: next.status,
      skipAutoload: isAutoloadSkipped(),
    });
    setTrackedStatus(next.status);
    if (next.error) {
      const { summary, detail } = formatWebllmLoadError(next.error);
      setErrorMessage(summary);
      setErrorDetail(detail);
    } else {
      setErrorMessage(null);
      setErrorDetail(null);
    }
    setClientReady(true);
  }, [setTrackedStatus]);

  const runLoad = useCallback(
    async (gen: number): Promise<boolean> => {
    webllmLog("runLoad: start", { gen, currentGen: loadGenRef.current });
    webllmLogResetProgressThrottle();
    clearLastWebllmInitProgress();
    engineRef.current = null;
    if (!isWebGPUSupported()) {
      webllmLog("runLoad: WebGPU not available", { gen }, { force: true });
      if (gen === loadGenRef.current) {
        setTrackedStatus("unsupported");
        setProgress(null);
        setErrorMessage(null);
        setErrorDetail(null);
      }
      return false;
    }
    if (requiresIOSPWAInstallForWebLLM()) {
      webllmLog(
        "runLoad: iOS non-standalone — gating until PWA install (Cache API quota)",
        { gen },
        { force: true },
      );
      if (gen === loadGenRef.current) {
        setTrackedStatus("requires_pwa_install");
        setProgress(null);
        setErrorMessage(null);
        setErrorDetail(null);
      }
      return false;
    }

    setTrackedStatus("loading");
    setProgress(null);
    setErrorMessage(null);
    setErrorDetail(null);

    try {
      webllmLog("runLoad: importing @mlc-ai/web-llm…");
      const webllm = await import("@mlc-ai/web-llm");
      webllmLog("runLoad: web-llm module loaded");
      const modelId = resolveWebLLMModelId();
      const chatOpts = resolveWebLLMChatOptions();
      webllmLog("runLoad: resolved model and chat opts", {
        modelId,
        hasContextOverride: chatOpts != null,
      });
      const storageBootstrap = await bootstrapWebLLMStorage();
      webllmDiagSetPreloadContext({
        ...storageBootstrap,
        crossOriginIsolated:
          typeof window !== "undefined" ? window.crossOriginIsolated : null,
      });
      await webllmLogEnvironmentDebug(storageBootstrap, { force: true });
      const contextWindow =
        chatOpts && typeof (chatOpts as { context_window_size?: number }).context_window_size ===
        "number"
          ? (chatOpts as { context_window_size: number }).context_window_size
          : null;
      const lowRes = prefersLowResourceWebLLM();
      setInflightBeforeEngineCreate();
      const loadId = getInflightToken();
      if (loadId) {
        webllmDiagBeginLoad({
          loadId,
          modelId,
          contextWindow,
          lowResource: lowRes,
          webgpu: isWebGPUSupported(),
        });
      } else {
        webllmLog("runLoad: no loadId (unexpected before engine create)", {}, { force: true });
      }
      let engine: MLCEngineInterface;
      try {
        webllmLog("runLoad: await WebWorkerMLCEngine + reload (web-llm-chat sequence)…", {
          modelId,
        });
        const markAvail = typeof performance?.mark === "function";
        if (markAvail) performance.mark("webllm-load-engine-start");
        try {
          engine = await loadPreferredWebllmEngine({
            webllm,
            modelId,
            chatOpts,
            reasonLabel: "runLoad",
            initProgressCallback: (report) => {
              if (gen !== loadGenRef.current) return;
              recordLastWebllmInitProgress({
                progress: report.progress,
                timeElapsed: report.timeElapsed,
                text: report.text,
              });
              const phase = classifyWebllmInitProgressPhase(report.text || "");
              webllmDiagProgress({
                progress: report.progress,
                timeElapsed: report.timeElapsed,
                text: report.text,
              });
              webllmLogProgress(
                {
                  progress: report.progress,
                  timeElapsed: report.timeElapsed,
                  text:
                    `[${phase}] ` + (report.text || "").slice(0, 280),
                },
                gen,
              );
              setProgress({
                progress: report.progress,
                timeElapsed: report.timeElapsed,
                text: report.text,
              });
            },
          });
        } finally {
          if (markAvail) {
            performance.mark("webllm-load-engine-end");
            if (typeof performance.measure === "function") {
              try {
                const m = performance.measure(
                  "webllm-load-engine",
                  "webllm-load-engine-start",
                  "webllm-load-engine-end",
                );
                webllmLog("runLoad: performance webllm-load-engine", {
                  durationMs: Math.round(m.duration),
                });
              } catch {
                // duplicate measure / missing marks in some environments
              }
            }
          }
        }
        webllmLog("runLoad: engine init Promise resolved (engine ready in JS)", {
          gen,
        });
      } finally {
        if (gen === loadGenRef.current) {
          clearInflightAfterEngineCreate();
        }
      }
      if (gen !== loadGenRef.current) {
        webllmLog("runLoad: stale generation, unloading and aborting", {
          gen,
          current: loadGenRef.current,
        });
        await engine.unload().catch(() => {});
        webllmDiagOnLoadEnd("aborted");
        return false;
      }
      allowAutoloadAgain();
      engineRef.current = engine;
      setTrackedStatus("ready");
      setProgress(null);
      clearLastWebllmInitProgress();
      webllmLog("runLoad: success, status=ready", { modelId, gen });
      webllmDiagOnLoadEnd("ready");
      return true;
    } catch (err) {
      if (gen !== loadGenRef.current) return false;
      clearInflightAfterEngineCreate();
      const { summary, detail } = formatWebllmLoadError(err);
      webllmLogError("runLoad: catch (load failed)", err, { gen });
      webllmDiagUploadJsError(summary);
      setErrorMessage(summary);
      setErrorDetail(detail);
      setTrackedStatus("error");
      setProgress(null);
      engineRef.current = null;
      return false;
    } finally {
      flushLoadWaiters();
    }
  },
    [setTrackedStatus],
  );

  const ensureEngineForChat =
    useCallback(async (): Promise<MLCEngineInterface | null> => {
      return (ensureChainRef.current ??= (async (): Promise<
        MLCEngineInterface | null
      > => {
        try {
          if (!isWebGPUSupported()) return null;
          if (engineRef.current) return engineRef.current;
          let s = statusRef.current;
          if (s === "unsupported" || s === "error") return null;
          if (s === "awaiting_tap") return null;
          if (s === "requires_pwa_install") return null;

          // idle (deferred desktop) or loading retry
          if (s === "idle") {
            loadGenRef.current += 1;
            const gen = loadGenRef.current;
            await runLoad(gen);
            return engineRef.current;
          }
          if (s === "loading") {
            await new Promise<void>((r) => {
              loadWaitersRef.current.push(r);
            });
            return engineRef.current;
          }
          if (s === "ready") {
            return engineRef.current;
          }
          return null;
        } finally {
          ensureChainRef.current = null;
        }
      })());
    }, [runLoad]);

  /**
   * Run `runLoad` and, on transient failure, automatically retry up to
   * `MAX_AUTO_ATTEMPTS` total times with linear backoff. Returns true on
   * success, false once retries are exhausted (or the load was superseded
   * by a newer generation, e.g. unmount). Each user-initiated entry point
   * (initial autoload, `retry`, `startModelLoad`) gets its own fresh budget.
   */
  const MAX_AUTO_ATTEMPTS = 3;
  const runLoadWithAutoRetry = useCallback(async (): Promise<boolean> => {
    for (let attempt = 1; attempt <= MAX_AUTO_ATTEMPTS; attempt++) {
      loadGenRef.current += 1;
      const gen = loadGenRef.current;
      const ok = await runLoad(gen);
      if (ok) return true;
      // Superseded by a newer load (unmount or another retry kicked in).
      if (gen !== loadGenRef.current) return false;
      if (attempt < MAX_AUTO_ATTEMPTS) {
        webllmLog(
          `autoload: attempt ${attempt}/${MAX_AUTO_ATTEMPTS} failed — auto-retrying`,
          { attempt },
          { force: true },
        );
        // Brief linear backoff (1.5s, 3s) so a transient WebGPU/network blip
        // has time to settle without making the user wait forever.
        await new Promise<void>((r) => setTimeout(r, 1500 * attempt));
        if (gen !== loadGenRef.current) return false;
        // The previous failed attempt set status="error"; flip back to
        // "loading" so the install overlay stays visible across retries.
        setTrackedStatus("loading");
        setErrorMessage(null);
        setErrorDetail(null);
        allowAutoloadAgain();
      } else {
        webllmLog(
          `autoload: gave up after ${MAX_AUTO_ATTEMPTS} failed attempts`,
          {},
          { force: true },
        );
      }
    }
    return false;
  }, [runLoad, setTrackedStatus]);

  /**
   * Eager autoload on first paint so the user never has to tap a "Load model"
   * button. We only kick this off from `idle` — `unsupported`,
   * `requires_pwa_install`, and the crash-recovery skip path are all left
   * alone. The full-screen overlay is rendered while `status === "loading"`
   * and again on `status === "error"` (with a Retry button) once the
   * 3-attempt auto-retry budget is exhausted.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !clientReady) return;
    if (!isWebGPUSupported()) return;
    if (statusRef.current !== "idle") return;
    if (isAutoloadSkipped()) return;

    webllmLog("autoload: starting eager load on app first paint");
    void runLoadWithAutoRetry();

    return () => {
      loadGenRef.current += 1;
      const e = engineRef.current;
      engineRef.current = null;
      void e?.unload().catch(() => {});
    };
  }, [clientReady, runLoadWithAutoRetry]);

  const startModelLoad = useCallback(() => {
    if (status !== "awaiting_tap" && status !== "idle") return;
    webllmLog(
      status === "awaiting_tap"
        ? "startModelLoad: user tapped or idle prefetch"
        : "startModelLoad: prefetch from idle",
    );
    allowAutoloadAgain();
    setErrorMessage(null);
    void runLoadWithAutoRetry();
  }, [runLoadWithAutoRetry, status]);

  const retry = useCallback(() => {
    webllmLog("retry: user requested reload");
    allowAutoloadAgain();
    setErrorMessage(null);
    void runLoadWithAutoRetry();
  }, [runLoadWithAutoRetry]);

  const getEngine = useCallback((): MLCEngineInterface | null => {
    return engineRef.current;
  }, []);

  const value = useMemo((): WebllmContextValue => {
    const chatSendBlocked = status === "loading" || status === "error";
    return {
      status,
      progress,
      errorMessage,
      errorDetail,
      chatSendBlocked,
      getEngine,
      ensureEngineForChat,
      retry,
      startModelLoad,
    };
  }, [
    status,
    progress,
    errorMessage,
    errorDetail,
    getEngine,
    ensureEngineForChat,
    retry,
    startModelLoad,
  ]);

  return (
    <WebllmContext.Provider value={value}>{children}</WebllmContext.Provider>
  );
}

export function useWebllm(): WebllmContextValue {
  const ctx = useContext(WebllmContext);
  if (!ctx) {
    throw new Error("useWebllm must be used within WebllmProvider");
  }
  return ctx;
}
