"use client";

import { ChangeEvent, ReactNode, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type CameraPopupProps = {
  onCapture: (payload: { imageBase64: string; mimeType: string }) => Promise<void>;
  trigger: ReactNode;
};

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function CameraPopup({ onCapture, trigger }: CameraPopupProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    try {
      const imageBase64 = await fileToBase64(file);
      await onCapture({ imageBase64, mimeType: file.type || "image/jpeg" });
      setOpen(false);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader>
          <DialogTitle>Snap your set</DialogTitle>
          <DialogDescription>
            Point at the machine, plates, or dumbbells. We will suggest the exercise and load for you to confirm.
          </DialogDescription>
        </DialogHeader>
        <label className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center transition-colors hover:bg-muted/40">
          <Camera className="mb-3 h-9 w-9 text-muted-foreground" />
          <span className="text-sm font-medium">Take photo or upload</span>
          <span className="mt-1 text-xs text-muted-foreground">
            Camera opens directly on mobile.
          </span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileSelect}
            disabled={busy}
          />
        </label>
        {busy ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analyzing image...
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
