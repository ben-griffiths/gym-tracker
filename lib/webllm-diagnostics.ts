import { webllmLog } from "@/lib/webllm-client-log";
import type { StorageBootstrapSnapshot } from "@/lib/webllm-storage-bootstrap";
import { getInflightToken, isInflightLoad } from "@/lib/webllm-load-session";

const LS_KEY = "gym.webllm.diag_v1";
const MAX_SNAPSHOT_ENTRIES = 50;
const PROGRESS_THROTTLE_MS = 400;

type SnapshotEntry = {
  t: number;
  progress: number;
  timeElapsed: number;
  text: string;
};

type LoadSnapshotV1 = {
  v: 1;
  loadId: string;
  modelId: string;
  contextWindow: number | null;
  lowResource: boolean;
  webgpu: boolean;
  startedAt: number;
  entries: SnapshotEntry[];
};

type WebllmDiagReason = "suspected_tab_crash" | "load_js_error";

type OutgoingPayload = {
  source: "gym-webllm";
  version: 1;
  reason: WebllmDiagReason;
  at: string;
  load: {
    loadId: string;
    modelId: string;
    contextWindow: number | null;
    lowResource: boolean;
    webgpu: boolean;
    startedAt: number;
    lastProgressText: string | null;
    lastProgress: number | null;
    entryCount: number;
    sampleEntries: SnapshotEntry[];
  } | null;
  environment: {
    userAgent: string;
    deviceMemory: number | null;
    hardwareConcurrency: number | null;
    platform: string;
    /** Set from preload bootstrap when available (best-effort). */
    crossOriginIsolated?: boolean | null;
    webgpuPresent?: boolean | null;
    storagePersisted?: boolean | null;
    storageUsageMB?: number | null;
    storageQuotaMB?: number | null;
  };
  error?: string;
  /** Inflight session token and snapshot loadId differ (stale or partial storage). */
  loadIdMismatch?: boolean;
};

let lastProgressWrite = 0;

let preloadDiagContext:
  | (StorageBootstrapSnapshot & { crossOriginIsolated?: boolean | null })
  | null = null;

/** Call once per load after `navigator.storage.persist` / `estimate` (same window as Create*). */
export function webllmDiagSetPreloadContext(
  snapshot: StorageBootstrapSnapshot & { crossOriginIsolated?: boolean | null },
): void {
  preloadDiagContext = snapshot;
}

function preloadOrNull(): NonNullable<typeof preloadDiagContext> | null {
  return preloadDiagContext;
}

function canUseStorage() {
  return typeof localStorage !== "undefined";
}

function readSnapshot(): LoadSnapshotV1 | null {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as LoadSnapshotV1;
    if (p?.v !== 1 || !p.loadId || !Array.isArray(p.entries)) return null;
    return p;
  } catch {
    return null;
  }
}

function writeSnapshot(s: LoadSnapshotV1) {
  if (!canUseStorage()) return;
  try {
    if (s.entries.length > MAX_SNAPSHOT_ENTRIES) {
      s.entries = s.entries.slice(-MAX_SNAPSHOT_ENTRIES);
    }
    const ser = JSON.stringify(s);
    if (ser.length > 40_000) {
      s.entries = s.entries.slice(-20);
    }
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    // Quota or disabled storage; ignore
  }
}

/**
 * Call after setInflightBeforeEngineCreate() so loadId exists.
 */
export function webllmDiagBeginLoad(opts: {
  loadId: string;
  modelId: string;
  contextWindow: number | null;
  lowResource: boolean;
  webgpu: boolean;
}): void {
  if (!canUseStorage()) return;
  const now = Date.now();
  const next: LoadSnapshotV1 = {
    v: 1,
    loadId: opts.loadId,
    modelId: opts.modelId,
    contextWindow: opts.contextWindow,
    lowResource: opts.lowResource,
    webgpu: opts.webgpu,
    startedAt: now,
    entries: [],
  };
  writeSnapshot(next);
  lastProgressWrite = 0;
  webllmLog("diagnostics: begin load snapshot", {
    modelId: opts.modelId,
    contextWindow: opts.contextWindow ?? "default",
    lowResource: opts.lowResource,
  });
}

export function webllmDiagProgress(report: {
  progress: number;
  timeElapsed: number;
  text: string;
}): void {
  if (!canUseStorage()) return;
  const now = Date.now();
  if (now - lastProgressWrite < PROGRESS_THROTTLE_MS) return;
  lastProgressWrite = now;

  const snap = readSnapshot();
  if (!snap) return;
  snap.entries.push({
    t: now,
    progress: report.progress,
    timeElapsed: report.timeElapsed,
    text: (report.text || "").slice(0, 2_000),
  });
  writeSnapshot(snap);
}

function clearStorageSnapshot() {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}

/**
 * If session says we died mid-inflight, push the last local snapshot to the
 * server (best-effort). Call before `consumeLoadCrashIfAny`.
 */
export function webllmDiagUploadIfInflightOnBoot(): void {
  if (typeof window === "undefined" || !isInflightLoad()) return;
  const snap = readSnapshot();
  const token = getInflightToken();
  const mismatch = Boolean(
    token && snap && snap.loadId.length > 0 && snap.loadId !== token,
  );
  const last = snap?.entries.at(-1);
  const load = snap
    ? {
        loadId: (token && token.length > 0 ? token : snap.loadId) as string,
        modelId: snap.modelId,
        contextWindow: snap.contextWindow,
        lowResource: snap.lowResource,
        webgpu: snap.webgpu,
        startedAt: snap.startedAt,
        lastProgressText: last?.text ?? null,
        lastProgress: last != null ? last.progress : null,
        entryCount: snap.entries.length,
        sampleEntries: snap.entries.slice(-12),
      }
    : null;
  webllmLog(
    "diagnostics: uploading suspected_tab_crash to /api/webllm-log",
    {
      hasSnapshot: load != null,
      modelId: load?.modelId ?? "(none)",
      entryCount: load?.entryCount ?? 0,
      lastProgress: load?.lastProgressText?.slice(0, 80) ?? "",
      loadIdMismatch: mismatch,
    },
    { force: true },
  );
  void sendPayload({
    source: "gym-webllm",
    version: 1,
    reason: "suspected_tab_crash",
    at: new Date().toISOString(),
    load,
    environment: getEnvBox(),
    loadIdMismatch: mismatch,
  });
}

export function webllmDiagUploadJsError(message: string): void {
  webllmLog(
    "diagnostics: uploading load_js_error to /api/webllm-log",
    { errorPreview: message.slice(0, 160) },
    { force: true },
  );
  const snap = readSnapshot();
  void sendPayload({
    source: "gym-webllm",
    version: 1,
    reason: "load_js_error",
    at: new Date().toISOString(),
    error: message.slice(0, 4_000),
    load: snap
      ? {
          loadId: snap.loadId,
          modelId: snap.modelId,
          contextWindow: snap.contextWindow,
          lowResource: snap.lowResource,
          webgpu: snap.webgpu,
          startedAt: snap.startedAt,
          lastProgressText: snap.entries.at(-1)?.text ?? null,
          lastProgress: snap.entries.at(-1)?.progress ?? null,
          entryCount: snap.entries.length,
          sampleEntries: snap.entries.slice(-8),
        }
      : null,
    environment: getEnvBox(),
  });
  clearStorageSnapshot();
}

/** Clear the buffered snapshot after a normal finish or cancelled / stale load. */
export function webllmDiagOnLoadEnd(_kind: "ready" | "aborted" | "skip"): void {
  void _kind;
  clearStorageSnapshot();
}

function getEnvBox(): OutgoingPayload["environment"] {
  if (typeof navigator === "undefined") {
    return {
      userAgent: "",
      deviceMemory: null,
      hardwareConcurrency: null,
      platform: "",
    };
  }
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };
  const pre = preloadOrNull();
  return {
    userAgent: nav.userAgent.slice(0, 1_200),
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    platform: (nav as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform || nav.platform || "",
    crossOriginIsolated:
      typeof window !== "undefined" ? window.crossOriginIsolated : null,
    webgpuPresent: !!(nav as Navigator & { gpu?: unknown }).gpu,
    storagePersisted: pre?.persisted ?? null,
    storageUsageMB: pre?.usageMB ?? null,
    storageQuotaMB: pre?.quotaMB ?? null,
  };
}

function getLogAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_WEBLLM_LOG_INGEST_SECRET
  ) {
    h["x-webllm-log-secret"] = process.env.NEXT_PUBLIC_WEBLLM_LOG_INGEST_SECRET;
  }
  return h;
}

function sendPayload(body: OutgoingPayload): void {
  if (typeof window === "undefined") return;
  void fetch("/api/webllm-log", {
    method: "POST",
    headers: getLogAuthHeaders(),
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}
