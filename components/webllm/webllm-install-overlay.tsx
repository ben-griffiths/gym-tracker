"use client";

import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWebllm } from "@/components/webllm/webllm-provider";

/** Aligned with `AppHeader`: `h-[75px]` plus top safe area (see `app/layout.tsx`). */
const BELOW_HEADER_TOP =
  "top-[calc(75px+env(safe-area-inset-top,0px))]" as const;

/**
 * While the on-device model is loading, shows either a **full-screen** install
 * experience during **network shard download** (first visit / cache eviction) or a
 * **slim progress strip** under the app header for cache-only reload and compile.
 * Surfaces the same retry affordance as before when `status === "error"`.
 */
export function WebllmInstallOverlay() {
  const {
    status,
    progress,
    errorMessage,
    errorDetail,
    retry,
    storagePersistenceHint,
    blockingInstallUi,
  } = useWebllm();
  if (status !== "loading" && status !== "error") return null;

  const isError = status === "error";
  const pct = Math.max(
    0,
    Math.min(100, Math.round((progress?.progress ?? 0) * 100)),
  );
  const detail = (progress?.text ?? "").trim();
  const slimCaption = detail || storagePersistenceHint || "";

  const showFullOverlay = isError || (status === "loading" && blockingInstallUi);

  if (!showFullOverlay) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy
        className={`pointer-events-none fixed ${BELOW_HEADER_TOP} right-0 left-0 z-30 border-b border-border/60 bg-card/90 backdrop-blur-sm`}
      >
        <div
          className="h-1 w-full overflow-hidden bg-muted/80"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Model load progress"
        >
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        {slimCaption ? (
          <div className="flex min-h-7 items-center gap-2 px-3 py-1">
            <Loader2Icon
              className="size-3.5 shrink-0 animate-spin text-primary"
              aria-hidden
            />
            <p className="min-w-0 flex-1 truncate text-[11px] leading-tight text-muted-foreground">
              {slimCaption}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

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
        {storagePersistenceHint && !isError ? (
          <p className="max-w-sm rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {storagePersistenceHint}
          </p>
        ) : null}
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
