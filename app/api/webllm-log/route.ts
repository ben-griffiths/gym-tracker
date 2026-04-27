import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_BYTES = 65_000;

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isAllowedPayload(v: unknown): v is UnknownRecord {
  if (!isRecord(v)) return false;
  if (v.source !== "gym-webllm") return false;
  if (v.version !== 1) return false;
  if (v.reason !== "suspected_tab_crash" && v.reason !== "load_js_error") {
    return false;
  }
  if (typeof v.at !== "string") return false;
  if (v.error !== undefined && typeof v.error !== "string") return false;
  if (v.load !== undefined && v.load !== null && !isRecord(v.load)) return false;
  if (v.environment !== undefined && v.environment !== null && !isRecord(v.environment)) {
    return false;
  }
  return true;
}

/**
 * Ingests anonymized client diagnostics when WebLLM load crashes (GPU kill) or
 * throws. Logs to the host (e.g. Vercel) as JSON. Optional shared secret
 * to reduce drive-by traffic.
 */
export async function POST(req: Request) {
  const expected = process.env.NEXT_PUBLIC_WEBLLM_LOG_INGEST_SECRET;
  if (expected) {
    const got = req.headers.get("x-webllm-log-secret");
    if (got !== expected) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const raw = await req.text();
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isAllowedPayload(parsed)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (process.env.NODE_ENV === "development" || process.env.WEBLLM_LOG_VERBOSE === "1") {
    console.log("[webllm-diag]", JSON.stringify(parsed));
  } else {
    console.log("[webllm-diag]", {
      reason: parsed.reason,
      at: parsed.at,
      modelId: isRecord(parsed.load) ? (parsed.load as { modelId?: string }).modelId : undefined,
      entryCount: isRecord(parsed.load) ? (parsed.load as { entryCount?: number }).entryCount : undefined,
      lastProgress: isRecord(parsed.load) ? (parsed.load as { lastProgressText?: string }).lastProgressText : undefined,
      hasError: typeof parsed.error === "string",
      ua: isRecord(parsed.environment)
        ? String((parsed.environment as { userAgent?: string }).userAgent || "").slice(0, 120)
        : undefined,
    });
  }
  return NextResponse.json({ ok: true });
}
