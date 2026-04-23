import { NextResponse } from "next/server";
import { runChatAgent } from "@/lib/chat-agent";
import { requireSupabaseUser } from "@/lib/supabase/auth";
import { chatSchema } from "@/lib/validators/workout";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireSupabaseUser();
  if ("response" in auth) return auth.response;

  const payload = await request.json();
  const parsed = chatSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid chat payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await runChatAgent({
    message: parsed.data.message,
    context: parsed.data.context,
  });

  return NextResponse.json(result);
}
