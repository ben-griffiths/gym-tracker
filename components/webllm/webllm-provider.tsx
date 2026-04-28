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
import { loadPreferredWebllmEngine } from "@/lib/webllm-engine-loader";
import { bootstrapWebLLMStorage } from "@/lib/webllm-storage-bootstrap";
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
  /** True when the user cannot send chat (model loading, or load error before retry). */
  chatSendBlocked: boolean;
  getEngine: () => MLCEngineInterface | null;
  retry: () => void;
  /** Start the download+compile (only when status is `awaiting_tap`) */
  startModelLoad: () => void;
};

const WebllmContext = createContext<WebllmContextValue | null>(null);

function readInitialState(): {
  status: WebllmLoadStatus;
  error: string | null;
} {
  if (typeof window === "undefined") {
    return { status: "loading", error: null };
  }
  const crash = consumeLoadCrashIfAny();
  if (crash) {
    return { status: "error", error: crash };
  }
  if (isAutoloadSkipped()) {
    return { status: "error", error: WEBLLM_LOAD_GATE_MESSAGE };
  }
  if (prefersLowResourceWebLLM()) {
    return { status: "awaiting_tap", error: null };
  }
  return { status: "loading", error: null };
}

export function WebllmProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WebllmLoadStatus>("loading");
  const [progress, setProgress] = useState<InitProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);
  const engineRef = useRef<MLCEngineInterface | null>(null);
  const loadGenRef = useRef(0);
  const deferAutoload = useRef(false);

  // SessionStorage + UA are client-only: apply once after mount so server HTML matches first paint, then we correct.
  useLayoutEffect(() => {
    webllmNotifyInspectorBoot();
    // Before consumeLoadCrashIfAny: upload buffered progress if last session died mid–CreateMLCEngine
    webllmDiagUploadIfInflightOnBoot();
    deferAutoload.current = prefersLowResourceWebLLM();
    const next = readInitialState();
    webllmLog("mount: client gate", {
      status: next.status,
      deferAutoload: deferAutoload.current,
      skipAutoload: isAutoloadSkipped(),
    });
    setStatus(next.status);
    setErrorMessage(next.error);
    setClientReady(true);
  }, []);

  const runLoad = useCallback(async (gen: number) => {
    webllmLog("runLoad: start", { gen, currentGen: loadGenRef.current });
    webllmLogResetProgressThrottle();
    engineRef.current = null;
    if (!isWebGPUSupported()) {
      webllmLog("runLoad: WebGPU not available", { gen }, { force: true });
      if (gen === loadGenRef.current) {
        setStatus("unsupported");
        setProgress(null);
        setErrorMessage(null);
      }
      return;
    }

    setStatus("loading");
    setProgress(null);
    setErrorMessage(null);

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
        webllmLog("runLoad: await engine init (Web Worker preferred)… (can take several minutes on mobile)", {
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
              webllmDiagProgress({
                progress: report.progress,
                timeElapsed: report.timeElapsed,
                text: report.text,
              });
              webllmLogProgress(
                {
                  progress: report.progress,
                  timeElapsed: report.timeElapsed,
                  text: report.text,
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
        webllmLog("runLoad: engine init Promise resolved (engine ready in JS)", { gen });
      } finally {
        // Tab crash leaves inflight set; a recoverable JS error clears it here.
        if (gen === loadGenRef.current) {
          clearInflightAfterEngineCreate();
        }
      }
      if (gen !== loadGenRef.current) {
        webllmLog("runLoad: stale generation, unloading and aborting", { gen, current: loadGenRef.current });
        await engine.unload().catch(() => {});
        webllmDiagOnLoadEnd("aborted");
        return;
      }
      allowAutoloadAgain();
      engineRef.current = engine;
      setStatus("ready");
      setProgress(null);
      webllmLog("runLoad: success, status=ready", { modelId, gen });
      webllmDiagOnLoadEnd("ready");
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      clearInflightAfterEngineCreate();
      const message =
        err instanceof Error ? err.message : "Failed to load the local model.";
      webllmLogError("runLoad: catch (load failed)", err, { gen });
      webllmDiagUploadJsError(message);
      setErrorMessage(message);
      setStatus("error");
      setProgress(null);
      engineRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !clientReady) return;
    if (deferAutoload.current) {
      // Phone / tablet: wait for startModelLoad() so one bad launch does not loop.
      webllmLog("autoload: skipped (low-resource, awaiting tap to load)");
      return;
    }
    if (isAutoloadSkipped()) {
      webllmLog("autoload: skipped (skip_autoload in session, user must retry)", {}, { force: true });
      return;
    }
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    webllmLog("autoload: scheduling runLoad", { gen });
    void runLoad(gen);
    return () => {
      // Verbose only: fires often in React 18 Strict Mode (double mount in dev).
      webllmLog("autoload: cleanup, bump gen and unload", { fromGen: gen });
      loadGenRef.current += 1;
      const e = engineRef.current;
      engineRef.current = null;
      void e?.unload().catch(() => {});
    };
  }, [clientReady, runLoad]);

  const startModelLoad = useCallback(() => {
    if (status !== "awaiting_tap") return;
    webllmLog("startModelLoad: user tapped (low-resource path)");
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
    // awaiting_tap: user can still chat via deterministic parsing; only block on active load or hard error
    const chatSendBlocked = status === "loading" || status === "error";
    return {
      status,
      progress,
      errorMessage,
      chatSendBlocked,
      getEngine,
      retry,
      startModelLoad,
    };
  }, [status, progress, errorMessage, getEngine, retry, startModelLoad]);

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
