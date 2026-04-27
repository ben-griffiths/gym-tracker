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

  it("is false for desktop Chrome", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36",
    });
    expect(prefersLowResourceWebLLM()).toBe(false);
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
