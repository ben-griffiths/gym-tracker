import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isIOS,
  isStandalonePWA,
  prefersLowResourceWebLLM,
  requiresIOSPWAInstallForWebLLM,
} from "../lib/webllm-capability";
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

describe("iOS / PWA gating", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isIOS detects iPhone UA", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    });
    expect(isIOS()).toBe(true);
  });

  it("isIOS detects iPadOS 13+ desktop UA via touch points", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    });
    expect(isIOS()).toBe(true);
  });

  it("isIOS is false for desktop Mac without touch", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      maxTouchPoints: 0,
    });
    expect(isIOS()).toBe(false);
  });

  it("isStandalonePWA returns true when display-mode standalone matches", () => {
    vi.stubGlobal("window", {
      matchMedia: (q: string) => ({ matches: q.includes("standalone") }),
    });
    vi.stubGlobal("navigator", {});
    expect(isStandalonePWA()).toBe(true);
  });

  it("isStandalonePWA returns true via legacy navigator.standalone", () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("navigator", { standalone: true });
    expect(isStandalonePWA()).toBe(true);
  });

  it("requiresIOSPWAInstallForWebLLM is true for iPhone Safari outside PWA", () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
      standalone: false,
    });
    expect(requiresIOSPWAInstallForWebLLM()).toBe(true);
  });

  it("requiresIOSPWAInstallForWebLLM is false when iOS PWA is installed", () => {
    vi.stubGlobal("window", {
      matchMedia: (q: string) => ({ matches: q.includes("standalone") }),
    });
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
      standalone: true,
    });
    expect(requiresIOSPWAInstallForWebLLM()).toBe(false);
  });

  it("requiresIOSPWAInstallForWebLLM is false on desktop", () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0",
      maxTouchPoints: 0,
    });
    expect(requiresIOSPWAInstallForWebLLM()).toBe(false);
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
