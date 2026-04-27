"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MLCEngine } from "@mlc-ai/web-llm";
import { isWebGPUSupported } from "@/lib/webllm-capability";
import {
  resolveWebLLMChatOptions,
  resolveWebLLMModelId,
} from "@/lib/webllm-config";

export type WebllmLoadStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unsupported"
  | "error";

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
};

const WebllmContext = createContext<WebllmContextValue | null>(null);

export function WebllmProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WebllmLoadStatus>("loading");
  const [progress, setProgress] = useState<InitProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const engineRef = useRef<MLCEngine | null>(null);
  const loadGenRef = useRef(0);

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
      const engine = await webllm.CreateMLCEngine(
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
            setProgress({
              progress: report.progress,
              timeElapsed: report.timeElapsed,
              text: report.text,
            });
          },
        },
        chatOpts,
      );
      if (gen !== loadGenRef.current) {
        await engine.unload().catch(() => {});
        return;
      }
      engineRef.current = engine;
      setStatus("ready");
      setProgress(null);
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      const message =
        err instanceof Error ? err.message : "Failed to load the local model.";
      setErrorMessage(message);
      setStatus("error");
      setProgress(null);
      engineRef.current = null;
    }
  }, []);

  useEffect(() => {
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    void runLoad(gen);
    return () => {
      loadGenRef.current += 1;
      const e = engineRef.current;
      engineRef.current = null;
      void e?.unload().catch(() => {});
    };
  }, [runLoad]);

  const retry = useCallback(() => {
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    void runLoad(gen);
  }, [runLoad]);

  const getEngine = useCallback((): MLCEngine | null => {
    return engineRef.current;
  }, []);

  const value = useMemo((): WebllmContextValue => {
    const chatSendBlocked = status === "loading" || status === "error";
    return {
      status,
      progress,
      errorMessage,
      chatSendBlocked,
      getEngine,
      retry,
    };
  }, [status, progress, errorMessage, getEngine, retry]);

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
