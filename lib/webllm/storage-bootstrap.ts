/**
 * Helps keep WebLLM Cache API payloads from being evicted under storage pressure (best-effort;
 * unrelated to GPU OOM — see README).
 *
 * WebLLM uses the **Cache API** when `useIndexedDBCache: false` (this app’s default per
 * upstream: Cache API is more well-tested in WebLLM than IndexedDB). `persist()` marks the
 * origin’s bucket as persistent where the browser allows, which reduces eviction under pressure
 * (still not a guarantee on all mobile profiles—see docs).
 */

export type StorageBootstrapSnapshot = {
  /**
   * `StorageManager.persisted()` when available: whether the bucket is already durable before
   * we call `persist()`.
   */
  persistedAlready: boolean | null;
  /** `StorageManager.persist()` result, or null if unsupported / denied / error. */
  persisted: boolean | null;
  usageMB: number | null;
  quotaMB: number | null;
};

export async function bootstrapWebLLMStorage(): Promise<StorageBootstrapSnapshot> {
  if (typeof navigator === "undefined") {
    return {
      persistedAlready: null,
      persisted: null,
      usageMB: null,
      quotaMB: null,
    };
  }
  let persistedAlready: boolean | null = null;
  let persisted: boolean | null = null;
  let usageMB: number | null = null;
  let quotaMB: number | null = null;
  try {
    const sm = "storage" in navigator ? navigator.storage : undefined;
    if (sm?.persisted) {
      persistedAlready = await sm.persisted();
    }
    if (sm?.persist) {
      persisted = await sm.persist();
    }
    if (sm?.estimate) {
      const e = await sm.estimate();
      usageMB = e.usage != null ? Math.round((e.usage / (1024 * 1024)) * 10) / 10 : null;
      quotaMB =
        e.quota != null ? Math.round((e.quota / (1024 * 1024)) * 10) / 10 : null;
    }
  } catch {
    // Permission denied or private mode quirks — never block WebLLM load.
  }
  return { persistedAlready, persisted, usageMB, quotaMB };
}
