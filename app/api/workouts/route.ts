import { NextResponse } from "next/server";
import { requireSupabaseUser } from "@/lib/supabase/auth";
import { mapSupabaseRouteError } from "@/lib/supabase/errors";
import {
  createWorkoutSession,
  listWorkoutGroups,
} from "@/lib/services/workout-service";
import { createWorkoutSchema } from "@/lib/validators/workout";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireSupabaseUser();
  if ("response" in auth) return auth.response;

  try {
    const groups = await listWorkoutGroups(auth.client, auth.userId);
    return NextResponse.json({ groups, storageMode: "database" });
  } catch (error) {
    console.error("GET /api/workouts failed", error);
    const mapped = mapSupabaseRouteError(error);
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireSupabaseUser();
  if ("response" in auth) return auth.response;

  const payload = await request.json();
  const parsed = createWorkoutSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid workout payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { groupName, sessionName, notes } = parsed.data;

  try {
    const { group, session } = await createWorkoutSession(auth.client, auth.userId, {
      groupName,
      sessionName,
      notes,
    });

    return NextResponse.json({ group, session, storageMode: "database" }, { status: 201 });
  } catch (error) {
    console.error("POST /api/workouts failed", error);
    const mapped = mapSupabaseRouteError(error);
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status },
    );
  }
}
