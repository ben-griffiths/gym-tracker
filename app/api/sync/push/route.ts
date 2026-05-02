import { NextResponse } from "next/server";
import { requireSupabaseUser } from "@/lib/supabase/auth";
import { mapSupabaseRouteError } from "@/lib/supabase/errors";
import {
  pushRequestSchema,
  ROW_SCHEMAS,
  type PushMutation,
} from "@/lib/sync/schemas";
import type { SyncTable } from "@/lib/sync/types";

export const dynamic = "force-dynamic";

const ALLOWED_FIELDS: Record<SyncTable, string[]> = {
  workout_groups: [
    "id",
    "user_id",
    "slug",
    "name",
    "description",
    "deleted_at",
    "client_updated_at",
  ],
  workout_sessions: [
    "id",
    "user_id",
    "workout_group_id",
    "name",
    "notes",
    "started_at",
    "ended_at",
    "status",
    "chat_transcript",
    "deleted_at",
    "client_updated_at",
  ],
  exercises: [
    "id",
    "user_id",
    "name",
    "aliases",
    "deleted_at",
    "client_updated_at",
  ],
  session_exercises: [
    "id",
    "user_id",
    "session_id",
    "exercise_id",
    "custom_exercise_name",
    "order_index",
    "deleted_at",
    "client_updated_at",
  ],
  set_entries: [
    "id",
    "user_id",
    "session_exercise_id",
    "set_number",
    "reps",
    "weight",
    "weight_unit",
    "rpe",
    "rir",
    "feel",
    "is_warmup",
    "notes",
    "logged_at",
    "source",
    "deleted_at",
    "client_updated_at",
  ],
};

function pickAllowed(table: SyncTable, payload: Record<string, unknown>) {
  const allowed = ALLOWED_FIELDS[table];
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in payload) out[k] = payload[k];
  }
  return out;
}

export async function POST(request: Request) {
  const auth = await requireSupabaseUser();
  if ("response" in auth) return auth.response;
  const { client, userId } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = pushRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid push payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const results: Array<{
    row_id: string;
    table: SyncTable;
    accepted: boolean;
    server_row: Record<string, unknown>;
  }> = [];

  for (const m of parsed.data.mutations) {
    try {
      const rowResult = await applyMutation(client, userId, m);
      results.push(rowResult);
    } catch (error) {
      console.error("sync/push mutation failed", { table: m.table, id: m.row_id, error });
      const mapped = mapSupabaseRouteError(error);
      return NextResponse.json(
        { error: mapped.message, row_id: m.row_id },
        { status: mapped.status },
      );
    }
  }

  return NextResponse.json({ results });
}

// Supabase client typing is opaque here — Extract gives us the success branch.
type SupabaseClient = Extract<
  Awaited<ReturnType<typeof requireSupabaseUser>>,
  { client: unknown }
>["client"];

async function applyMutation(
  client: SupabaseClient,
  userId: string,
  mutation: PushMutation,
) {
  const { table, op, row_id, client_updated_at } = mutation;
  const schema = ROW_SCHEMAS[table];

  // Validate the payload for this table.
  const baseRow = pickAllowed(table, mutation.payload);
  baseRow.id = row_id;
  baseRow.user_id = userId;
  baseRow.client_updated_at = client_updated_at;
  if (op === "delete") {
    baseRow.deleted_at = baseRow.deleted_at ?? client_updated_at;
  }

  const validated = schema.partial().safeParse(baseRow);
  if (!validated.success) {
    throw new Error(
      `Invalid ${table} payload: ${JSON.stringify(validated.error.flatten())}`,
    );
  }

  // LWW: only apply if no existing row OR existing.client_updated_at < incoming.
  const existing = await client
    .from(table)
    .select("client_updated_at")
    .eq("id", row_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing.error && existing.error.code !== "PGRST116") {
    throw existing.error;
  }

  const existingTs = (existing.data as { client_updated_at: string | null } | null)?.client_updated_at ?? null;
  const incomingTs = client_updated_at;
  const shouldApply = !existingTs || Date.parse(incomingTs) >= Date.parse(existingTs);

  if (shouldApply) {
    const upsertRes = await client
      .from(table)
      .upsert(baseRow as never, { onConflict: "id" })
      .select("*")
      .single();
    if (upsertRes.error) throw upsertRes.error;
    return {
      row_id,
      table,
      accepted: true,
      server_row: upsertRes.data as Record<string, unknown>,
    };
  }

  // Rejected: return canonical server row so client overwrites local.
  const fetched = await client
    .from(table)
    .select("*")
    .eq("id", row_id)
    .eq("user_id", userId)
    .single();
  if (fetched.error) throw fetched.error;
  return {
    row_id,
    table,
    accepted: false,
    server_row: fetched.data as Record<string, unknown>,
  };
}
