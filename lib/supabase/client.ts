"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/config";

let clientSingleton: SupabaseClient | null = null;

export function createClient() {
  if (!clientSingleton) {
    clientSingleton = createBrowserClient(
      getSupabaseUrl(),
      getSupabasePublishableKey(),
    );
  }
  return clientSingleton;
}
