import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requirePublicEnv, serverEnv } from "@/lib/env";

/**
 * Supabase client acting as the holder of `accessToken` (MCP requests, integration tests).
 * The database sees `auth.uid()` from the token, so RLS applies exactly as in the app.
 * Never pass a service-role key here.
 */
export function getTokenSupabase(accessToken: string): SupabaseClient {
  const env = requirePublicEnv();
  return createClient(serverEnv.supabaseInternalUrl, env.supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 2 } },
  });
}
