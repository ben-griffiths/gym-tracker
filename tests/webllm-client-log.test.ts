import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isWebllmClientLogEnabled, webllmLog, webllmNotifyInspectorBoot } from "@/lib/webllm-client-log";

describe("webllm-client-log", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is enabled in development (no window)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isWebllmClientLogEnabled()).toBe(true);
  });

  it("defaults to enabled in production when localStorage is unset (browser)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_WEBLLM_LOG", "");
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    expect(isWebllmClientLogEnabled()).toBe(true);
  });

  it("is off when localStorage is 0", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_WEBLLM_LOG", "");
    vi.stubGlobal("window", { localStorage: { getItem: () => "0" } });
    expect(isWebllmClientLogEnabled()).toBe(false);
  });

  it("is off when NEXT_PUBLIC_WEBLLM_LOG is 0", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_WEBLLM_LOG", "0");
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    expect(isWebllmClientLogEnabled()).toBe(false);
  });

  it("webllmLog with force still logs when verbose is off", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_WEBLLM_LOG", "0");
    vi.stubGlobal("window", { localStorage: { getItem: () => "0" } });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    webllmLog("test event", { a: 1 }, { force: true });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("webllmNotifyInspectorBoot uses console.warn", () => {
    vi.stubGlobal("window", {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    webllmNotifyInspectorBoot();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
