"use client";

import { Loader2Icon } from "lucide-react";
import { useWebllm } from "@/components/webllm/webllm-provider";

/**
 * Full-screen "Installing AI…" overlay shown while the on-device model is
 * downloading + compiling on first app load. Renders nothing for any other
 * status, so on subsequent visits (model already cached) it disappears the
 * moment the engine reports `ready`.
 */
export function WebllmInstallOverlay() {
  const { status, progress } = useWebllm();
  if (status !== "loading") return null;

  const pct = Math.max(
    0,
    Math.min(100, Math.round((progress?.progress ?? 0) * 100)),
  );
  const detail = (progress?.text ?? "").trim();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background/95 px-6 text-center backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3">
        <Loader2Icon
          className="size-9 animate-spin text-primary"
          aria-hidden="true"
        />
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Installing on-device AI
        </h2>
        <p className="max-w-xs text-sm text-muted-foreground">
          One-time setup. Your phone is downloading and caching the model so
          chat works offline. Stay on this screen — Wi-Fi is best.
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{pct}%</span>
          {detail ? (
            <span className="ml-3 truncate" title={detail}>
              {detail}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
