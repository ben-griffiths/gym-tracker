"use client";

import { useEffect } from "react";
import { startSyncEngine } from "@/lib/sync/engine";

/**
 * Boots the local-first sync engine on mount and registers the offline
 * service worker. The engine itself is idempotent (safe to start once).
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    startSyncEngine();
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("SW registration failed", err);
      });
    }
  }, []);
  return <>{children}</>;
}
