import { NextResponse } from "next/server";
import { requireSupabaseUser } from "@/lib/supabase/auth";
import { mapSupabaseRouteError } from "@/lib/supabase/errors";
import { deleteWorkoutSessionById } from "@/lib/services/workout-service";

export const dynamic = "force-dynamic";

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
