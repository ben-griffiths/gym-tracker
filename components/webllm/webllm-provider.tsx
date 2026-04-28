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
import { isWebGPUSupported, prefersLowResourceWebLLM } from "@/lib/webllm-capability";
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
  | "awaiting_tap";

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
  if (prefersLowResourceWebLLM()) {
    return { status: "awaiting_tap", error: null };
  }
  return { status: "idle", error: null };
}

export function WebllmProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WebllmLoadStatus>(() =>
    typeof window !== "undefined" ? readInitialState().status : "idle",
  );
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
   * No eager autoload: align with chat.webllm.ai — weight load begins on first chat
   * [`ensureEngineForChat`] or [`startModelLoad`] (desktop idle / awaiting_tap taps).
   */
  useEffect(() => {
    if (typeof window === "undefined" || !clientReady) return;
    if (!isWebGPUSupported()) return;

    webllmLog("autoload: deferred (idle until ensureEngineForChat or startModelLoad)");

    return () => {
      loadGenRef.current += 1;
      const e = engineRef.current;
      engineRef.current = null;
      void e?.unload().catch(() => {});
    };
  }, [clientReady]);

  const startModelLoad = useCallback(() => {
    if (status !== "awaiting_tap" && status !== "idle") return;
    webllmLog(
      status === "awaiting_tap"
        ? "startModelLoad: user tapped or idle prefetch"
        : "startModelLoad: prefetch from idle",
    );
    allowAutoloadAgain();
    setErrorMessage(null);
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    void runLoad(gen);
  }, [runLoad, status]);

  const retry = useCallback(() => {
    webllmLog("retry: user requested reload");
    allowAutoloadAgain();
    setErrorMessage(null);
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    void runLoad(gen);
  }, [runLoad]);

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
