import type {
  ChatOptions,
  InitProgressCallback,
  LogLevel,
  MLCEngineInterface,
} from "@mlc-ai/web-llm";
import { webllmLog, webllmLogError } from "@/lib/webllm-client-log";

type WebllmNamespace = typeof import("@mlc-ai/web-llm");

/**
 * Same sequence as [web-llm-chat `WebLLMApi.initModel`](https://github.com/mlc-ai/web-llm-chat/blob/main/app/client/webllm.ts):
 * `new WebWorkerMLCEngine(Worker, engineConfig)` → `setInitProgressCallback` → `await reload(model, chatOpts)`.
 * Fallback: `new MLCEngine(engineConfig)` → same. (Not `CreateWebWorkerMLCEngine` / `CreateMLCEngine`.)
 */
export async function loadPreferredWebllmEngine(params: {
  webllm: WebllmNamespace;
  modelId: string;
  chatOpts?: ChatOptions;
  initProgressCallback: InitProgressCallback;
  reasonLabel?: string;
}): Promise<MLCEngineInterface> {
  const logWarn = "WARN" as LogLevel;
  const engineConfig = {
    appConfig: {
      ...params.webllm.prebuiltAppConfig,
      useIndexedDBCache: false as const,
    },
    logLevel: logWarn,
  };

  let worker: Worker | undefined;
  if (typeof Worker !== "undefined") {
    try {
      worker = new Worker(
        new URL("../workers/mlc.worker.ts", import.meta.url),
        { type: "module" },
      );
      const engine = new params.webllm.WebWorkerMLCEngine(worker, engineConfig);
      engine.setInitProgressCallback(params.initProgressCallback);
      await engine.reload(params.modelId, params.chatOpts);
      webllmLog(
        "engine: WebWorkerMLCEngine + reload (web-llm-chat pattern)",
        { modelId: params.modelId, reason: params.reasonLabel ?? "ok" },
        { force: true },
      );
      return engine;
    } catch (err) {
      worker?.terminate();
      webllmLogError("engine: worker path failed, using MLCEngine on main thread", err, {
        modelId: params.modelId,
      });
    }
  } else {
    webllmLog("engine: Worker API missing, using MLCEngine main thread", {}, { force: true });
  }

  const engine = new params.webllm.MLCEngine(engineConfig);
  engine.setInitProgressCallback(params.initProgressCallback);
  await engine.reload(params.modelId, params.chatOpts);
  webllmLog(
    "engine: MLCEngine + reload (main thread)",
    { modelId: params.modelId, reason: params.reasonLabel ?? "fallback" },
    { force: true },
  );
  return engine;
}
