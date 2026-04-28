import type {
  ChatOptions,
  InitProgressCallback,
  LogLevel,
  MLCEngineInterface,
} from "@mlc-ai/web-llm";
import { webllmLog, webllmLogError } from "@/lib/webllm-client-log";

type WebllmNamespace = typeof import("@mlc-ai/web-llm");

function shouldSkipWorkerForDeploy(): boolean {
  if (typeof process === "undefined") return false;
  const v = process.env.NEXT_PUBLIC_WEBLLM_SKIP_WORKER;
  return v === "1" || v === "true";
}

/**
 * Same sequence as [web-llm-chat `WebLLMApi.initModel`](https://github.com/mlc-ai/web-llm-chat/blob/main/app/client/webllm.ts):
 * `new WebWorkerMLCEngine(Worker, engineConfig)` → `setInitProgressCallback` → `await reload(model, chatOpts)`.
 * Fallback: `new MLCEngine(engineConfig)` → same. (Not `CreateWebWorkerMLCEngine` / `CreateMLCEngine`.)
 *
 * **Deploy debugging:** If production fails but `next dev` works, check DevTools Network for 404s on
 * `/_next/static/...` worker or `.wasm` chunks before assuming GPU OOM.
 *
 * **Kill-switch:** set `NEXT_PUBLIC_WEBLLM_SKIP_WORKER=1` on Vercel to force main-thread `MLCEngine` only.
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

  const skipWorker = shouldSkipWorkerForDeploy();
  if (skipWorker) {
    webllmLog(
      "engine: NEXT_PUBLIC_WEBLLM_SKIP_WORKER set — using MLCEngine (main thread)",
      { modelId: params.modelId },
      { force: true },
    );
  }

  let worker: Worker | undefined;
  if (!skipWorker && typeof Worker !== "undefined") {
    try {
      worker = new Worker(new URL("./workers/mlc.worker.ts", import.meta.url), {
        type: "module",
      });
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
  } else if (!skipWorker) {
    webllmLog("engine: Worker API missing, using MLCEngine main thread", {}, { force: true });
  }

  const engine = new params.webllm.MLCEngine(engineConfig);
  engine.setInitProgressCallback(params.initProgressCallback);
  await engine.reload(params.modelId, params.chatOpts);
  webllmLog(
    "engine: MLCEngine + reload (main thread)",
    { modelId: params.modelId, reason: skipWorker ? "skip_worker_env" : params.reasonLabel ?? "fallback" },
    { force: true },
  );
  return engine;
}
