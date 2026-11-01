"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePublicEnv } from "@/lib/env";

let client: SupabaseClient | undefined;

/** Singleton browser client (cookie-based session shared with the server). */
export function getBrowserSupabase(): SupabaseClient {
  if (!client) {
    const env = requirePublicEnv();
    client = createBrowserClient(env.supabaseUrl, env.supabasePublishableKey);
  }
  return client;
}
