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

/**
 * iPhone, iPod, iPad — including iPadOS 13+ which reports Mac UA but exposes touch.
 * All iOS browsers share WebKit (App Store policy), so the Cache API quota cliff
 * applies regardless of browser shell.
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPod|iPad/.test(ua)) return true;
  if (
    /Macintosh/.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  ) {
    return true;
  }
  return false;
}

/** Running inside an installed PWA (Add to Home Screen on iOS, install on desktop). */
export function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  const navStandalone = (navigator as Navigator & { standalone?: boolean })
    .standalone;
  return navStandalone === true;
}

/**
 * The pinned model is now `Llama-3.2-1B-Instruct-q4f16_1-MLC` (~700 MB), which fits
 * comfortably inside iOS Safari's per-origin Cache API ceiling (~1.3–1.5 GB), so the
 * historic PWA-install gate is no longer required for the model to finish loading.
 *
 * Kept as a function (returning `false`) so callers and the UI branch keyed on
 * `"requires_pwa_install"` stay structurally intact; revisit if the pinned model
 * grows past the iOS Safari quota again.
 */
export function requiresIOSPWAInstallForWebLLM(): boolean {
  return false;
}

const MOBILE_UA_RE =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

/**
 * Phones / tablets and constrained networks still benefit from a tighter KV
 * cache: even with the 1B Llama checkpoint, low-end mobile GPUs can hit OOM
 * if the context window is left at the default. Used to gate the production
 * `context_window_size` override in `resolveWebLLMChatOptions()`.
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
