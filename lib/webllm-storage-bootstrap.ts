/**
 * Helps keep WebLLM Cache API payloads from being evicted under storage pressure (best-effort;
 * unrelated to GPU OOM — see README).
 */

export type StorageBootstrapSnapshot = {
  persisted: boolean | null;
  usageMB: number | null;
  quotaMB: number | null;
};

export async function bootstrapWebLLMStorage(): Promise<StorageBootstrapSnapshot> {
  if (typeof navigator === "undefined") {
    return { persisted: null, usageMB: null, quotaMB: null };
  }
  let persisted: boolean | null = null;
  let usageMB: number | null = null;
  let quotaMB: number | null = null;
  try {
    if ("storage" in navigator && navigator.storage?.persist) {
      persisted = await navigator.storage.persist();
    }
    if ("storage" in navigator && navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      usageMB = e.usage != null ? Math.round((e.usage / (1024 * 1024)) * 10) / 10 : null;
      quotaMB =
        e.quota != null ? Math.round((e.quota / (1024 * 1024)) * 10) / 10 : null;
    }
  } catch {
    // ignore
  }
  return { persisted, usageMB, quotaMB };
}
