import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/webllm-log/route";

describe("POST /api/webllm-log", () => {
  const prev = process.env.NEXT_PUBLIC_WEBLLM_LOG_INGEST_SECRET;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_WEBLLM_LOG_INGEST_SECRET;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prev !== undefined) {
      process.env.NEXT_PUBLIC_WEBLLM_LOG_INGEST_SECRET = prev;
    } else {
      delete process.env.NEXT_PUBLIC_WEBLLM_LOG_INGEST_SECRET;
    }
  });

  it("returns 200 for a valid minimal payload", async () => {
    const res = await POST(
      new Request("http://localhost/api/webllm-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "gym-webllm",
          version: 1,
          reason: "load_js_error",
          at: new Date().toISOString(),
          error: "test",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok?: boolean };
    expect(j.ok).toBe(true);
  });

  it("returns 400 for wrong shape", async () => {
    const res = await POST(
      new Request("http://localhost/api/webllm-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ foo: 1 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when secret is set and header missing", async () => {
    process.env.NEXT_PUBLIC_WEBLLM_LOG_INGEST_SECRET = "secret-xyz";
    const res = await POST(
      new Request("http://localhost/api/webllm-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "gym-webllm",
          version: 1,
          reason: "load_js_error",
          at: new Date().toISOString(),
        }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
