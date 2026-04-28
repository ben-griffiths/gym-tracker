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
 * iOS Safari outside an installed PWA caps Cache API at ~1.3–1.5 GB and silently
 * tab-kills WebLLM around shard 36/106 (~33%) of the 7B q4f16 model. Installed
 * PWAs get persistent storage, lifting the quota. Gating the load behind PWA
 * install on iOS is the only way to make WebLLM finish on iPhone.
 */
export function requiresIOSPWAInstallForWebLLM(): boolean {
  return isIOS() && !isStandalonePWA();
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
