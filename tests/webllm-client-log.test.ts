import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isWebllmClientLogEnabled, webllmLog } from "@/lib/webllm-client-log";

describe("webllm-client-log", () => {
  const prev = process.env.NODE_ENV;
  const prevPublic = process.env.NEXT_PUBLIC_WEBLLM_LOG;

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (process as { env: NodeJS.ProcessEnv }).env.NODE_ENV = prev;
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_WEBLLM_LOG;
    else process.env.NEXT_PUBLIC_WEBLLM_LOG = prevPublic;
  });

  it("is enabled in development", () => {
    (process as { env: NodeJS.ProcessEnv }).env.NODE_ENV = "development";
    expect(isWebllmClientLogEnabled()).toBe(true);
  });

  it("webllmLog with force still logs when not verbose", () => {
    (process as { env: NodeJS.ProcessEnv }).env.NODE_ENV = "production";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    webllmLog("test event", { a: 1 }, { force: true });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
