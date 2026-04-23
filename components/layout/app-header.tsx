"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AvatarCircle } from "@/components/profile/avatar-circle";

export function AppHeader() {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <header className="z-30 border-b bg-background/85 py-4 backdrop-blur">
      <div className="px-4 sm:px-6">
        {isHome ? (
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold tracking-tight">LiftLog</h1>
              <p className="text-xs text-muted-foreground">Mobile-first lifting journal</p>
            </div>
            <AvatarCircle />
          </div>
        ) : (
          <div className="flex h-9 items-center justify-between">
            <Link
              href="/"
              aria-label="Back to home"
              className="inline-flex h-9 items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <AvatarCircle />
          </div>
        )}
      </div>
    </header>
  );
}
