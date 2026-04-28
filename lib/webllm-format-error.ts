/** Client-only support context lines to paste into bug reports. */
function supportContextLines(): string[] {
  if (typeof window === "undefined") {
    return [`Time: ${new Date().toISOString()}`];
  }
  return [
    `Time: ${new Date().toISOString()}`,
    `Page: ${window.location.href}`,
    `User-Agent: ${navigator.userAgent}`,
    `WebGPU: ${"gpu" in navigator && navigator.gpu ? "yes" : "no"}`,
  ];
}

/**
 * Turn any thrown value into a short one-line summary plus a multi-line block
 * suitable for screenshots or "Copy details" for the app developer.
 */
export function formatWebllmLoadError(err: unknown): {
  summary: string;
  detail: string;
} {
  const footer = ["", "---", "Support context:", ...supportContextLines()].join("\n");

  if (err instanceof Error) {
    const body = [`${err.name}: ${err.message}`];
    if (err.stack) {
      body.push("", "Stack trace:", err.stack);
    }
    const cause = err.cause;
    if (cause !== undefined && cause !== null) {
      body.push("", "Cause:");
      if (cause instanceof Error) {
        body.push(`${cause.name}: ${cause.message}`);
        if (cause.stack) body.push(cause.stack);
      } else {
        body.push(String(cause));
      }
    }
    const summary =
      err.message.trim() ||
      err.name ||
      "Something went wrong while loading the on-device model.";
    return {
      summary,
      detail: body.join("\n") + footer,
    };
  }

  if (typeof err === "string") {
    const s = err.trim() || "(empty error string)";
    return {
      summary: s.length > 200 ? `${s.slice(0, 197)}…` : s,
      detail: s + footer,
    };
  }

  try {
    const json = JSON.stringify(err, null, 2);
    return {
      summary: json.slice(0, 160) + (json.length > 160 ? "…" : ""),
      detail: json + footer,
    };
  } catch {
    const s = String(err);
    return { summary: s, detail: s + footer };
  }
}
