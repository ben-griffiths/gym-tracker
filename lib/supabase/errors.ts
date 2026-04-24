type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string;
};

function asSupabaseError(error: unknown): SupabaseLikeError | null {
  if (!error || typeof error !== "object") return null;
  const maybe = error as Record<string, unknown>;
  return {
    code: typeof maybe.code === "string" ? maybe.code : undefined,
    message: typeof maybe.message === "string" ? maybe.message : undefined,
    details: typeof maybe.details === "string" ? maybe.details : undefined,
  };
}

export function mapSupabaseRouteError(error: unknown): {
  status: number;
  message: string;
} {
  const parsed = asSupabaseError(error);
  const code = parsed?.code ?? "";

  // PostgreSQL relation does not exist / missing table.
  if (code === "42P01") {
    return {
      status: 503,
      message:
        "Database schema is not initialized. Apply the Supabase migration and retry.",
    };
  }

  // Insufficient privileges / RLS rejection.
  if (code === "42501") {
    return {
      status: 403,
      message: "Access denied by database policy. Check Supabase RLS rules.",
    };
  }

  // No rows found for single-row query.
  if (code === "PGRST116") {
    return {
      status: 404,
      message: "Not found.",
    };
  }

  // Undefined column (e.g. chat_transcript not applied — run latest migrations).
  if (code === "42703") {
    return {
      status: 503,
      message:
        "Database schema is missing a column (apply migrations: supabase/migrations, then supabase db push or run SQL in the Supabase SQL editor).",
    };
  }

  // Table missing from PostgREST schema cache (migration not applied).
  if (code === "PGRST205") {
    return {
      status: 503,
      message:
        "Supabase tables are missing. Apply the migration in supabase/migrations/20260423193000_init.sql.",
    };
  }

  const msg = (parsed?.message ?? "").toLowerCase();
  if (
    msg.includes("chat_transcript") ||
    (msg.includes("column") && msg.includes("does not exist"))
  ) {
    return {
      status: 503,
      message:
        "Chat transcript storage is not set up. Apply supabase/migrations/20260425120000_chat_transcript.sql to your database (e.g. supabase db push or paste the SQL in the Supabase SQL editor), then try again.",
    };
  }

  return {
    status: 500,
    message: "Database request failed.",
  };
}
