"use client";

import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWebllm } from "@/components/webllm/webllm-provider";

/**
 * Full-screen "Installing AI…" overlay shown while the on-device model is
 * downloading + compiling on first app load. Stays visible across the
 * provider's auto-retries and surfaces a Retry button once the auto-retry
 * budget is exhausted (`status === "error"`). Renders nothing for any other
 * status, so on subsequent visits (model already cached) it disappears the
 * moment the engine reports `ready`.
 */
export function WebllmInstallOverlay() {
  const { status, progress, errorMessage, errorDetail, retry } = useWebllm();
  if (status !== "loading" && status !== "error") return null;

  const isError = status === "error";
  const pct = Math.max(
    0,
    Math.min(100, Math.round((progress?.progress ?? 0) * 100)),
  );
  const detail = (progress?.text ?? "").trim();

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live="polite"
      aria-busy={!isError}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background/95 px-6 text-center backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3">
        {isError ? (
          <TriangleAlertIcon
            className="size-9 text-destructive"
            aria-hidden="true"
          />
        ) : (
          <Loader2Icon
            className="size-9 animate-spin text-primary"
            aria-hidden="true"
          />
        )}
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {isError ? "Install failed" : "Installing on-device AI"}
        </h2>
        <p className="max-w-xs text-sm text-muted-foreground">
          {isError
            ? "We tried 3 times and couldn't finish setting up the on-device model. Check your connection and try again."
            : "One-time setup. Your phone is downloading and caching the model so chat works offline. Stay on this screen — Wi-Fi is best."}
        </p>
      </div>

      {isError ? (
        <div className="flex w-full max-w-xs flex-col items-center gap-3">
          {errorMessage ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {errorMessage}
            </p>
          ) : null}
          <Button type="button" onClick={retry} className="min-w-32">
            Try again
          </Button>
          {errorDetail ? (
            <details className="w-full text-left text-[11px] text-muted-foreground">
              <summary className="cursor-pointer select-none text-center">
                Show details
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded border border-border bg-muted/40 p-2 font-mono leading-snug whitespace-pre-wrap break-words">
                {errorDetail}
              </pre>
            </details>
          ) : null}
        </div>
      ) : (
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
      )}
    </div>
  );
}
