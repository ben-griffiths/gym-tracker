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
import type { MLCEngine } from "@mlc-ai/web-llm";
import { isWebGPUSupported, prefersLowResourceWebLLM } from "@/lib/webllm-capability";
import {
  resolveWebLLMChatOptions,
  resolveWebLLMModelId,
} from "@/lib/webllm-config";
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
  webllmDiagBeginLoad,
  webllmDiagOnLoadEnd,
  webllmDiagProgress,
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
  getEngine: () => MLCEngine | null;
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
  const engineRef = useRef<MLCEngine | null>(null);
  const loadGenRef = useRef(0);
  const deferAutoload = useRef(false);

  // SessionStorage + UA are client-only: apply once after mount so server HTML matches first paint, then we correct.
  useLayoutEffect(() => {
    // Before consumeLoadCrashIfAny: upload buffered progress if last session died mid–CreateMLCEngine
    webllmDiagUploadIfInflightOnBoot();
    deferAutoload.current = prefersLowResourceWebLLM();
    const next = readInitialState();
    setStatus(next.status);
    setErrorMessage(next.error);
    setClientReady(true);
  }, []);

  const runLoad = useCallback(async (gen: number) => {
    engineRef.current = null;
    if (!isWebGPUSupported()) {
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
      const webllm = await import("@mlc-ai/web-llm");
      const modelId = resolveWebLLMModelId();
      const chatOpts = resolveWebLLMChatOptions();
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
      }
      let engine: MLCEngine;
      try {
        engine = await webllm.CreateMLCEngine(
          modelId,
          {
            // Cache API tends to be more reliable than IndexedDB on some mobile
            // WebViews when large artifacts are involved.
            appConfig: {
              ...webllm.prebuiltAppConfig,
              useIndexedDBCache: false,
            },
            initProgressCallback: (report) => {
              if (gen !== loadGenRef.current) return;
              webllmDiagProgress({
                progress: report.progress,
                timeElapsed: report.timeElapsed,
                text: report.text,
              });
              setProgress({
                progress: report.progress,
                timeElapsed: report.timeElapsed,
                text: report.text,
              });
            },
          },
          chatOpts,
        );
      } finally {
        // Tab crash leaves inflight set; a recoverable JS error clears it here.
        if (gen === loadGenRef.current) {
          clearInflightAfterEngineCreate();
        }
      }
      if (gen !== loadGenRef.current) {
        await engine.unload().catch(() => {});
        webllmDiagOnLoadEnd("aborted");
        return;
      }
      allowAutoloadAgain();
      engineRef.current = engine;
      setStatus("ready");
      setProgress(null);
      webllmDiagOnLoadEnd("ready");
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      clearInflightAfterEngineCreate();
      const message =
        err instanceof Error ? err.message : "Failed to load the local model.";
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
      return;
    }
    if (isAutoloadSkipped()) {
      return;
    }
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    void runLoad(gen);
    return () => {
      loadGenRef.current += 1;
      const e = engineRef.current;
      engineRef.current = null;
      void e?.unload().catch(() => {});
    };
  }, [clientReady, runLoad]);

  const startModelLoad = useCallback(() => {
    if (status !== "awaiting_tap") return;
    allowAutoloadAgain();
    setErrorMessage(null);
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    void runLoad(gen);
  }, [runLoad, status]);

  const retry = useCallback(() => {
    allowAutoloadAgain();
    setErrorMessage(null);
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    void runLoad(gen);
  }, [runLoad]);

  const getEngine = useCallback((): MLCEngine | null => {
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
