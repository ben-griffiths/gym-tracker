"use client";

import { FormEvent, ReactNode, useState } from "react";
import { ArrowUp, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ComposerProps = {
  onSubmit: (message: string) => Promise<void> | void;
  cameraTrigger: (trigger: ReactNode) => ReactNode;
  disabled?: boolean;
  placeholder?: string;
};

export function Composer({
  onSubmit,
  cameraTrigger,
  disabled,
  placeholder = "Log a set, e.g. bench 5x5 at 100kg",
}: ComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy || disabled) return;

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
        "flex items-center gap-2 rounded-full border bg-muted/40 p-1.5 pl-2 shadow-sm backdrop-blur",
        "transition-colors focus-within:bg-background",
      )}
    >
      {cameraTrigger(cameraButton)}
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        disabled={disabled || busy}
        className="flex-1 bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted-foreground/70"
      />
      <Button
        type="submit"
        size="icon"
        disabled={disabled || busy || !text.trim()}
        className="h-10 w-10 shrink-0 rounded-full"
        aria-label="Send"
      >
        <ArrowUp className="h-5 w-5" />
      </Button>
    </form>
  );
}
