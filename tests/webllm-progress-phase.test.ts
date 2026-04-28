import { describe, expect, it } from "vitest";
import { classifyWebllmInitProgressPhase } from "@/lib/webllm-progress-phase";

describe("classifyWebllmInitProgressPhase", () => {
  it("detects fetch/cache style lines", () => {
    expect(classifyWebllmInitProgressPhase("Fetching from cache…")).toBe("fetch_cache");
    expect(classifyWebllmInitProgressPhase("Downloading tokenizer…")).toBe("fetch_cache");
  });

  it("detects compile/gpu style lines", () => {
    expect(classifyWebllmInitProgressPhase("Compiling TVM relax module…")).toBe("compile_gpu");
  });

  it("returns unknown for empty", () => {
    expect(classifyWebllmInitProgressPhase("")).toBe("unknown");
  });
});
