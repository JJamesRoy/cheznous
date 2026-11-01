import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/features/auth/auth-frame";
import { ConsentError, ConsentView } from "@/features/auth/oauth-consent";
import { getServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Autoriser l'accès", robots: { index: false } };

/** Consent screen for Supabase Auth's OAuth 2.1 server (MCP clients such as Claude). */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const authorizationId = typeof sp.authorization_id === "string" ? sp.authorization_id : "";

  if (!authorizationId) {
    return (
      <AuthFrame brandHref={null}>
        <ConsentError
          title="Lien d'autorisation incomplet"
          description="Il manque l'identifiant de la demande. Recommence la connexion depuis l'application qui demande l'accès."
        />
      </AuthFrame>
    );
  }

  const supabase = await getServerSupabase();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    redirect(`/connexion?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);
  }

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    return (
      <AuthFrame brandHref={null}>
        <ConsentError
          title="Cette demande d'accès n'est plus valide"
          description="Elle a expiré ou a déjà été traitée. Recommence la connexion depuis l'application qui demande l'accès (par exemple Claude)."
        />
      </AuthFrame>
    );
  }
  // Already consented: Supabase hands back the client's redirect directly.
  if (!("authorization_id" in data)) redirect(data.redirect_url);

  return (
    <AuthFrame brandHref={null}>
      <ConsentView details={data} decisionFailed={sp.erreur === "1"} />
    </AuthFrame>
  );
}
