"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "liftlog:pwa-install-hint-dismissed";

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function InstallHint() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setDismissed(false);
    }
    const mq = window.matchMedia("(display-mode: standalone)");
    setStandalone(mq.matches);
    const onChange = () => setStandalone(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (!mounted || pathname !== "/" || standalone || dismissed) {
    return null;
  }

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="border-b border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-sm"
    >
      <div className="mx-auto flex max-w-lg items-start gap-3 sm:max-w-none">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Install LiftLog</p>
          {isIOS() ? (
            <p className="mt-1 text-muted-foreground">
              Tap <span className="font-medium text-foreground">Share</span>, then{" "}
              <span className="font-medium text-foreground">Add to Home Screen</span> to open
              like an app.
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">
              Use your browser&apos;s install or &quot;Add to Home screen&quot; option for a
              fullscreen app experience.
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          onClick={dismiss}
          aria-label="Dismiss install hint"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
