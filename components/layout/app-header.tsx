"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AvatarCircle } from "@/components/profile/avatar-circle";
import { useAppHeaderCenter } from "@/components/layout/app-header-center-context";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { formatWorkoutTitle } from "@/lib/workout-history";

const PAGE_HEADER_TITLES: Record<string, string> = {
  "/strength": "Strength",
  "/rep-maxes": "Rep maxes",
};

export function AppHeader() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const pageTitle = PAGE_HEADER_TITLES[pathname];
  const { customTitle } = useAppHeaderCenter();
  const [nowLabel, setNowLabel] = useState(() =>
    formatWorkoutTitle(new Date().toISOString()),
  );
  useEffect(() => {
    if (pageTitle || customTitle) return;
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
          <div className="flex w-full items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">
                LiftLog
              </h1>
              <p className="mt-0.5 text-xs leading-tight text-muted-foreground sm:text-sm">
                Mobile-first lifting journal
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <ThemeToggle />
              <AvatarCircle className="!h-11 !w-11 text-sm" />
            </div>
          </div>
        ) : (
          <div className="grid w-full grid-cols-[2.75rem_1fr_auto] items-center gap-1">
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
            <div className="flex min-w-0 items-center justify-end gap-0.5">
              <ThemeToggle />
              <AvatarCircle className="!h-11 !w-11 text-sm" />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
