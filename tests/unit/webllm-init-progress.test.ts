import { describe, expect, it } from "vitest";
import { webllmProgressIndicatesNetworkParamFetch } from "@/lib/webllm/init-progress";

describe("webllmProgressIndicatesNetworkParamFetch", () => {
  it("is true for MLC network shard download messages", () => {
    expect(
      webllmProgressIndicatesNetworkParamFetch(
        "Fetching param cache[12/345]: 10MB fetched. 3% completed, 120 secs elapsed. It can take a while when we first visit this page to populate the cache. Later refreshes will become faster.",
      ),
    ).toBe(true);
    expect(
      webllmProgressIndicatesNetworkParamFetch(
        "Fetching param cache[1/120]: 1MB fetched. 2% completed, 3 secs elapsed. It can take a while when we first visit this page to populate the cache. Later refreshes will become faster.",
      ),
    ).toBe(true);
  });

  it("is false when loading shards from cache onto WebGPU", () => {
    expect(
      webllmProgressIndicatesNetworkParamFetch(
        "Loading model from cache[1/120]: 5MB loaded. 4% completed, 120 secs elapsed.",
      ),
    ).toBe(false);
    expect(
      webllmProgressIndicatesNetworkParamFetch("Start to fetch params"),
    ).toBe(false);
  });
});
