import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { requirePublicEnv, serverEnv } from "@/lib/env";

/** Supabase client bound to the signed-in user's cookie session. RLS applies. */
export async function getServerSupabase(): Promise<SupabaseClient> {
  const env = requirePublicEnv();
  const cookieStore = await cookies();
  return createServerClient(serverEnv.supabaseInternalUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes cookies instead.
        }
      },
    },
  });
}
