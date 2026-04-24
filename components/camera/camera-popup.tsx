"use client";

import {
  ChangeEvent,
  cloneElement,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { Loader2 } from "lucide-react";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    try {
      const imageBase64 = await fileToBase64(file);
      await onCapture({ imageBase64, mimeType: file.type || "image/jpeg" });
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  function openCameraOrPicker() {
    inputRef.current?.click();
  }

  if (!isValidElement(trigger)) {
    return trigger;
  }

  const triggerEl = trigger as ReactElement<{
    onClick?: (e: MouseEvent) => void;
  }>;

  const triggerWithPicker = cloneElement(triggerEl, {
    onClick: (event: MouseEvent) => {
      triggerEl.props.onClick?.(event);
      openCameraOrPicker();
    },
  });

  return (
    <>
      {triggerWithPicker}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={handleFileSelect}
        disabled={busy}
        aria-hidden
        tabIndex={-1}
      />
      {busy ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm shadow-lg">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            Analyzing image…
          </div>
        </div>
      ) : null}
    </>
  );
}
