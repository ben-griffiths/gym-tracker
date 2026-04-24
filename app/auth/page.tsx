"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

export default function AuthPage() {
  const router = useRouter();
  const client = useMemo(() => createClient(), []);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      if (mode === "login") {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
        return;
      }

      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;

      if (!data.session) {
        setInfoMessage("Account created. Check your email to confirm your account.");
        return;
      }

      router.replace("/");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed.";
      setErrorMessage(message);
    } finally {
      setPending(false);
    }
  }

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
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
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
                required
              />
            </div>

            {errorMessage ? (
              <p className="text-sm text-destructive">{errorMessage}</p>
            ) : null}
            {infoMessage ? (
              <p className="text-sm text-muted-foreground">{infoMessage}</p>
            ) : null}

            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
            </Button>

            <button
              type="button"
              className="w-full text-sm text-primary underline-offset-4 hover:underline"
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
        </CardContent>
      </Card>
    </main>
  );
}
