"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

/**
 * Client-side OAuth callback: `@supabase/ssr` persists the PKCE code verifier via the
 * browser cookie storage used by {@link createClient}. Running `exchangeCodeForSession`
 * here matches that storage — a Route Handler-only exchange often fails with “PKCE code
 * verifier not found…” because cookies are shaped for the browser client.
 */
export default function AuthOAuthCallbackPage() {
  const router = useRouter();
  const client = useMemo(() => createClient(), []);
  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    async function exchange() {
      const params = new URLSearchParams(window.location.search);

      const oauthError =
        params.get("error_description")?.replace(/\+/g, " ") ??
        params.get("error")?.replace(/\+/g, " ");

      if (oauthError) {
        router.replace(
          `/auth?error=${encodeURIComponent(oauthError)}`,
        );
        return;
      }

      const code = params.get("code");
      if (!code) {
        router.replace(
          `/auth?error=${encodeURIComponent("Sign-in failed: no authorization code was returned.")}`,
        );
        return;
      }

      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) {
        router.replace(`/auth?error=${encodeURIComponent(error.message)}`);
        return;
      }

      setMessage("Taking you home…");
      window.location.assign("/");
    }

    void exchange().catch((error: unknown) => {
      const text =
        error instanceof Error ? error.message : "Sign-in exchange failed unexpectedly.";
      router.replace(`/auth?error=${encodeURIComponent(text)}`);
    });
  }, [client, router]);

  return (
    <main className="flex min-h-full items-center justify-center bg-background p-4">
      <p className="text-center text-sm text-muted-foreground">{message}</p>
    </main>
  );
}
