import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersLowResourceWebLLM } from "../lib/webllm-capability";

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

describe("resolveWebLLMModelId (mobile default)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("selects the Mistral 7B id on mobile and desktop id on wide Chrome", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEBLLM_MODEL", "");
    vi.stubGlobal("navigator", {
      userAgent: "iPhone; CPU iPhone OS 17_0",
    });
    vi.stubGlobal("window", { document: {} });
    const m = await import("../lib/webllm-config");
    expect(m.resolveWebLLMModelId()).toBe(m.DEFAULT_WEBLLM_MODEL_ID_MOBILE);

    vi.resetModules();
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 not mobile",
    });
    const d = await import("../lib/webllm-config");
    expect(d.resolveWebLLMModelId()).toBe(d.DEFAULT_WEBLLM_MODEL_ID_DESKTOP);
  });
});
