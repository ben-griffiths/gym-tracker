"use client";

import { cn } from "@/lib/utils";

const DOT =
  "assistant-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/75";

/**
 * Three bouncing dots; staggered delays are in globals.css (`nth-child`) so they
 * animate in a wave (the `animation` shorthand would zero out delay utilities).
 */
export function AssistantTypingDots({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex min-h-[1.125rem] items-end gap-1.5 py-0.5", className)}
      role="status"
      aria-live="polite"
      aria-label="Assistant is typing"
    >
      <span className={DOT} />
      <span className={DOT} />
      <span className={DOT} />
    </div>
  );
}
