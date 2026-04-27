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
  const conn = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (conn?.saveData === true) return true;
  // Slow links (common on cellular) — same WebGPU + download path as mobile; treat as low-resource.
  const et = conn?.effectiveType;
  if (et === "slow-2g" || et === "2g" || et === "3g") return true;
  const dm = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  if (typeof dm === "number" && dm <= 4) return true;
  return false;
}
