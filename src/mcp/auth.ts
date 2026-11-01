import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { publicEnv, serverEnv } from "../lib/env";

export type VerifiedToken = {
  sub: string;
  email: string | null;
  clientId: string | null;
  exp: number;
  raw: string;
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${serverEnv.supabaseInternalUrl}/auth/v1/.well-known/jwks.json`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
  }
  return jwks;
}

export class TokenError extends Error {
  constructor(
    public readonly reason: "missing" | "invalid" | "expired" | "not_oauth",
    message: string,
  ) {
    super(message);
  }
}

/** Public URL of the MCP endpoint (the protected resource). */
export function resourceUrl(): string {
  return `${publicEnv.appUrl.replace(/\/$/, "")}/api/mcp`;
}

export function resourceMetadataUrl(): string {
  return `${publicEnv.appUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource/api/mcp`;
}

/**
 * Verify a Supabase-issued access token: ES256/RS256 signature against the project JWKS,
 * issuer, expiry, and (by default) that it was issued through the OAuth flow (`client_id`).
 */
export async function verifyAccessToken(authorization: string | null): Promise<VerifiedToken> {
  const m = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new TokenError("missing", "Jeton d'accès manquant.");
  const token = m[1].trim();
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getJwks(), {
      issuer: serverEnv.authIssuer,
      algorithms: ["ES256", "RS256"],
      clockTolerance: 5,
    }));
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ERR_JWT_EXPIRED") throw new TokenError("expired", "Jeton expiré.");
    throw new TokenError("invalid", "Jeton invalide.");
  }
  if (!payload.sub || payload.role !== "authenticated") throw new TokenError("invalid", "Jeton invalide.");
  const clientId = typeof payload.client_id === "string" ? payload.client_id : null;
  if (!clientId && !serverEnv.mcpAllowSessionTokens) {
    throw new TokenError("not_oauth", "Ce jeton n'a pas été émis pour un client MCP.");
  }
  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    clientId,
    exp: payload.exp ?? 0,
    raw: token,
  };
}

export function wwwAuthenticate(error?: TokenError): string {
  const parts = [`Bearer resource_metadata="${resourceMetadataUrl()}"`];
  if (error && error.reason !== "missing") {
    parts.push(`error="invalid_token"`, `error_description="${error.message.replace(/"/g, "'")}"`);
  }
  return parts.join(", ");
}
