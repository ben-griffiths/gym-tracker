import { NextResponse } from "next/server";
import { requireSupabaseUser } from "@/lib/supabase/auth";
import { mapSupabaseRouteError } from "@/lib/supabase/errors";
import { updateSetSchema } from "@/lib/validators/workout";
import {
  deleteSetEntry,
  updateSetEntry,
} from "@/lib/services/workout-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSupabaseUser();
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  const payload = await request.json();
  const parsed = updateSetSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid update payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const updated = await updateSetEntry(auth.client, auth.userId, id, parsed.data);
    return NextResponse.json(
      { updated, storageMode: "database" },
      { status: 200 },
    );
  } catch (error) {
    const mapped = mapSupabaseRouteError(error);
    if (mapped.status >= 500) {
      console.error("PATCH /api/sets/[id] failed", error);
    }
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
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
    const removed = await deleteSetEntry(auth.client, auth.userId, id);
    return NextResponse.json(
      { removed, storageMode: "database" },
      { status: 200 },
    );
  } catch (error) {
    const mapped = mapSupabaseRouteError(error);
    if (mapped.status >= 500) {
      console.error("DELETE /api/sets/[id] failed", error);
    }
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
