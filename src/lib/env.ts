/**
 * Environment access. Public values are inlined at build time by Next; server-only
 * values are read lazily so importing this file never throws during the build.
 */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

export function requirePublicEnv() {
  if (!publicEnv.supabaseUrl || !publicEnv.supabasePublishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY sont requis (voir .env.example).",
    );
  }
  return publicEnv;
}

export const serverEnv = {
  /** URL the server uses to reach Supabase (defaults to the public URL). */
  get supabaseInternalUrl() {
    return process.env.SUPABASE_INTERNAL_URL || publicEnv.supabaseUrl;
  },
  /** Issuer expected in OAuth access tokens. */
  get authIssuer() {
    return process.env.SUPABASE_AUTH_ISSUER || `${publicEnv.supabaseUrl}/auth/v1`;
  },
  /** Dev only: let plain app session tokens call the MCP endpoint. */
  get mcpAllowSessionTokens() {
    return process.env.MCP_ALLOW_SESSION_TOKENS === "true";
  },
  get mcpRateLimitPerMinute() {
    const n = Number(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? "60");
    return Number.isFinite(n) && n > 0 ? n : 60;
  },
  /** AI recommendations: Claude API key (primary). */
  get anthropicApiKey() {
    return process.env.ANTHROPIC_API_KEY || "";
  },
  /** AI recommendations: OpenRouter key, used only when the Claude API call fails. */
  get openRouterApiKey() {
    return process.env.OPENROUTER_API_KEY || "";
  },
  /** OpenRouter model slug for the fallback (check the exact id on openrouter.ai/models). */
  get openRouterModel() {
    return process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4.1-flash";
  },
};
