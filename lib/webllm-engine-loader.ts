import type {
  ChatOptions,
  InitProgressCallback,
  MLCEngineInterface,
} from "@mlc-ai/web-llm";
import { webllmLog, webllmLogError } from "@/lib/webllm-client-log";

type WebllmNamespace = typeof import("@mlc-ai/web-llm");

/**
 * Prefer `CreateWebWorkerMLCEngine` so heavy init runs off the UI thread; fall back to main-thread
 * `CreateMLCEngine` when Workers are missing or throw (some Safari builds).
 */
export async function loadPreferredWebllmEngine(params: {
  webllm: WebllmNamespace;
  modelId: string;
  chatOpts?: ChatOptions;
  initProgressCallback: InitProgressCallback;
  reasonLabel?: string;
}): Promise<MLCEngineInterface> {
  const engineBase = {
    appConfig: {
      ...params.webllm.prebuiltAppConfig,
      useIndexedDBCache: false as const,
    },
    initProgressCallback: params.initProgressCallback,
  };

  let worker: Worker | undefined;
  if (typeof Worker !== "undefined") {
    try {
      worker = new Worker(
        new URL("../workers/mlc.worker.ts", import.meta.url),
        { type: "module" },
      );
      const eng = await params.webllm.CreateWebWorkerMLCEngine(
        worker,
        params.modelId,
        engineBase,
        params.chatOpts,
      );
      webllmLog(
        "engine: WebWorkerMLCEngine",
        { modelId: params.modelId, reason: params.reasonLabel ?? "ok" },
        { force: true },
      );
      return eng;
    } catch (err) {
      worker?.terminate();
      webllmLogError("engine: worker path failed, using main thread", err, {
        modelId: params.modelId,
      });
    }
  } else {
    webllmLog("engine: Worker API missing, using main thread", {}, { force: true });
  }

  const eng = await params.webllm.CreateMLCEngine(
    params.modelId,
    engineBase,
    params.chatOpts,
  );
  webllmLog(
    "engine: MLCEngine (main thread)",
    { modelId: params.modelId, reason: params.reasonLabel ?? "fallback" },
    { force: true },
  );
  return eng;
}
