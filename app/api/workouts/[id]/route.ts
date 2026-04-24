import { NextResponse } from "next/server";
import { requireSupabaseUser } from "@/lib/supabase/auth";
import { mapSupabaseRouteError } from "@/lib/supabase/errors";
import {
  deleteWorkoutSessionById,
  updateWorkoutSessionTranscript,
} from "@/lib/services/workout-service";
import { patchWorkoutTranscriptSchema } from "@/lib/validators/workout";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSupabaseUser();
  if ("response" in auth) return auth.response;

  const { id: sessionId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = patchWorkoutTranscriptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid transcript payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    await updateWorkoutSessionTranscript(
      auth.client,
      auth.userId,
      sessionId,
      parsed.data.chatTranscript,
    );
    return NextResponse.json({ ok: true, storageMode: "database" as const });
  } catch (error) {
    const mapped = mapSupabaseRouteError(error);
    if (mapped.status >= 500) {
      console.error("PATCH /api/workouts/[id] failed", error);
    }
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSupabaseUser();
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  try {
    const removed = await deleteWorkoutSessionById(auth.client, auth.userId, id);
    return NextResponse.json(
      { removed, storageMode: "database" },
      { status: 200 },
    );
  } catch (error) {
    const mapped = mapSupabaseRouteError(error);
    if (mapped.status >= 500) {
      console.error("DELETE /api/workouts/[id] failed", error);
    }
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
