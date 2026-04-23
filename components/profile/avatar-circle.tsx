"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

function initialFromEmail(email: string | null | undefined) {
  if (!email) return "?";
  const trimmed = email.trim();
  if (!trimmed) return "?";
  return trimmed[0]?.toUpperCase() ?? "?";
}

type AvatarCircleProps = {
  className?: string;
};

export function AvatarCircle({ className }: AvatarCircleProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let isActive = true;
    const client = createClient();

    client.auth
      .getUser()
      .then(({ data }) => {
        if (!isActive) return;
        setEmail(data.user?.email ?? null);
      })
      .catch(() => {
        if (!isActive) return;
        setEmail(null);
      });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (!isActive) return;
      setEmail(session?.user?.email ?? null);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function handlePointer(event: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const initial = useMemo(() => initialFromEmail(email), [email]);

  async function handleSignOut() {
    try {
      setSigningOut(true);
      const client = createClient();
      const { error } = await client.auth.signOut();
      if (error) throw error;
      setOpen(false);
      router.replace("/auth");
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sign out.";
      toast.error(message);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full border bg-card text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        title={email ?? "Profile"}
        aria-label={email ? `Profile ${email}` : "Profile"}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {initial}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border bg-popover p-3 shadow-lg"
        >
          <p className="truncate text-sm font-medium text-foreground">
            {email ?? "No email"}
          </p>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
