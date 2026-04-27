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
