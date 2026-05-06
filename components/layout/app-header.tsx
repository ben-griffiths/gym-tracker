"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowLeft, BookOpen } from "lucide-react";
import { AvatarCircle } from "@/components/profile/avatar-circle";
import { useAppHeaderCenter } from "@/components/layout/app-header-center-context";
import { formatWorkoutTitle } from "@/lib/workout-history";

const PAGE_HEADER_TITLES: Record<string, string> = {
  "/strength": "Strength",
  "/rep-maxes": "Rep maxes",
  "/exercises": "Exercise library",
};

type AppHeaderProps = {
  /** From middleware `x-pathname` so the first client render matches SSR (avoids `usePathname` dev/hydration skew). */
  initialPathname: string;
};

export function AppHeader({ initialPathname }: AppHeaderProps) {
  const livePathname = usePathname();
  const pathname = useSyncExternalStore(
    () => () => {},
    () => livePathname,
    () => initialPathname,
  );
  const isHome = pathname === "/";
  const pageTitle = PAGE_HEADER_TITLES[pathname];
  const { customTitle } = useAppHeaderCenter();
  /** Empty until mount so SSR and first client pass match; time uses local TZ only after hydration. */
  const [nowLabel, setNowLabel] = useState("\u00a0");
  useEffect(() => {
    if (pageTitle || customTitle) {
      return;
    }
    const update = () =>
      setNowLabel(formatWorkoutTitle(new Date().toISOString()));
    update();
    const id = setInterval(update, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pageTitle, customTitle]);

  return (
    <header className="z-30 flex h-[75px] min-h-[75px] shrink-0 border-b bg-card">
      <div className="flex h-full w-full min-w-0 items-center px-4 sm:px-6">
        {isHome ? (
          <div className="flex w-full min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">
                LiftLog
              </h1>
              <p className="mt-0.5 text-xs leading-tight text-muted-foreground sm:text-sm">
                Mobile-first lifting journal
              </p>
            </div>
            <HeaderLibraryAndProfile />
          </div>
        ) : (
          <div className="grid w-full min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-1">
            <Link
              href="/"
              aria-label="Back to home"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-start pl-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-6 w-6 shrink-0" />
            </Link>
            {pageTitle ? (
              <h1 className="min-w-0 truncate text-center text-sm font-semibold text-foreground">
                {pageTitle}
              </h1>
            ) : customTitle ? (
              <h1 className="min-w-0 truncate text-center text-sm font-semibold tabular-nums text-foreground">
                {customTitle}
              </h1>
            ) : (
              <p
                className="min-w-0 truncate text-center text-sm font-semibold tabular-nums text-foreground"
                aria-live="polite"
                aria-atomic
              >
                {nowLabel}
              </p>
            )}
            <HeaderLibraryAndProfile />
          </div>
        )}
      </div>
    </header>
  );
}

function HeaderLibraryAndProfile() {
  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      <Link
        href="/exercises"
        aria-label="Exercise library"
        className="inline-flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpen className="h-5 w-5 shrink-0" aria-hidden />
        <span className="hidden sm:inline">Library</span>
      </Link>
      <AvatarCircle className="!h-11 !w-11 text-sm" />
    </div>
  );
}
