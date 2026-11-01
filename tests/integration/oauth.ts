import { createHash, randomBytes } from "node:crypto";
import type { TestUser } from "./helpers";

const ISSUER = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const REDIRECT = "http://localhost:6274/oauth/callback";

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Full OAuth 2.1 authorization-code + PKCE flow against Supabase Auth's OAuth server, exactly as an
 * MCP client performs it: discovery → dynamic client registration → /authorize → consent (as the
 * signed-in user, which is what our /oauth/consent page does) → token exchange.
 */
export async function oauthAccessToken(user: TestUser): Promise<{ accessToken: string; refreshToken: string; clientId: string }> {
  const meta = await (await fetch(`${ISSUER}/.well-known/oauth-authorization-server`)).json();

  const reg = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: KEY },
    body: JSON.stringify({
      client_name: "Chez Nous test client",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!reg.ok) throw new Error(`DCR failed ${reg.status}: ${await reg.text()}`);
  const client = await reg.json();

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(8));
  const authorize = new URL(meta.authorization_endpoint);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "email",
  }).toString();
  const authRes = await fetch(authorize, { redirect: "manual", headers: { apikey: KEY } });
  const consentUrl = new URL(authRes.headers.get("location") ?? "", "http://x");
  const authorizationId = consentUrl.searchParams.get("authorization_id");
  if (!authorizationId) throw new Error(`no authorization_id (status ${authRes.status}, location ${authRes.headers.get("location")})`);
  if (!consentUrl.pathname.endsWith("/oauth/consent")) throw new Error(`unexpected consent path ${consentUrl.pathname}`);

  // What our /oauth/consent page does: read the request as the signed-in user (binds it), then approve.
  const details = await fetch(`${ISSUER}/oauth/authorizations/${authorizationId}`, {
    headers: { apikey: KEY, authorization: `Bearer ${user.token}` },
  });
  if (!details.ok) throw new Error(`authorization details failed ${details.status}: ${await details.text()}`);
  const consent = await fetch(`${ISSUER}/oauth/authorizations/${authorizationId}/consent`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: KEY, authorization: `Bearer ${user.token}` },
    body: JSON.stringify({ action: "approve" }),
  });
  if (!consent.ok) throw new Error(`consent failed ${consent.status}: ${await consent.text()}`);
  const { redirect_url } = await consent.json();
  const back = new URL(redirect_url);
  if (back.searchParams.get("state") !== state) throw new Error("state mismatch");
  const code = back.searchParams.get("code")!;

  const tok = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", apikey: KEY },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier }),
  });
  if (!tok.ok) throw new Error(`token exchange failed ${tok.status}: ${await tok.text()}`);
  const t = await tok.json();
  return { accessToken: t.access_token, refreshToken: t.refresh_token, clientId: client.client_id };
}
