/**
 * Browser guard for WebLLM (WebGPU). Safe to import from client components only.
 */
export function isWebGPUSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "gpu" in navigator &&
    (navigator as Navigator & { gpu?: unknown }).gpu !== undefined
  );
}

const MOBILE_UA_RE =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

/**
 * Phones / tablets and constrained networks need a smaller model and less KV
 * cache — loading the default 8B Hermes on mobile WebGPU often hits GPU OOM
 * right after the download/cache step finishes.
 */
export function prefersLowResourceWebLLM(): boolean {
  if (typeof navigator === "undefined") return false;
  if (MOBILE_UA_RE.test(navigator.userAgent)) return true;
  if (
    "connection" in navigator &&
    (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData === true
  ) {
    return true;
  }
  const dm = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  if (typeof dm === "number" && dm <= 4) return true;
  return false;
}
