/// <reference lib="webworker" />

/**
 * Mirrors [web-llm-chat `app/worker/web-worker.ts`](https://github.com/mlc-ai/web-llm-chat/blob/main/app/worker/web-worker.ts):
 * lazy `WebWorkerMLCEngineHandler` so the bundle doesn’t eagerly touch the backend until messages arrive.
 */

import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

let handler: WebWorkerMLCEngineHandler | undefined;

// Upstream attaches an empty listener (parity with web-llm-chat).
self.addEventListener("message", () => {});

self.onmessage = (msg: MessageEvent) => {
  if (!handler) {
    handler = new WebWorkerMLCEngineHandler();
    // Same idea as upstream `log.info("Web Worker: Web-LLM Engine Activated")`
    console.info("[webllm-worker] Web-LLM engine activated");
  }
  handler.onmessage(msg);
};
