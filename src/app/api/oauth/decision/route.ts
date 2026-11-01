import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/** Consent decision for the Supabase OAuth 2.1 server (MCP clients). */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Origine refusée." }, { status: 403 });
  }
  const form = await request.formData();
  const authorizationId = String(form.get("authorization_id") ?? "");
  const decision = String(form.get("decision") ?? "");
  if (!authorizationId) return NextResponse.json({ error: "authorization_id manquant" }, { status: 400 });

  const supabase = await getServerSupabase();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return NextResponse.redirect(new URL(`/connexion?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`, request.url), 303);

  const { data, error } =
    decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);
  if (error || !data) {
    return NextResponse.redirect(new URL(`/oauth/consent?authorization_id=${authorizationId}&erreur=1`, request.url), 303);
  }
  return NextResponse.redirect(data.redirect_url, 303);
}
