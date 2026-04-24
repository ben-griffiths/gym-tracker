"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Plus } from "lucide-react";

/**
 * Renders outside the app scroll container (portal → body) so `position: fixed`
 * is not clipped by `overflow-y-auto` on mobile (especially WebKit).
 */
export function StartWorkoutFab() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] sm:px-6 sm:pb-8">
      <Link
        href="/workout"
        className="pointer-events-auto inline-flex max-w-[min(100%,calc(100vw-1.5rem))] items-center justify-center gap-2 rounded-full bg-primary px-5 py-3.5 text-center text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-10px_rgba(0,0,0,0.45),0_8px_24px_-8px_rgba(14,165,233,0.35)] ring-1 ring-sky-500/25 dark:shadow-[0_10px_30px_-10px_rgba(0,0,0,0.55),0_8px_24px_-8px_rgba(56,189,248,0.2)] dark:ring-sky-400/20 transition-transform hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-none sm:px-6"
      >
        <Plus className="h-4 w-4 shrink-0" />
        <span className="min-w-0">Start workout</span>
      </Link>
    </div>,
    document.body,
  );
}
