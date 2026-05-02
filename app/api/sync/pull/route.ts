import { NextResponse } from "next/server";
import { requireSupabaseUser } from "@/lib/supabase/auth";
import { mapSupabaseRouteError } from "@/lib/supabase/errors";
import type { SyncTable } from "@/lib/sync/types";

export const dynamic = "force-dynamic";

const TABLES: SyncTable[] = [
  "workout_groups",
  "workout_sessions",
  "exercises",
  "session_exercises",
  "set_entries",
];

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

export async function GET(request: Request) {
  const auth = await requireSupabaseUser();
  if ("response" in auth) return auth.response;
  const { client, userId } = auth;

  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.min(
    Math.max(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  try {
    const out: Record<SyncTable, Record<string, unknown>[]> = {
      workout_groups: [],
      workout_sessions: [],
      exercises: [],
      session_exercises: [],
      set_entries: [],
    };

    let maxUpdated: string | null = since;
    let totalRows = 0;
    let hasMore = false;

    for (const table of TABLES) {
      let query = client
        .from(table)
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: true })
        .limit(limit);
      if (since) query = query.gt("updated_at", since);

      const { data, error } = await query;
      if (error) throw error;

      const rows = (data ?? []) as Array<Record<string, unknown>>;
      out[table] = rows;
      totalRows += rows.length;
      if (rows.length === limit) hasMore = true;

      for (const r of rows) {
        const u = r["updated_at"];
        if (typeof u === "string" && (!maxUpdated || u > maxUpdated)) {
          maxUpdated = u;
        }
      }
    }

    return NextResponse.json({
      rows: out,
      next_cursor: maxUpdated,
      has_more: hasMore && totalRows >= limit,
    });
  } catch (error) {
    console.error("GET /api/sync/pull failed", error);
    const mapped = mapSupabaseRouteError(error);
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status },
    );
  }
}
