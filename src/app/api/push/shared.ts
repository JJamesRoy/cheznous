import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

export const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

/** Same-origin check + signed-in user-scoped client (RLS applies; no service-role key). */
export async function authed(request: Request): Promise<{ db: SupabaseClient; userId: string } | NextResponse> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json(403, { error: "Origine refusée." });
  const db = await getServerSupabase();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return json(401, { error: "Connecte-toi pour continuer." });
  return { db, userId };
}

export function vapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}
