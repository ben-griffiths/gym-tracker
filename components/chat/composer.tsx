"use client";

import { FormEvent, ReactNode, useState } from "react";
import { ArrowUp, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ComposerProps = {
  onSubmit: (message: string) => Promise<void> | void;
  cameraTrigger: (trigger: ReactNode) => ReactNode;
  disabled?: boolean;
  /** Locks the bar and shows the send spinner (e.g. camera / vision in progress). */
  isLoading?: boolean;
  placeholder?: string;
};

export function Composer({
  onSubmit,
  cameraTrigger,
  disabled,
  isLoading,
  placeholder = "Log a set, e.g. bench 5x5 at 100kg",
}: ComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const formLocked = Boolean(disabled || busy || isLoading);
  const showSendSpinner = busy || Boolean(isLoading);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy || disabled || isLoading) return;

    setBusy(true);
    try {
      await onSubmit(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  }

  const cameraButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={formLocked}
      className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:bg-background"
      aria-label="Open camera"
    >
      <Camera className="h-5 w-5" />
    </Button>
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex items-center gap-2 rounded-full border border-border/80 bg-card p-1.5 pl-2 shadow-md shadow-black/5",
        "transition-colors focus-within:bg-card",
      )}
    >
      {cameraTrigger(cameraButton)}
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        disabled={formLocked}
        className="flex-1 bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted-foreground/70"
      />
      <Button
        type="submit"
        size="icon"
        disabled={formLocked || !text.trim()}
        className="h-10 w-10 shrink-0 rounded-full"
        aria-label={showSendSpinner ? "Working" : "Send"}
        aria-busy={showSendSpinner}
      >
        {showSendSpinner ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <ArrowUp className="h-5 w-5" />
        )}
      </Button>
    </form>
  );
}
