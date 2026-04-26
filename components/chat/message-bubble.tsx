"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type MessageBubbleProps = {
  role: "user" | "assistant" | "system";
  children: ReactNode;
  className?: string;
  /** Renders under user bubbles (e.g. edit / undo). */
  actions?: ReactNode;
};

export function MessageBubble({
  role,
  children,
  className,
  actions,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const isSystem = role === "system";

  if (isSystem) {
    return (
      <div className="mx-auto max-w-sm rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
        {children}
      </div>
    );
  }

  if (!isUser) {
    return (
      <div className={cn("w-full text-[15px] leading-relaxed text-foreground", className)}>
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full flex-col items-stretch",
        "justify-end",
        className,
      )}
    >
      <div className="flex w-full justify-end">
        <div
          className={cn(
            "max-w-[82%] rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm",
            "rounded-br-lg bg-primary text-primary-foreground",
          )}
        >
          {children}
        </div>
      </div>
      {actions ? (
        <div className="mt-1.5 flex w-full flex-wrap justify-end gap-1">{actions}</div>
      ) : null}
    </div>
  );
}
