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

type CameraPopupProps = {
  onCapture: (payload: { imageBase64: string; mimeType: string }) => Promise<void>;
  /** Fires for the full pick → read → `onCapture` window (drives global chat loading UI). */
  onBusyChange?: (busy: boolean) => void;
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

export function CameraPopup({ onCapture, onBusyChange, trigger }: CameraPopupProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inFlight, setInFlight] = useState(false);

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    onBusyChange?.(true);
    setInFlight(true);
    try {
      const imageBase64 = await fileToBase64(file);
      await onCapture({ imageBase64, mimeType: file.type || "image/jpeg" });
    } finally {
      onBusyChange?.(false);
      setInFlight(false);
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
    disabled?: boolean;
  }>;

  const triggerWithPicker = cloneElement(triggerEl, {
    onClick: (event: MouseEvent) => {
      triggerEl.props.onClick?.(event);
      openCameraOrPicker();
    },
    disabled: inFlight || Boolean(triggerEl.props.disabled),
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
        disabled={inFlight}
        aria-hidden
        tabIndex={-1}
      />
    </>
  );
}
