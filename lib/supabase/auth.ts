import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type AuthSuccess = {
  client: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

type AuthFailure = {
  response: NextResponse;
};

function unauthorizedResponse(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export async function requireSupabaseUser(
): Promise<AuthSuccess | AuthFailure> {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return { response: unauthorizedResponse("Please log in to continue.") };
  }

  return { client, userId: data.user.id };
}
