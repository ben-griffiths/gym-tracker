import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersLowResourceWebLLM } from "../lib/webllm-capability";
import { WEBLLM_MODEL_ID, resolveWebLLMModelId } from "../lib/webllm-config";

describe("prefersLowResourceWebLLM", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is true for iPhone user agent", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    expect(prefersLowResourceWebLLM()).toBe(true);
  });

  it("is true for Android", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile",
    });
    expect(prefersLowResourceWebLLM()).toBe(true);
  });

  it("is true for slow network effectiveType", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0",
      connection: { effectiveType: "3g" },
    });
    expect(prefersLowResourceWebLLM()).toBe(true);
  });
});

describe("resolveWebLLMModelId", () => {
  it("always returns the hardcoded Mistral Hermes id", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    vi.stubGlobal("window", {});
    expect(resolveWebLLMModelId()).toBe(WEBLLM_MODEL_ID);

    vi.unstubAllGlobals();
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0",
    });
    vi.stubGlobal("window", {});
    expect(resolveWebLLMModelId()).toBe(WEBLLM_MODEL_ID);
  });
});

describe("resolveWebLLMChatOptions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses 1024 context in production for low-resource", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("navigator", {
      userAgent: "iPhone",
    });
    vi.stubGlobal("window", {});
    const { resolveWebLLMChatOptions } = await import("../lib/webllm-config");
    expect(resolveWebLLMChatOptions()?.context_window_size).toBe(1024);
  });

  it("uses 2048 context in development for low-resource", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubGlobal("navigator", {
      userAgent: "iPhone",
    });
    vi.stubGlobal("window", {});
    vi.resetModules();
    const { resolveWebLLMChatOptions } = await import("../lib/webllm-config");
    expect(resolveWebLLMChatOptions()?.context_window_size).toBe(2048);
  });
});
