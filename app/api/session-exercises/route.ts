import { NextResponse } from "next/server";
import { requireSupabaseUser } from "@/lib/supabase/auth";
import { mapSupabaseRouteError } from "@/lib/supabase/errors";
import { ensureSessionExercise } from "@/lib/services/workout-service";
import { registerSessionExerciseSchema } from "@/lib/validators/workout";

export const dynamic = "force-dynamic";

/**
 * Create a `session_exercises` row (no sets) so empty exercises are persisted
 * and show up in history / edit rehydration.
 */
export async function POST(request: Request) {
  const auth = await requireSupabaseUser();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = registerSessionExerciseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { sessionId, exercise } = parsed.data;

  try {
    const sessionExercise = await ensureSessionExercise(
      auth.client,
      auth.userId,
      sessionId,
      exercise,
    );
    return NextResponse.json(
      { sessionExercise, storageMode: "database" as const },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/session-exercises failed", error);
    const mapped = mapSupabaseRouteError(error);
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status },
    );
  }
}
