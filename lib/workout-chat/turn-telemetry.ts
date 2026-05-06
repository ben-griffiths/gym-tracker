import { webllmLog } from "@/lib/webllm/client-log";

export type ChatTurnStage =
  | "input"
  | "deterministic-hit"
  | "deterministic-miss"
  | "llm-request"
  | "llm-raw"
  | "llm-extracted"
  | "llm-sanitized"
  | "llm-merged"
  | "llm-final-suggestion"
  | "llm-error";

type TelemetryValue = string | number | boolean | null | undefined;

const PREVIEW_CAP = 200;

function previewString(value: string): string {
  return value.length > PREVIEW_CAP
    ? `${value.slice(0, PREVIEW_CAP)}…(${value.length - PREVIEW_CAP} more)`
    : value;
}

function flattenPayload(
  payload: Record<string, unknown>,
): Record<string, TelemetryValue> {
  const out: Record<string, TelemetryValue> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined) {
      out[k] = v;
    } else if (typeof v === "string") {
      out[k] = previewString(v);
    } else if (
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      out[k] = v;
    } else {
      try {
        out[k] = previewString(JSON.stringify(v));
      } catch {
        out[k] = "(unserialisable)";
      }
    }
  }
  return out;
}

/** Single entry-point for chat-turn telemetry. Reuses the WebLLM log channel. */
export function logChatTurnTelemetry(
  stage: ChatTurnStage,
  payload: Record<string, unknown> = {},
): void {
  webllmLog(`chat-turn: ${stage}`, flattenPayload(payload), { force: true });
}

const DEFAULT_LOGPROB_SAMPLE_RATE = 0.05;

function readSampleRateFromEnv(): number | null {
  if (typeof process === "undefined") return null;
  const raw = process.env.NEXT_PUBLIC_WEBLLM_LOGPROBS_SAMPLE_RATE;
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

/**
 * Whether the current chat turn should request logprobs. Sampled at a low
 * rate by default (5%) so the steady-state user latency is unaffected.
 *
 * Override with `NEXT_PUBLIC_WEBLLM_LOGPROBS_SAMPLE_RATE` (0..1).
 */
export function shouldSampleLogprobs(): boolean {
  const rate = readSampleRateFromEnv() ?? DEFAULT_LOGPROB_SAMPLE_RATE;
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() < rate;
}

/**
 * Threshold below which we treat the model as low-confidence on this turn
 * and surface a "does this look right?" reply. Matches typical mean
 * logprob ranges seen on small instruct models for in-distribution output.
 */
export const LOW_CONFIDENCE_LOGPROB_THRESHOLD = -3.0;

export function isLowConfidence(meanLogprob: number | null): boolean {
  if (meanLogprob == null || !Number.isFinite(meanLogprob)) return false;
  return meanLogprob < LOW_CONFIDENCE_LOGPROB_THRESHOLD;
}
