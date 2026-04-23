import { NextResponse } from "next/server";
import { requireSupabaseUser } from "@/lib/supabase/auth";
import { mapSupabaseRouteError } from "@/lib/supabase/errors";
import { createManySetsSchema, createSetSchema } from "@/lib/validators/workout";
import {
  createManySetEntries,
  createSetEntry,
  getSessionSummary,
} from "@/lib/services/workout-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireSupabaseUser();
  if ("response" in auth) return auth.response;

  const payload = await request.json();

  if (Array.isArray(payload.entries)) {
    const manyParsed = createManySetsSchema.safeParse(payload);
    if (!manyParsed.success) {
      return NextResponse.json(
        { error: "Invalid set payload", details: manyParsed.error.flatten() },
        { status: 400 },
      );
    }

    const { entries, sessionId, exercise, source, startingSetNumber } = manyParsed.data;
    try {
      const created = await createManySetEntries(auth.client, auth.userId, {
        sessionId,
        exercise,
        source,
        startingSetNumber,
        entries: entries.map((entry) => ({
          reps: entry.reps ?? null,
          weight: entry.weight ?? null,
          weightUnit: entry.weightUnit,
          isWarmup: entry.isWarmup,
          notes: entry.notes ?? null,
          rpe: entry.rpe ?? null,
          rir: entry.rir ?? null,
          feel: entry.feel ?? null,
        })),
      });

      const session = await getSessionSummary(auth.client, auth.userId, sessionId);
      return NextResponse.json({ created, session, storageMode: "database" }, { status: 201 });
    } catch (error) {
      console.error("POST /api/sets (many) failed", error);
      const mapped = mapSupabaseRouteError(error);
      return NextResponse.json(
        { error: mapped.message },
        { status: mapped.status },
      );
    }
  }

  const parsed = createSetSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid set payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const created = await createSetEntry(auth.client, auth.userId, parsed.data);
    const session = await getSessionSummary(auth.client, auth.userId, parsed.data.sessionId);
    return NextResponse.json({ created, session, storageMode: "database" }, { status: 201 });
  } catch (error) {
    console.error("POST /api/sets failed", error);
    const mapped = mapSupabaseRouteError(error);
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status },
    );
  }
}
