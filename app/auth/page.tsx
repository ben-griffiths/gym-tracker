"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBrowserAuthRedirectOrigin } from "@/lib/auth-redirect-origin";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { SVGProps } from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Mode = "login" | "signup";

function GoogleMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      aria-hidden
      {...props}
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export default function AuthPage() {
  const router = useRouter();
  const client = useMemo(() => createClient(), []);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (!err) return;
    setErrorMessage(err);
    const next = new URL(window.location.href);
    next.searchParams.delete("error");
    window.history.replaceState({}, "", next.pathname + next.search);
  }, []);

  async function signInWithGoogle() {
    setOauthPending(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const origin = getBrowserAuthRedirectOrigin();
      if (!origin) {
        throw new Error("Could not resolve app origin for sign-in redirect.");
      }
      const redirectTo = `${origin}/auth/callback`;
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.assign(data.url);
        return;
      }
      throw new Error("Missing OAuth redirect URL.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google sign-in failed.";
      setErrorMessage(message);
      setOauthPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      /* Hard navigation avoids replaying prefetched `/` RSC payloads from before cookies existed (header Link). */
      function finishSignedIn() {
        window.location.assign("/");
      }

      if (mode === "login") {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        finishSignedIn();
        return;
      }

      const base = getBrowserAuthRedirectOrigin();
      const redirectTo = base ? `${base}/` : undefined;
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      });
      if (error) throw error;

      if (!data.session) {
        setMode("login");
        setInfoMessage(
          "Email invitation sent. Open the confirmation link in your email to finish signing in. " +
            'For immediate access after sign-up, turn off "Confirm email" for the Email provider ' +
            "in the Supabase dashboard (Authentication → Providers → Email).",
        );
        router.replace("/auth", { scroll: false });
        return;
      }

      finishSignedIn();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed.";
      setErrorMessage(message);
    } finally {
      setPending(false);
    }
  }

  const oauthOrFormBusy = pending || oauthPending;

  return (
    <main className="flex min-h-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{mode === "login" ? "Log in" : "Create account"}</CardTitle>
          <CardDescription>
            {mode === "login"
              ? "Sign in to continue to LiftLog."
              : "Create an account to start tracking workouts."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={oauthOrFormBusy}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                disabled={oauthOrFormBusy}
                required
              />
            </div>

            {errorMessage ? (
              <p className="text-sm text-destructive">{errorMessage}</p>
            ) : null}
            {infoMessage ? (
              <p className="text-sm text-muted-foreground">{infoMessage}</p>
            ) : null}

            <Button type="submit" disabled={oauthOrFormBusy} className="w-full">
              {pending ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
            </Button>

            <button
              type="button"
              disabled={oauthOrFormBusy}
              className="w-full text-sm text-primary underline-offset-4 hover:underline disabled:opacity-50"
              onClick={() => {
                setMode((current) => (current === "login" ? "signup" : "login"));
                setErrorMessage(null);
                setInfoMessage(null);
              }}
            >
              {mode === "login"
                ? "Need an account? Sign up"
                : "Already have an account? Log in"}
            </button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={oauthOrFormBusy}
            onClick={() => void signInWithGoogle()}
          >
            <GoogleMark className="mr-2 size-4 shrink-0" />
            Continue with Google
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
